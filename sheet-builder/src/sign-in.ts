import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { TOKEN_PATH, getAuthClient } from './auth.ts';

/**
 * One-time sign-in, run on your own machine. Opens a browser, saves token.json.
 *   npm run sign-in           sign in (or confirm you already have)
 *   npm run show-token        print token.json as ONE line, ready to paste into GOOGLE_TOKEN_JSON
 */
if (process.argv.includes('--print')) {
  if (!existsSync(TOKEN_PATH)) {
    console.error('No token.json yet. Run: npm run sign-in');
    process.exit(1);
  }
  const saved: unknown = JSON.parse(await readFile(TOKEN_PATH, 'utf8'));
  // Printed on purpose so it can be pasted into the environment's settings. Never paste it into a chat.
  console.log(JSON.stringify(saved));
  process.exit(0);
}

if (existsSync(TOKEN_PATH)) {
  console.log('token.json already exists, so you are signed in. Delete it and run this again to sign in afresh.');
  process.exit(0);
}

await getAuthClient();
console.log('Signed in. token.json was saved. Next: npm run show-token, then follow SETUP.md step 5.');
