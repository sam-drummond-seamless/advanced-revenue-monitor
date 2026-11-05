import type { sheets_v4 } from 'googleapis';
import { getSheets } from './auth.ts';

/**
 * The one spreadsheet this builder may touch. Everything goes through this module, which:
 *  - only ever addresses SPREADSHEET_ID (callers cannot pass a different one),
 *  - cannot create spreadsheets,
 *  - refuses every batchUpdate request that deletes or clears (tabs, rows, columns, ranges, named ranges, etc.),
 *  - never uses the Drive API, so the file itself cannot be deleted or trashed.
 *
 * Override the id with the SHEET_ID environment variable.
 */
export const SPREADSHEET_ID = process.env.SHEET_ID ?? '19YGtsq2lxGI2u4U1MoEs-feNLhfhJ3GZ83t6uHSWR_Y';

/** Request kinds that remove or blank existing content. Anything starting with "delete" is also refused. */
const BLOCKED_EXACT = new Set(['cutPaste', 'trimWhitespace', 'removeDuplicates', 'clearBasicFilter', 'unmergeCells']);

export function assertNoDestructive(requests: sheets_v4.Schema$Request[]): void {
  for (const req of requests) {
    for (const kind of Object.keys(req)) {
      if (kind.startsWith('delete') || BLOCKED_EXACT.has(kind)) {
        throw new Error(`Blocked: "${kind}" is not allowed. This builder cannot delete or clear anything.`);
      }
    }
  }
}

export interface Workspace {
  readonly id: string;
  /** Tab titles and ids. */
  tabs(): Promise<{ title: string; sheetId: number }[]>;
  read(range: string, rendered?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'): Promise<unknown[][]>;
  write(range: string, values: unknown[][]): Promise<void>;
  append(range: string, values: unknown[][]): Promise<void>;
  /** Formatting, adding tabs, etc. Rejects any delete/clear request. */
  batch(requests: sheets_v4.Schema$Request[]): Promise<void>;
}

export async function getWorkspace(): Promise<Workspace> {
  const sheets = await getSheets();
  const id = SPREADSHEET_ID;
  return {
    id,
    async tabs() {
      const r = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId)' });
      return (r.data.sheets ?? []).map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? 0 }));
    },
    async read(range, rendered = 'UNFORMATTED_VALUE') {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: rendered });
      return (r.data.values ?? []) as unknown[][];
    },
    async write(range, values) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: values as sheets_v4.Schema$ValueRange['values'] },
      });
    },
    async append(range, values) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: values as sheets_v4.Schema$ValueRange['values'] },
      });
    },
    async batch(requests) {
      assertNoDestructive(requests);
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
    },
  };
}
