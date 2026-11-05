import { sortedTerms } from './calc';
import { inRange, compareMonths, monthIndex } from './month';
import type { EngineInput, Month } from './types';

export interface Issue {
  code: string;
  message: string;
}

/** Input rules from spec 4.4 / 4.6 / 4.7 and amendments B-5, B-9. Returns issues; it never throws. */
export function validateInput(input: EngineInput): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const ids = new Set(input.engagements.map((e) => e.id));

  for (const e of input.engagements) {
    const terms = sortedTerms(input, e.id);
    terms.forEach((t, i) => {
      if (!(t.hours > 0)) add('TERM_HOURS', `${e.id}: term ${i + 1} must have hours > 0`);
      if (compareMonths(t.start, t.end) > 0) add('TERM_DATES', `${e.id}: term ${i + 1} ends before it starts`);
      const prev = terms[i - 1];
      if (prev && compareMonths(t.start, prev.end) <= 0) add('TERM_OVERLAP', `${e.id}: terms ${i} and ${i + 1} overlap`);
      if (t.cadence === 'Upfront' && e.type !== 'Project') add('CADENCE', `${e.id}: Upfront cadence is for Project engagements only`);
      if (e.type === 'Project' && (t.decision || i > 0)) add('PROJECT_TERMS', `${e.id}: a Project has exactly one term and no renewal fields`);
      if (t.decision) {
        if (i === 0) add('DECISION_FIRST_TERM', `${e.id}: the first term has no previous term to decide on`);
        if (compareMonths(t.decision.postingMonth, t.start) < 0) {
          add('DECISION_MONTH', `${e.id}: decision month ${t.decision.postingMonth} is before the new term starts (${t.start})`);
        }
        if (t.decision.surplusHours < 0 || t.decision.deficitHoursDeducted < 0) add('DECISION_NEGATIVE', `${e.id}: decision hours must be >= 0`);
      }
    });
    const months = terms.filter((t) => t.decision).map((t) => t.decision!.postingMonth);
    if (new Set(months).size !== months.length) add('DECISION_DUPLICATE', `${e.id}: two decisions booked in the same month`);

    // One billing row must stay inside one term (B-5), and coverage must not repeat (duplicate check).
    const bills = input.billing.filter((b) => b.engagementId === e.id);
    const covered = new Map<Month, number>();
    for (const b of bills) {
      const from = terms.findIndex((t) => inRange(b.coversFrom, t.start, t.end));
      const to = terms.findIndex((t) => inRange(b.coversTo, t.start, t.end));
      if (from < 0 || from !== to) add('BILLING_TERM', `${e.id}: invoice covering ${b.coversFrom}..${b.coversTo} must sit inside one term`);
      if (b.amountCents > 0) {
        for (let i = monthIndex(b.coversFrom); i <= monthIndex(b.coversTo); i++) {
          covered.set(String(i), (covered.get(String(i)) ?? 0) + 1);
        }
      }
    }
    for (const [k, n] of covered) if (n > 1) add('BILLING_DUPLICATE', `${e.id}: a covered month is invoiced more than once (month index ${k})`);
  }

  for (const b of input.billing) if (!ids.has(b.engagementId)) add('BILLING_UNKNOWN', `Invoice for unknown engagement ${b.engagementId}`);
  for (const d of input.delivery) {
    if (!ids.has(d.engagementId)) add('DELIVERY_UNKNOWN', `Delivery for unknown engagement ${d.engagementId}`);
  }
  return issues;
}
