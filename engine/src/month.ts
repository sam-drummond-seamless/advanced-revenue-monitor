import type { Month } from './types';

const RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Months since year 0, so months can be compared and stepped as integers. */
export function monthIndex(m: Month): number {
  const x = RE.exec(m);
  if (!x) throw new Error(`Invalid month "${m}", expected YYYY-MM`);
  return Number(x[1]) * 12 + Number(x[2]) - 1;
}

export function monthFromIndex(i: number): Month {
  const y = Math.floor(i / 12);
  const mo = (i % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`;
}

export const addMonths = (m: Month, n: number): Month => monthFromIndex(monthIndex(m) + n);

export const compareMonths = (a: Month, b: Month): number => monthIndex(a) - monthIndex(b);

/** Number of calendar months from start to end, both inclusive. */
export const monthsInclusive = (start: Month, end: Month): number => monthIndex(end) - monthIndex(start) + 1;

export function monthRange(start: Month, count: number): Month[] {
  const out: Month[] = [];
  for (let i = 0; i < count; i++) out.push(addMonths(start, i));
  return out;
}

export const inRange = (m: Month, from: Month, to: Month): boolean =>
  compareMonths(m, from) >= 0 && compareMonths(m, to) <= 0;
