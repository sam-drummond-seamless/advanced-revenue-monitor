import { termRate } from './accrual';
import { addMonths, compareMonths, inRange, monthRange } from './month';
import { roundCents, snapHours } from './money';
import type {
  BillingRow,
  DeliveryRow,
  EngineInput,
  EngineResult,
  Flag,
  Month,
  MonthRow,
  Term,
} from './types';

/** Terms of one engagement sorted by start month. Row `termIndex` values refer to this order. */
export function sortedTerms(input: EngineInput, engagementId: string): Term[] {
  return input.terms
    .filter((t) => t.engagementId === engagementId)
    .sort((a, b) => compareMonths(a.start, b.start));
}

interface TermPick {
  index: number;
  term: Term;
  active: boolean;
}

/**
 * The term covering month m (spec 5). With no covering term, the most recent prior term is used (unsigned
 * renewal gap). Before the first term, the first term's rate is used so that early activity is never lost (B-8).
 */
function pickTerm(terms: Term[], m: Month): TermPick | null {
  if (terms.length === 0) return null;
  let covering = -1;
  let prior = -1;
  terms.forEach((t, i) => {
    if (inRange(m, t.start, t.end)) covering = i;
    else if (compareMonths(t.end, m) < 0) prior = i;
  });
  if (covering >= 0) return { index: covering, term: terms[covering]!, active: true };
  if (prior >= 0) return { index: prior, term: terms[prior]!, active: false };
  return { index: 0, term: terms[0]!, active: false };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

const netHours = (d: DeliveryRow): number => d.harvestHours + (d.adjustmentHours ?? 0);

/**
 * Run the monthly calculation for every engagement from the cutover month for `horizonMonths`.
 *
 * Implements spec section 5 and 6 with docs/SPEC-AMENDMENTS.md applied:
 *  - A-1  hours and invoices are placed by POSTING month; invoice $ and hours are typed values
 *  - A-2  unrounded hours, dollars = ROUND(hours x rate, 2)
 *  - A-3  breakage is released AFTER delivery is recognized (decision and close-out months)
 *  - A-4  rate changes restate hours only; dollars posted in earlier months never change
 */
export function runEngine(input: EngineInput): EngineResult {
  const { settings } = input;
  const months = monthRange(settings.cutoverMonth, settings.horizonMonths);
  const warnings: string[] = [];
  const rows: MonthRow[] = [];

  const billingBy = groupBy<BillingRow>(input.billing, (b) => `${b.engagementId}|${b.postingMonth}`);
  const deliveryBy = groupBy<DeliveryRow>(input.delivery, (d) => `${d.engagementId}|${d.postingMonth}`);
  const deliveryAll = groupBy<DeliveryRow>(input.delivery, (d) => d.engagementId);

  const hoursBetween = (engagementId: string, from: Month, to: Month): number => {
    let sum = 0;
    for (const d of deliveryAll.get(engagementId) ?? []) {
      if (inRange(d.postingMonth, from, to)) sum += netHours(d);
    }
    return sum;
  };

  for (const eng of input.engagements) {
    const terms = sortedTerms(input, eng.id);
    const opening = input.openingBalances.find((o) => o.engagementId === eng.id);
    let closing = opening?.deferredCents ?? 0;
    let closingBacklog = opening?.backlogHours ?? 0;

    const closeMonth = terms
      .map((t) => t.closeOutMonth)
      .filter((c): c is Month => c !== undefined)
      .sort(compareMonths)[0];

    for (const m of months) {
      const adds = billingBy.get(`${eng.id}|${m}`) ?? [];
      const additionsCents = adds.reduce((s, b) => s + b.amountCents, 0);
      const additionsHrs = adds.reduce((s, b) => s + b.hours, 0);
      const deliveredHrs = (deliveryBy.get(`${eng.id}|${m}`) ?? []).reduce((s, d) => s + netHours(d), 0);

      const pick = pickTerm(terms, m);
      const rate = pick ? termRate(pick.term) : null;

      const base: MonthRow = {
        engagementId: eng.id,
        month: m,
        type: eng.type,
        termIndex: pick ? pick.index : null,
        termActive: pick ? pick.active : false,
        rate,
        openingCents: closing,
        openingBacklogHrs: closingBacklog,
        renewalCarriedCents: 0,
        breakageCents: 0,
        backlogForgivenHrs: 0,
        additionsCents,
        additionsHrs,
        availableCents: closing + additionsCents,
        deliveredHrs,
        demandHrs: 0,
        recognizedCents: 0,
        recognizedHrs: 0,
        closingCents: closing,
        closingBacklogHrs: closingBacklog,
        catchUpCents: 0,
        totalRevenueCents: 0,
        decisionTermIndex: null,
        eligibleDeficitHrs: 0,
        deficitDeductedHrs: 0,
        flags: [],
      };

      // After the close-out month the engagement is Closed: balances stay at zero (spec 6.5).
      if (closeMonth !== undefined && compareMonths(m, closeMonth) > 0) {
        if (additionsCents !== 0 || deliveredHrs !== 0) {
          warnings.push(`${eng.id} ${m}: activity after close-out month ${closeMonth} was ignored`);
        }
        rows.push({ ...base, availableCents: 0, deliveredHrs: 0, additionsCents: 0, additionsHrs: 0 });
        continue;
      }

      if (!pick || rate === null) {
        if (additionsCents !== 0 || deliveredHrs !== 0 || closing !== 0 || closingBacklog !== 0) {
          warnings.push(`${eng.id} ${m}: engagement has activity but no terms`);
        }
        rows.push(base);
        continue;
      }

      // Renewal decision booked this month (spec 6.3). It sits on a later term than the first.
      let decTermIndex: number | null = null;
      terms.forEach((t, i) => {
        if (i > 0 && t.decision && t.decision.postingMonth === m && decTermIndex === null) decTermIndex = i;
      });
      const decTerm = decTermIndex === null ? null : terms[decTermIndex]!;

      let eligible = 0;
      let deducted = 0;
      let forgivenUpfront = 0;
      if (decTerm && decTerm.decision) {
        const newerDelivery = hoursBetween(eng.id, decTerm.start, addMonths(m, -1));
        eligible = Math.max(0, snapHours(closingBacklog - newerDelivery));
        deducted = Math.min(decTerm.decision.deficitHoursDeducted, eligible);
        forgivenUpfront = snapHours(eligible - deducted);
      }

      const demandHrs = snapHours(closingBacklog - forgivenUpfront + deliveredHrs);
      const availableCents = closing + additionsCents;
      const demandCents = roundCents(demandHrs * rate);
      const recognizedCents = Math.min(availableCents, demandCents);
      const fullyRecognized = recognizedCents === demandCents;
      const recognizedHrs = fullyRecognized ? demandHrs : recognizedCents / 100 / rate;
      const backlogAfterDelivery = fullyRecognized ? 0 : snapHours(Math.max(0, demandHrs - recognizedHrs));
      const remainingCents = availableCents - recognizedCents;

      let breakageCents = 0;
      let carriedCents = 0;
      let forgivenAfter = 0;

      if (decTerm && decTerm.decision) {
        // Additions are assumed consumed first, so the old balance still held after delivery is MIN(L, remaining).
        const oldRemaining = Math.min(closing, remainingCents);
        const target = roundCents(decTerm.decision.surplusHours * termRate(decTerm));
        carriedCents = Math.min(oldRemaining, target);
        breakageCents = oldRemaining - carriedCents;
      }
      if (closeMonth === m) {
        // Close-out: delivery is recognized first, then everything left is released / forgiven (A-3).
        breakageCents = remainingCents;
        carriedCents = 0;
        forgivenAfter = backlogAfterDelivery;
      }

      const closingCents = remainingCents - breakageCents;
      const closingBacklogHrs = snapHours(backlogAfterDelivery - forgivenAfter);
      const catchUpCents = Math.max(0, recognizedCents - roundCents(deliveredHrs * rate));

      // Funded = an invoice for this term (by Covers From) has been posted on or before this month.
      const funded = pick.active && input.billing.some(
        (b) =>
          b.engagementId === eng.id &&
          b.amountCents > 0 &&
          inRange(b.coversFrom, pick.term.start, pick.term.end) &&
          compareMonths(b.postingMonth, m) <= 0,
      );
      const hasWork = deliveredHrs > 0 || closingBacklogHrs > 0 || closingBacklog > 0;
      const flags: Flag[] = [];
      if (hasWork && !funded) flags.push('GOOD-FAITH');
      if (hasWork && funded && closingBacklogHrs > 0 && eng.type === 'RR') flags.push('OVER-SERVICED');
      if (catchUpCents > 0) flags.push('CATCH-UP');
      if (hasWork && funded && eng.type === 'Project' && closingBacklogHrs > 0) flags.push('PROJECT CAP');

      closing = closingCents;
      closingBacklog = closingBacklogHrs;

      rows.push({
        ...base,
        renewalCarriedCents: carriedCents,
        breakageCents,
        backlogForgivenHrs: snapHours(forgivenUpfront + forgivenAfter),
        availableCents,
        demandHrs,
        recognizedCents,
        recognizedHrs,
        closingCents,
        closingBacklogHrs,
        catchUpCents,
        totalRevenueCents: recognizedCents + breakageCents,
        decisionTermIndex: decTermIndex,
        eligibleDeficitHrs: eligible,
        deficitDeductedHrs: deducted,
        flags,
      });
    }
  }
  return { rows, warnings };
}

export function findRow(result: EngineResult, engagementId: string, month: Month): MonthRow {
  const r = result.rows.find((x) => x.engagementId === engagementId && x.month === month);
  if (!r) throw new Error(`No row for ${engagementId} ${month}`);
  return r;
}
