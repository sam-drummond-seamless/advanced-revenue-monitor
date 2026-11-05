import { google } from 'googleapis';
import { getAuthClient, getSheets } from './auth.ts';

/**
 * Proves that sign-in, the network allowlist and the Sheets API work end to end, using a throwaway
 * sheet with no real data. It also records how real Google Sheets rounds a decimal tie, which the
 * engine's roundCents() must match.
 *
 *   npm run smoke               create the throwaway sheet, check it, leave it in your Drive
 *   npm run smoke -- --delete   same, then delete it
 */
process.on('uncaughtException', (err: Error & { status?: number }) => {
  console.error(`\nSmoke test failed${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
  process.exit(1);
});

const sheets = await getSheets();

const created = await sheets.spreadsheets.create({
  requestBody: {
    properties: { title: `ARM smoke test (synthetic) ${new Date().toISOString()}`, locale: 'en_AU', timeZone: 'Pacific/Auckland' },
  },
  fields: 'spreadsheetId',
});
const id = created.data.spreadsheetId;
if (!id) throw new Error('Sheets API did not return a spreadsheetId');
console.log(`PASS  created ${id}`);

await sheets.spreadsheets.values.update({
  spreadsheetId: id,
  range: 'Sheet1!A1:A4',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['=1+1'], ['=ROUND(1.005,2)'], ['=ROUND(-1.005,2)'], ['=EOMONTH(DATE(2026,2,1),0)']] },
});

const read = await sheets.spreadsheets.values.get({
  spreadsheetId: id,
  range: 'Sheet1!A1:A4',
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const got = (read.data.values ?? []).map((r) => r[0]);
// Sheets stores dates as serial numbers: 2026-02-28 is 46081 (days since 1899-12-30).
const expected: [string, unknown][] = [
  ['=1+1', 2],
  ['=ROUND(1.005,2)', 1.01],
  ['=ROUND(-1.005,2)', -1.01],
  ['=EOMONTH(DATE(2026,2,1),0)', 46081],
];
let failed = false;
expected.forEach(([formula, want], i) => {
  const ok = got[i] === want;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${formula} = ${JSON.stringify(got[i])}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
});

console.log(`\nhttps://docs.google.com/spreadsheets/d/${id}/edit`);

if (process.argv.includes('--delete')) {
  const drive = google.drive({ version: 'v3', auth: await getAuthClient() });
  await drive.files.delete({ fileId: id });
  console.log('Deleted the throwaway sheet.');
}
if (failed) process.exit(1);
