import { sortedTerms } from './calc';
import { inRange, monthIndex, monthsInclusive, addMonths } from './month';
import { round6 } from './money';
import { termMonths } from './accrual';
import type { EngineInput, EngineResult, Month } from './types';

export type BurnTag = 'NONE' | 'MILESTONE_50' | 'WARNING_80' | 'EXHAUSTED';

export interface BurnResult {
  entitlementHrs: number;
  consumedHrs: number;
  burnPct: number;
  timeElapsedPct: number;
  /** Burn % minus time elapsed %; positive = ahead of the calendar. */
  paceGap: number;
  tag: BurnTag;
  /** Whole months until entitlement is used at the trailing 3-month average, null if there is no recent delivery. */
  runOutMonths: number | null;
}

/** Tag from a burn fraction. Compared at 6 dp so exactly 50.00% and 80.00% trigger (S6). */
export function burnTag(burn: number, milestone = 0.5, warning = 0.8): BurnTag {
  const b = round6(burn);
  if (b >= 1) return 'EXHAUSTED';
  if (b >= round6(warning)) return 'WARNING_80';
  if (b >= round6(milestone)) return 'MILESTONE_50';
  return 'NONE';
}

/** Burn rate and pace for one term as of month `asOf` (spec 6.7). */
export function burnForTerm(
  input: EngineInput,
  result: EngineResult,
  engagementId: string,
  termIndex: number,
  asOf: Month,
): BurnResult {
  const terms = sortedTerms(input, engagementId);
  const term = terms[termIndex];
  if (!term) throw new Error(`No term ${termIndex} for ${engagementId}`);

  const surplus = term.decision && monthIndex(term.decision.postingMonth) <= monthIndex(asOf) ? term.decision.surplusHours : 0;
  const entitlementHrs = term.hours + surplus;

  const deducted = result.rows
    .filter((r) => r.engagementId === engagementId && r.decisionTermIndex === termIndex && monthIndex(r.month) <= monthIndex(asOf))
    .reduce((s, r) => s + r.deficitDeductedHrs, 0);

  const through = monthIndex(asOf) < monthIndex(term.end) ? asOf : term.end;
  let delivered = 0;
  let recent = 0;
  for (const d of input.delivery) {
    if (d.engagementId !== engagementId) continue;
    const net = d.harvestHours + (d.adjustmentHours ?? 0);
    if (inRange(d.postingMonth, term.start, through)) delivered += net;
    if (inRange(d.postingMonth, addMonths(asOf, -2), asOf)) recent += net;
  }

  const opening = input.openingBalances.find((o) => o.engagementId === engagementId);
  const coversCutover = inRange(input.settings.cutoverMonth, term.start, term.end);
  const pre = coversCutover ? (opening?.termHoursConsumedBeforeCutover ?? 0) : 0;

  const consumedHrs = deducted + delivered + pre;
  const burnPct = entitlementHrs > 0 ? consumedHrs / entitlementHrs : 0;
  const elapsed = Math.min(Math.max(monthsInclusive(term.start, asOf), 0), termMonths(term));
  const timeElapsedPct = elapsed / termMonths(term);
  const avg = recent / 3;
  const remaining = entitlementHrs - consumedHrs;

  return {
    entitlementHrs,
    consumedHrs,
    burnPct,
    timeElapsedPct,
    paceGap: burnPct - timeElapsedPct,
    tag: burnTag(burnPct, input.settings.burnMilestone, input.settings.burnWarning),
    runOutMonths: avg > 0 ? Math.max(0, remaining) / avg : null,
  };
}
