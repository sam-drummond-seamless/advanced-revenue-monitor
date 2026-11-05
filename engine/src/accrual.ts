import { inRange, monthIndex, monthsInclusive, monthRange } from './month';
import { roundCents } from './money';
import type { BillingRow, Month, Term } from './types';

export const termMonths = (t: Term): number => monthsInclusive(t.start, t.end);

/** Effective rate = value / hours, kept unrounded (A-2). */
export const termRate = (t: Term): number => t.valueCents / 100 / t.hours;

/**
 * Hours the term SHOULD add in month m (spec 4.5, amended by A-2).
 * Monthly = Term Hours / Months, NOT rounded, so the term totals exactly without a true-up.
 */
export function accrualHours(t: Term, m: Month): number {
  if (!inRange(m, t.start, t.end)) return 0;
  if (t.cadence === 'Monthly') return t.hours / termMonths(t);
  return m === t.start ? t.hours : 0;
}

export function expectedBilling(t: Term, from: Month, to: Month): { hours: number; amountCents: number } {
  let hours = 0;
  const n = monthIndex(to) - monthIndex(from) + 1;
  for (const m of monthRange(from, Math.max(n, 0))) hours += accrualHours(t, m);
  return { hours, amountCents: roundCents(hours * termRate(t)) };
}

export interface BillingCheck {
  expectedHours: number;
  expectedCents: number;
  /** Typed amount minus schedule amount. */
  scheduleVarianceCents: number;
  scheduleFlag: boolean;
  /** Xero amount minus typed amount, null when no Xero amount was typed. */
  xeroVarianceCents: number | null;
  xeroFlag: boolean;
}

/** Check a typed invoice against the accrual schedule and the typed Xero amount (A-1, B-3). */
export function checkBillingRow(row: BillingRow, term: Term, toleranceCents = 5): BillingCheck {
  const exp = expectedBilling(term, row.coversFrom, row.coversTo);
  const scheduleVarianceCents = row.amountCents - exp.amountCents;
  const xeroVarianceCents = row.xeroAmountCents === undefined ? null : row.xeroAmountCents - row.amountCents;
  return {
    expectedHours: exp.hours,
    expectedCents: exp.amountCents,
    scheduleVarianceCents,
    scheduleFlag: Math.abs(scheduleVarianceCents) > toleranceCents,
    xeroVarianceCents,
    xeroFlag: xeroVarianceCents !== null && Math.abs(xeroVarianceCents) > toleranceCents,
  };
}
