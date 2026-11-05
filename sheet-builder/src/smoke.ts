import { getWorkspace } from './workspace.ts';

/**
 * Proves that sign-in, the network allowlist and the Sheets API work end to end against the workspace
 * spreadsheet, using a "smoke" tab. It also records how real Google Sheets rounds a decimal tie, which
 * the engine's roundCents() must match. Nothing is created or deleted except that tab's cell values,
 * which are overwritten on each run.
 *
 *   npm run smoke
 */
process.on('uncaughtException', (err: Error & { status?: number }) => {
  console.error(`\nSmoke test failed${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
  process.exit(1);
});

const ws = await getWorkspace();

if (!(await ws.tabs()).some((t) => t.title === 'smoke')) {
  await ws.batch([{ addSheet: { properties: { title: 'smoke' } } }]);
}
console.log(`PASS  reached workspace ${ws.id}`);

await ws.write('smoke!A1:A4', [['=1+1'], ['=ROUND(1.005,2)'], ['=ROUND(-1.005,2)'], ['=EOMONTH(DATE(2026,2,1),0)']]);
const got = (await ws.read('smoke!A1:A4')).map((r) => r[0]);

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

console.log(`\nhttps://docs.google.com/spreadsheets/d/${ws.id}/edit`);
if (failed) process.exit(1);
