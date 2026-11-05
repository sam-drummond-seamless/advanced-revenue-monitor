import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { google, type sheets_v4 } from 'googleapis';

/** The auth type googleapis accepts. */
export type SheetsAuth = NonNullable<sheets_v4.Options['auth']>;

const ROOT = process.cwd();
export const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
export const TOKEN_PATH = path.join(ROOT, 'token.json');

/**
 * drive.file limits access to files this app created. The Sheets API accepts it on its own, so the
 * builder cannot read or change any other spreadsheet or file in the Drive.
 */
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/** In the cloud there is no token.json: this variable holds its contents instead. */
export const TOKEN_ENV = 'GOOGLE_TOKEN_JSON';

interface ClientKeys {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

async function loadSavedToken(): Promise<SheetsAuth | null> {
  const fromEnv = process.env[TOKEN_ENV];
  if (fromEnv) {
    let saved: Record<string, string>;
    try {
      saved = JSON.parse(fromEnv) as Record<string, string>;
    } catch {
      throw new Error(`${TOKEN_ENV} is not valid JSON. Paste the whole contents of token.json into it.`);
    }
    return google.auth.fromJSON(saved) as unknown as SheetsAuth;
  }
  if (!existsSync(TOKEN_PATH)) return null;
  const saved = JSON.parse(await readFile(TOKEN_PATH, 'utf8')) as Record<string, string>;
  return google.auth.fromJSON(saved) as unknown as SheetsAuth;
}

async function saveToken(refreshToken: string): Promise<void> {
  const keys = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8')) as ClientKeys;
  const key = keys.installed ?? keys.web;
  if (!key) throw new Error('credentials.json has no "installed" or "web" client');
  await writeFile(
    TOKEN_PATH,
    JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: refreshToken,
    }),
    { mode: 0o600 },
  );
}

/**
 * Returns an authorised client, opening a browser sign-in the first time.
 *
 * local-auth is used only for the browser sign-in. It bundles an older google-auth-library whose client
 * googleapis cannot use, so the client is always rebuilt from the saved refresh token.
 */
export async function getAuthClient(): Promise<SheetsAuth> {
  const saved = await loadSavedToken();
  if (saved) return saved;

  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json not found in the sheet-builder folder. Follow SETUP.md first.');
  }
  const signedIn = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  const refreshToken = signedIn.credentials.refresh_token;
  if (!refreshToken) {
    throw new Error('Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and sign in again.');
  }
  await saveToken(refreshToken);
  const client = await loadSavedToken();
  if (!client) throw new Error('token.json was not written');
  return client;
}

/** A Sheets client that rides out Google's per-minute write quota by retrying HTTP 429 with a growing delay. */
export async function getSheets(): Promise<sheets_v4.Sheets> {
  return google.sheets({
    version: 'v4',
    auth: await getAuthClient(),
    retryConfig: {
      retry: 5,
      retryDelay: 5000,
      retryDelayMultiplier: 2,
      httpMethodsToRetry: ['GET', 'POST', 'PUT'],
      statusCodesToRetry: [[429, 429]],
      onRetryAttempt: (err) => console.log(`  Google says slow down (HTTP ${err.response?.status ?? '?'}); retrying...`),
    },
  });
}
