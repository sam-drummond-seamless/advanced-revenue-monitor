import type { sheets_v4 } from 'googleapis';
import { getWorkspace } from './workspace.ts';

/**
 * Step 1 of the workbook build: the INPUT tabs (docs/SPEC.md section 4, with docs/SPEC-AMENDMENTS.md applied).
 *
 *   npm run build-sheet
 *
 * Everything goes in ONE atomic batchUpdate, so a failure leaves the sheet untouched. The builder never deletes:
 * if any target tab already exists it stops and says so (the one exception is the blank default "Sheet1",
 * which is renamed to "Settings"). To rebuild a tab, delete it by hand in the sheet first.
 */
process.on('uncaughtException', (err: Error & { status?: number }) => {
  console.error(`\nBuild failed${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
  process.exit(1);
});

type Req = sheets_v4.Schema$Request;
type Cond = sheets_v4.Schema$BooleanCondition;

// ---------- small helpers ----------
const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const grid = (sheetId: number, r0: number, r1: number, c0: number, c1: number): sheets_v4.Schema$GridRange => ({
  sheetId,
  startRowIndex: r0,
  endRowIndex: r1,
  startColumnIndex: c0,
  endColumnIndex: c1,
});
const colA1 = (i: number) => String.fromCharCode(65 + i);

const FORMATS = {
  month: { type: 'DATE', pattern: 'yyyy-mm' },
  date: { type: 'DATE', pattern: 'yyyy-mm-dd' },
  money: { type: 'NUMBER', pattern: '#,##0.00' },
  hours: { type: 'NUMBER', pattern: '#,##0.00' },
  rate: { type: 'NUMBER', pattern: '#,##0.00##' },
  pct: { type: 'PERCENT', pattern: '0%' },
} as const;
type Fmt = keyof typeof FORMATS;

const HEADER_BG = { red: 0.12, green: 0.25, blue: 0.45 };
const CALC_BG = { red: 0.91, green: 0.92, blue: 0.94 };
const RED_BG = { red: 0.96, green: 0.8, blue: 0.8 };
const GREEN_BG = { red: 0.8, green: 0.93, blue: 0.82 };

// ---------- shared validation snippets ----------
const monthOk = (c: string) => `=OR(${c}="",AND(ISNUMBER(${c}),DAY(${c})=1))`;
const APPROVERS = ['CEO', 'COO', 'Finance'];
const list = (vals: string[]): Cond => ({ type: 'ONE_OF_LIST', values: vals.map((v) => ({ userEnteredValue: v })) });
const fromRange = (r: string): Cond => ({ type: 'ONE_OF_RANGE', values: [{ userEnteredValue: r }] });
const custom = (f: string): Cond => ({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] });
const numGte0: Cond = { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0' }] };
const anyNumber: Cond = { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '-1000000000' }, { userEnteredValue: '1000000000' }] };

interface Col {
  header: string;
  width: number;
  /** calc columns are shaded and get a warning-only protection (A-8) */
  formula?: string;
  fmt?: Fmt;
  validation?: Cond;
  /** reject bad input (default) or only warn */
  warnOnly?: boolean;
  hint?: string;
}
interface Tab {
  title: string;
  rows: number;
  cols: Col[];
  /** extra requests that need the sheetId */
  extra?: (id: number) => Req[];
  extraColumns?: number;
}

const ENG_NAMES = '=Engagements!$A$2:$A$101';
const HARVEST = '=Engagements!$E$2:$E$101';

const TABS: Tab[] = [
  {
    title: 'Clients',
    rows: 200,
    cols: [
      { header: 'Client Name', width: 260, validation: custom('=OR(A2="",COUNTIF($A$2:$A$201,A2)=1)'), hint: 'Unique. Rename clients here only.' },
    ],
  },
  {
    title: 'Engagements',
    rows: 100, // B-13: 100 engagement slots
    cols: [
      { header: 'Engagement Name', width: 260, validation: custom('=OR(A2="",COUNTIF($A$2:$A$101,A2)=1)'), hint: 'Unique. Client name, plus a suffix when needed.' },
      { header: 'Client', width: 220, validation: fromRange('=Clients!$A$2:$A$201') },
      { header: 'Type', width: 90, validation: list(['RR', 'Project']) },
      { header: 'Deferred Account', width: 120, formula: '=IF(C2="RR",Settings!$B$3,IF(C2="Project",Settings!$B$4,""))' },
      { header: 'Harvest Project', width: 260, validation: custom('=OR(E2="",COUNTIF($E$2:$E$101,E2)=1)'), hint: 'Exact Harvest project name. One Harvest project per engagement.' },
      { header: 'Status (calculated in a later step)', width: 150 },
    ],
  },
  {
    title: 'Contract_Terms',
    rows: 300,
    cols: [
      { header: 'Engagement', width: 240, validation: fromRange(ENG_NAMES) },
      { header: 'Term Start', width: 100, fmt: 'month', validation: custom(monthOk('B2')), hint: 'First of month. For a delayed renewal use the backdated start.' },
      { header: 'Term End', width: 110, fmt: 'date', validation: custom('=OR(C2="",AND(ISNUMBER(C2),C2=EOMONTH(C2,0),C2>=B2))'), hint: 'Last day of the month, on or after Term Start.' },
      { header: 'Billing Cadence', width: 120, validation: list(['Monthly', 'Annual', 'Upfront']) },
      { header: 'Term Hours', width: 90, fmt: 'hours', validation: numGte0 },
      { header: 'Effort-Based Value ($)', width: 130, fmt: 'money', validation: numGte0 },
      { header: 'Effective Rate', width: 100, fmt: 'rate', formula: '=IF(AND(ISNUMBER(E2),E2>0,ISNUMBER(F2)),F2/E2,"")' },
      { header: 'Months in Term', width: 100, formula: '=IF(AND(ISNUMBER(B2),ISNUMBER(C2)),(YEAR(C2)-YEAR(B2))*12+MONTH(C2)-MONTH(B2)+1,"")' },
      { header: 'Decision Posting Month', width: 130, fmt: 'month', validation: custom('=OR(I2="",AND(ISNUMBER(I2),DAY(I2)=1,I2>=B2))'), hint: 'Renewal decision for the PREVIOUS term. Not before this term starts (B-9).' },
      { header: '[+] Approved Surplus Hours Rolled In', width: 150, fmt: 'hours', validation: numGte0 },
      { header: '[-] Deficit Hours Deducted', width: 130, fmt: 'hours', validation: numGte0 },
      { header: 'Admin Notes / Commercial Justification', width: 300 },
      { header: 'Approved By', width: 110, validation: list(APPROVERS) },
      { header: 'Close-out Posting Month', width: 130, fmt: 'month', validation: custom(monthOk('N2')) },
    ],
    extra: (id) => {
      const eng = `INDIRECT("Engagements!$A$2:$C$101")`;
      return [
        // overlapping terms for one engagement
        cf(grid(id, 1, 301, 1, 3), `=AND($A2<>"",$B2<>"",$C2<>"",COUNTIFS($A$2:$A$301,$A2,$B$2:$B$301,"<="&$C2,$C$2:$C$301,">="&$B2)>1)`, RED_BG),
        // Upfront only for projects, projects only Upfront
        cf(
          grid(id, 1, 301, 3, 4),
          `=AND($D2<>"",$A2<>"",OR(AND($D2="Upfront",IFERROR(VLOOKUP($A2,${eng},3,FALSE),"")<>"Project"),AND($D2<>"Upfront",IFERROR(VLOOKUP($A2,${eng},3,FALSE),"")="Project")))`,
          RED_BG,
        ),
        // notes + approver required when a hours decision is entered
        cf(grid(id, 1, 301, 11, 13), `=AND(N($J2)+N($K2)>0,L2="")`, RED_BG),
      ];
    },
  },
  {
    title: 'Billing_Ledger',
    rows: 500,
    cols: [
      { header: 'Invoice Posting Month', width: 130, fmt: 'month', validation: custom(monthOk('A2')), hint: 'Month the invoice is dated in Xero. Funds count from this month.' },
      { header: 'Engagement', width: 240, validation: fromRange(ENG_NAMES) },
      { header: 'Covers From', width: 100, fmt: 'month', validation: custom(monthOk('C2')) },
      { header: 'Covers To', width: 100, fmt: 'month', validation: custom('=OR(D2="",AND(ISNUMBER(D2),DAY(D2)=1,D2>=C2))'), hint: 'One term only per row (B-5). Split a catch-up across a renewal.' },
      { header: 'Hours Added', width: 100, fmt: 'hours', validation: anyNumber, hint: 'Typed from the invoice (A-1). Negative for credit notes (B-6).' },
      { header: 'Amount Added ($)', width: 120, fmt: 'money', validation: anyNumber, hint: 'Typed value. Dollars = ROUND(hours x rate, 2).' },
      { header: 'Xero Invoice #', width: 120 },
      { header: 'Xero Effort-Based Amount ($)', width: 150, fmt: 'money', validation: anyNumber },
      { header: 'Variance', width: 90, fmt: 'money', formula: '=IF(OR(H2="",F2=""),"",ROUND(H2-F2,2))' },
      {
        header: 'Duplicate Check',
        width: 120,
        formula: '=IF(OR(B2="",C2="",D2="",N(F2)<=0),"",IF(COUNTIFS($B$2:$B$501,B2,$C$2:$C$501,"<="&D2,$D$2:$D$501,">="&C2,$F$2:$F$501,">0")>1,"DUPLICATE",""))',
      },
    ],
    extra: (id) => [
      // red only above the tolerance in Settings (B-3)
      cf(grid(id, 1, 501, 8, 9), `=AND(ISNUMBER($I2),ABS($I2)>INDIRECT("Settings!$B$11"))`, RED_BG),
      cf(grid(id, 1, 501, 9, 10), `=$J2="DUPLICATE"`, RED_BG),
    ],
  },
  {
    title: 'Delivery_Ledger',
    rows: 3000,
    cols: [
      { header: 'Delivery Month', width: 110, fmt: 'month', validation: custom(monthOk('A2')) },
      { header: 'Posting Month', width: 110, fmt: 'month', validation: custom('=OR(B2="",AND(ISNUMBER(B2),DAY(B2)=1,B2>=A2))'), hint: 'Month the hours are booked. Corrections to a closed month go in the current open month (A-1).' },
      { header: 'Harvest Project', width: 260, validation: fromRange(HARVEST) },
      {
        header: 'Engagement',
        width: 240,
        formula: '=IF(C2="","",IFERROR(INDEX(Engagements!$A$2:$A$101,MATCH(C2,Engagements!$E$2:$E$101,0)),"UNMAPPED"))',
      },
      { header: 'Harvest Billable Hours', width: 130, fmt: 'hours', validation: numGte0 },
      { header: 'Manual Adjustment Hours', width: 140, fmt: 'hours', validation: anyNumber },
      { header: 'Adjustment Reason', width: 280 },
      { header: 'Approved By', width: 110, validation: list(APPROVERS) },
      { header: 'Net Delivered Hours', width: 120, fmt: 'hours', formula: '=IF(AND(E2="",F2=""),"",N(E2)+N(F2))' },
    ],
    extra: (id) => [
      cf(grid(id, 1, 3001, 6, 8), `=AND(N($F2)<>0,G2="")`, RED_BG),
      cf(grid(id, 1, 3001, 3, 4), `=$D2="UNMAPPED"`, RED_BG),
    ],
  },
  {
    title: 'Opening_Balances',
    rows: 100,
    extraColumns: 12,
    cols: [
      { header: 'Engagement', width: 240, validation: fromRange(ENG_NAMES) },
      { header: 'Opening Deferred $', width: 130, fmt: 'money', validation: numGte0 },
      { header: 'Opening Backlog Hours', width: 130, fmt: 'hours', validation: numGte0 },
      { header: 'Term Hours Consumed Before Cutover', width: 170, fmt: 'hours', validation: numGte0 },
      { header: 'Term Hours Invoiced Before Cutover', width: 170, fmt: 'hours', validation: numGte0 },
      { header: 'Type', width: 80, formula: '=IFERROR(VLOOKUP(A2,Engagements!$A$2:$C$101,3,FALSE),"")' },
    ],
    extra: (id) => {
      const text = (s: string, bold = false): sheets_v4.Schema$CellData => ({ userEnteredValue: { stringValue: s }, userEnteredFormat: bold ? { textFormat: { bold: true } } : undefined });
      const f = (s: string, fmt?: Fmt): sheets_v4.Schema$CellData => ({ userEnteredValue: { formulaValue: s }, userEnteredFormat: fmt ? { numberFormat: FORMATS[fmt] } : undefined });
      return [
        {
          updateCells: {
            range: grid(id, 0, 3, 7, 12),
            fields: 'userEnteredValue,userEnteredFormat',
            rows: [
              { values: ['Control check (S8)', 'Sum of Opening $', 'Xero balance', 'Difference', 'Status'].map((s) => text(s, true)) },
              { values: [text('102 (RR)'), f('=SUMIF($F$2:$F$101,"RR",$B$2:$B$101)', 'money'), f('=Settings!$B$13', 'money'), f('=ROUND(I2-J2,2)', 'money'), f('=IF(K2=0,"TIES","DOES NOT TIE")')] },
              { values: [text('200 (Projects)'), f('=SUMIF($F$2:$F$101,"Project",$B$2:$B$101)', 'money'), f('=Settings!$B$14', 'money'), f('=ROUND(I3-J3,2)', 'money'), f('=IF(K3=0,"TIES","DOES NOT TIE")')] },
            ],
          },
        },
        cf(grid(id, 1, 3, 11, 12), `=$L2="DOES NOT TIE"`, RED_BG),
        cf(grid(id, 1, 3, 11, 12), `=$L2="TIES"`, GREEN_BG),
        { updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: 7, endIndex: 12 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
      ];
    },
  },
];

function cf(range: sheets_v4.Schema$GridRange, formula: string, bg: { red: number; green: number; blue: number }): Req {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [range],
        booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: { backgroundColor: bg } },
      },
    },
  };
}

const headerCell = (s: string): sheets_v4.Schema$CellData => ({
  userEnteredValue: { stringValue: s },
  userEnteredFormat: {
    backgroundColor: HEADER_BG,
    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
    wrapStrategy: 'WRAP',
    verticalAlignment: 'MIDDLE',
  },
});

// ---------- Settings (label / value / notes, not a table) ----------
type SettingRow = { label: string; value?: number | string; fmt?: Fmt; note: string; validation?: Cond };
const SETTINGS: SettingRow[] = [
  { label: 'Default rate', value: 220, fmt: 'money', note: 'Pre-fills new terms only. Never used in calculations.', validation: numGte0 }, // row 2
  { label: 'RR deferred account', value: 102, note: '' }, // 3
  { label: 'Project deferred account', value: 200, note: '' }, // 4
  { label: 'Earned revenue account', value: 801, note: 'Credit side for both journals.' }, // 5
  { label: 'Cutover month', value: serial(2026, 7, 1), fmt: 'month', note: 'First month the tracker calculates. First of month.', validation: custom(monthOk('B6')) }, // 6
  { label: 'Calc horizon (months)', value: 60, note: 'Months Calc_Engine generates from cutover. Start a new cutover before the horizon ends (B-13).', validation: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '1' }, { userEnteredValue: '120' }] } }, // 7
  { label: 'Last closed month', fmt: 'month', note: 'Finance sets this after posting each month (spec 8.1).', validation: custom(monthOk('B8')) }, // 8
  { label: 'Burn alert threshold 1', value: 0.5, fmt: 'pct', note: '50% Milestone.', validation: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '0' }, { userEnteredValue: '1' }] } }, // 9
  { label: 'Burn alert threshold 2', value: 0.8, fmt: 'pct', note: '80% Exhaustion Warning.', validation: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '0' }, { userEnteredValue: '1' }] } }, // 10
  { label: 'Billing variance tolerance ($)', value: 0.05, fmt: 'money', note: 'Variance is red only above this (B-3).', validation: numGte0 }, // 11
  { label: 'As-of date', value: '=TODAY()', fmt: 'date', note: 'Used by AM_Pace_Monitoring. Overwrite with a fixed date to test (B-12).' }, // 12
  { label: 'Xero balance at cutover: 102', fmt: 'money', note: 'For the cutover control check on Opening_Balances.' }, // 13
  { label: 'Xero balance at cutover: 200', fmt: 'money', note: '' }, // 14
];

// ---------- build ----------
const ws = await getWorkspace();
const existing = await ws.tabs();
const has = (t: string) => existing.some((e) => e.title === t);

const sheet1 = existing.find((e) => e.title === 'Sheet1');
const blockers = TABS.map((t) => t.title).filter((t) => has(t));
if (has('Settings')) blockers.push('Settings');
if (blockers.length) {
  console.error(`Stopped: these tabs already exist: ${blockers.join(', ')}.\nThis builder never deletes or overwrites tabs. Delete them by hand in the sheet if you want a rebuild.`);
  process.exit(1);
}

// pre-assigned ids so every later request in the same batch can refer to its tab
let nextId = 1000;
const ids: Record<string, number> = {};
const requests: Req[] = [];

// Settings: rename the blank default tab, or add a new one
if (sheet1) {
  ids.Settings = sheet1.sheetId;
  requests.push({ updateSheetProperties: { properties: { sheetId: sheet1.sheetId, title: 'Settings', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } });
} else {
  ids.Settings = nextId++;
  requests.push({ addSheet: { properties: { sheetId: ids.Settings, title: 'Settings', gridProperties: { rowCount: 50, columnCount: 3, frozenRowCount: 1 } } } });
}
const sid = ids.Settings;
requests.push({
  updateCells: {
    range: grid(sid, 0, SETTINGS.length + 1, 0, 3),
    fields: 'userEnteredValue,userEnteredFormat',
    rows: [
      { values: ['Field', 'Value', 'Notes'].map(headerCell) },
      ...SETTINGS.map((s): sheets_v4.Schema$RowData => ({
        values: [
          { userEnteredValue: { stringValue: s.label }, userEnteredFormat: { textFormat: { bold: true } } },
          {
            userEnteredValue:
              s.value === undefined ? undefined : typeof s.value === 'string' ? { formulaValue: s.value } : { numberValue: s.value },
            userEnteredFormat: { numberFormat: s.fmt ? FORMATS[s.fmt] : undefined, horizontalAlignment: 'RIGHT' },
          },
          { userEnteredValue: { stringValue: s.note }, userEnteredFormat: { textFormat: { foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } },
        ],
      })),
    ],
  },
});
SETTINGS.forEach((s, i) => {
  if (!s.validation) return;
  requests.push({
    setDataValidation: { range: grid(sid, i + 1, i + 2, 1, 2), rule: { condition: s.validation, strict: true, showCustomUi: true } },
  });
});
requests.push(
  { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 560 }, fields: 'pixelSize' } },
  {
    addProtectedRange: {
      protectedRange: {
        range: grid(sid, 0, SETTINGS.length + 1, 0, 3),
        description: 'Caution: This cell contains core revenue recognition logic. Edit only with Finance/COO authorization.',
        warningOnly: true,
      },
    },
  },
);

for (const tab of TABS) {
  const id = nextId++;
  ids[tab.title] = id;
  const nCols = tab.extraColumns ?? tab.cols.length;
  requests.push({
    addSheet: { properties: { sheetId: id, title: tab.title, gridProperties: { rowCount: tab.rows + 1, columnCount: nCols, frozenRowCount: 1 } } },
  });
  // header row
  requests.push({
    updateCells: { range: grid(id, 0, 1, 0, tab.cols.length), fields: 'userEnteredValue,userEnteredFormat', rows: [{ values: tab.cols.map((c) => headerCell(c.header)) }] },
  });
  requests.push({
    updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 48 }, fields: 'pixelSize' },
  });

  tab.cols.forEach((c, i) => {
    const range = grid(id, 1, tab.rows + 1, i, i + 1);
    const fields: string[] = [];
    const cell: sheets_v4.Schema$CellData = { userEnteredFormat: {} };
    if (c.formula) {
      cell.userEnteredValue = { formulaValue: c.formula };
      fields.push('userEnteredValue');
    }
    if (c.fmt) {
      cell.userEnteredFormat!.numberFormat = FORMATS[c.fmt];
      fields.push('userEnteredFormat.numberFormat');
    }
    if (c.formula || c.header.startsWith('Status')) {
      cell.userEnteredFormat!.backgroundColor = CALC_BG;
      fields.push('userEnteredFormat.backgroundColor');
    }
    if (fields.length) requests.push({ repeatCell: { range, cell, fields: fields.join(',') } });
    if (c.validation) {
      requests.push({
        setDataValidation: {
          range,
          rule: { condition: c.validation, strict: !c.warnOnly, showCustomUi: true, inputMessage: c.hint },
        },
      });
    }
    requests.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width }, fields: 'pixelSize' } });
    if (c.formula) {
      requests.push({
        addProtectedRange: {
          protectedRange: {
            range,
            description: 'Caution: This cell contains core revenue recognition logic. Edit only with Finance/COO authorization.',
            warningOnly: true,
          },
        },
      });
    }
  });
  if (tab.extra) requests.push(...tab.extra(id));
}

console.log(`Sending ${requests.length} requests in one batch...`);
await ws.batch(requests);
console.log('PASS  batchUpdate applied');

// ---------- read-back checks ----------
const check = async (name: string, range: string, want: (v: unknown[][]) => boolean, mode: 'FORMULA' | 'UNFORMATTED_VALUE' = 'FORMULA') => {
  const v = await ws.read(range, mode);
  const ok = want(v);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(v)}`);
  return ok;
};
const results = [
  await check('Settings values', 'Settings!A2:B7', (v) => v[0]?.[1] === 220 && v[5]?.[1] === 60 && v[4]?.[1] === serial(2026, 7, 1), 'UNFORMATTED_VALUE'),
  await check('Engagements!D3 fills down', 'Engagements!D3', (v) => String(v[0]?.[0]).includes('C3')),
  await check('Contract_Terms!G3:H3 fill down', 'Contract_Terms!G3:H3', (v) => String(v[0]?.[0]).includes('E3') && String(v[0]?.[1]).includes('B3')),
  await check('Billing_Ledger!I3:J3 fill down', 'Billing_Ledger!I3:J3', (v) => String(v[0]?.[0]).includes('H3') && String(v[0]?.[1]).includes('B3')),
  await check('Delivery_Ledger!D3,I3 fill down', 'Delivery_Ledger!D3:I3', (v) => String(v[0]?.[0]).includes('C3') && String(v[0]?.[5]).includes('E3')),
  await check('Opening_Balances!F3 fills down', 'Opening_Balances!F3', (v) => String(v[0]?.[0]).includes('A3')),
  await check('Opening_Balances control block', 'Opening_Balances!H2:L3', (v) => v[0]?.[4] === 'TIES' && v[1]?.[4] === 'TIES', 'UNFORMATTED_VALUE'),
];
console.log(`\nhttps://docs.google.com/spreadsheets/d/${ws.id}/edit`);
if (results.some((r) => !r)) process.exit(1);
