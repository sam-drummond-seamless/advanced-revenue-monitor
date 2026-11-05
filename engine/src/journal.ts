import type { EngagementType, EngineInput, EngineResult, Month } from './types';

export interface JournalLine {
  account: number;
  description: string;
  debitCents: number;
  creditCents: number;
}

export interface Journal {
  kind: EngagementType;
  month: Month;
  /** Empty when the month has no revenue for this type: a zero line is hidden (spec 7). */
  lines: JournalLine[];
  totalCents: number;
  balanced: boolean;
  /** B-2: the debit must not exceed what the engagements could release (Opening + Additions). */
  debitWithinFunds: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (m: Month): string => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * Two separate journals per month (A-7): RR (Dr 102 / Cr 801) and Projects (Dr 200 / Cr 801).
 * Each is aggregated across engagements and balances on its own.
 */
export function journalsForMonth(input: EngineInput, result: EngineResult, month: Month): { RR: Journal; Project: Journal } {
  const s = input.settings;
  const earned = s.earnedAccount ?? 801;
  const build = (kind: EngagementType): Journal => {
    const rows = result.rows.filter((r) => r.month === month && r.type === kind);
    const total = rows.reduce((sum, r) => sum + r.totalRevenueCents, 0);
    const funds = rows.reduce((sum, r) => sum + r.openingCents + r.additionsCents, 0);
    const deferred = kind === 'RR' ? (s.rrDeferredAccount ?? 102) : (s.projectDeferredAccount ?? 200);
    const desc = kind === 'RR' ? 'Release of deferred RR' : 'Release of deferred projects';
    const lines: JournalLine[] =
      total === 0
        ? []
        : [
            { account: deferred, description: `${desc} — ${label(month)}`, debitCents: total, creditCents: 0 },
            { account: earned, description: `Advanced revenue earned — ${label(month)}`, debitCents: 0, creditCents: total },
          ];
    const debit = lines.reduce((x, l) => x + l.debitCents, 0);
    const credit = lines.reduce((x, l) => x + l.creditCents, 0);
    return { kind, month, lines, totalCents: total, balanced: debit === credit, debitWithinFunds: debit <= funds };
  };
  return { RR: build('RR'), Project: build('Project') };
}
