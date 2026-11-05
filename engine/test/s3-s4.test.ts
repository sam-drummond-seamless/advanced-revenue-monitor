import { describe, expect, it } from 'vitest';
import { burnForTerm, findRow, journalsForMonth, validateInput } from '../src';
import { $, bill, deliver, input, run, term } from './helpers';

const eng = [{ id: 'rr3', type: 'RR' as const }];
const oldTerm = term({ engagementId: 'rr3', start: '2025-08', end: '2026-07' });

/** S3 - Renewal with partial deficit forgiveness. */
describe('S3 renewal with partial deficit forgiveness', () => {
  const mk = (decisionMonth: string, deducted: number, billing = [bill('rr3', '2026-08', 4, 880)], delivery = [deliver('rr3', '2026-08', 3)]) =>
    input(
      {
        engagements: eng,
        terms: [oldTerm, term({ engagementId: 'rr3', start: '2026-08', end: '2027-07', decision: { postingMonth: decisionMonth, surplusHours: 0, deficitHoursDeducted: deducted } })],
        billing,
        delivery,
        openingBalances: [{ engagementId: 'rr3', deferredCents: 0, backlogHours: 6 }],
      },
      '2026-08',
      3,
    );

  it('deducts 4 hrs and forgives 2: demand 7, recognized $880, backlog 3, consumed 7', () => {
    const inp = mk('2026-08', 4);
    const res = run(inp);
    const r = findRow(res, 'rr3', '2026-08');
    expect(r.eligibleDeficitHrs).toBe(6);
    expect(r.deficitDeductedHrs).toBe(4);
    expect(r.backlogForgivenHrs).toBe(2);
    expect(r.demandHrs).toBe(7);
    expect(r.recognizedCents).toBe($(880));
    expect(r.closingBacklogHrs).toBe(3);
    expect(r.flags).toEqual(['OVER-SERVICED', 'CATCH-UP']);
    expect(r.totalRevenueCents).toBe($(880)); // forgiven hours never produce revenue
    const burn = burnForTerm(inp, res, 'rr3', 1, '2026-08');
    expect(burn.consumedHrs).toBe(7); // 4 deducted + 3 delivered
    expect(burn.entitlementHrs).toBe(48);
  });

  it('caps the deduction at the eligible deficit', () => {
    const r = findRow(run(mk('2026-08', 10)), 'rr3', '2026-08');
    expect(r.deficitDeductedHrs).toBe(6);
    expect(r.backlogForgivenHrs).toBe(0);
    expect(r.demandHrs).toBe(9);
  });

  it('keeps good-faith hours worked in the new term when the decision is booked later', () => {
    // Aug: 6 old backlog + 3 new hours, $880 clears the OLDEST 4 hrs first -> backlog 5.
    // Sep decision: eligible = 5 - 3 (delivered since the new term start) = 2, never 5.
    const inp = mk('2026-09', 1, [bill('rr3', '2026-08', 4, 880), bill('rr3', '2026-09', 4, 880)], [deliver('rr3', '2026-08', 3)]);
    const res = run(inp);
    expect(findRow(res, 'rr3', '2026-08').closingBacklogHrs).toBe(5);
    const sep = findRow(res, 'rr3', '2026-09');
    expect(sep.eligibleDeficitHrs).toBe(2);
    expect(sep.deficitDeductedHrs).toBe(1);
    expect(sep.backlogForgivenHrs).toBe(1);
    expect(sep.demandHrs).toBe(4);
    expect(sep.recognizedCents).toBe($(880));
    expect(sep.closingBacklogHrs).toBe(0);
  });

  it('does nothing until the decision is booked', () => {
    const inp = input(
      { engagements: eng, terms: [oldTerm, term({ engagementId: 'rr3', start: '2026-08', end: '2027-07' })], billing: [bill('rr3', '2026-08', 4, 880)], delivery: [deliver('rr3', '2026-08', 3)], openingBalances: [{ engagementId: 'rr3', deferredCents: 0, backlogHours: 6 }] },
      '2026-08',
      2,
    );
    const r = findRow(run(inp), 'rr3', '2026-08');
    expect(r.backlogForgivenHrs).toBe(0);
    expect(r.demandHrs).toBe(9);
    expect(r.closingBacklogHrs).toBe(5);
  });

  it('rejects a decision booked before the new term starts (B-9)', () => {
    const issues = validateInput(mk('2026-07', 4));
    expect(issues.map((i) => i.code)).toContain('DECISION_MONTH');
  });
});

/** S4 - Renewal with surplus carryover and rate change. */
describe('S4 renewal with surplus carryover and rate change', () => {
  const newTerm = (surplus: number) =>
    term({ engagementId: 'rr3', start: '2026-08', end: '2027-07', hours: 48, valueCents: $(12000), decision: { postingMonth: '2026-08', surplusHours: surplus, deficitHoursDeducted: 0 } });
  const mk = (surplus: number, delivery = [] as ReturnType<typeof deliver>[]) =>
    input({ engagements: eng, terms: [oldTerm, newTerm(surplus)], delivery, openingBalances: [{ engagementId: 'rr3', deferredCents: $(1100), backlogHours: 0 }] }, '2026-08', 3);

  it('carries MIN(1,100, 4 x 250) = $1,000 and releases $100 breakage', () => {
    const inp = mk(4);
    const res = run(inp);
    const r = findRow(res, 'rr3', '2026-08');
    expect(r.rate).toBe(250);
    expect(r.renewalCarriedCents).toBe($(1000));
    expect(r.breakageCents).toBe($(100));
    expect(r.closingCents).toBe($(1000));
    expect(r.totalRevenueCents).toBe($(100));
    expect(burnForTerm(inp, res, 'rr3', 1, '2026-08').entitlementHrs).toBe(52);
    const j = journalsForMonth(inp, res, '2026-08');
    expect(j.RR.lines.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([[102, $(100), 0], [801, 0, $(100)]]);
    expect(j.RR.balanced && j.RR.debitWithinFunds).toBe(true);
    // The carried balance stays put in later months.
    expect(findRow(res, 'rr3', '2026-09').openingCents).toBe($(1000));
    expect(findRow(res, 'rr3', '2026-09').totalRevenueCents).toBe(0);
  });

  it('carries everything when approved surplus is worth more than the balance', () => {
    const r = findRow(run(mk(6)), 'rr3', '2026-08'); // 6 x 250 = 1,500 > 1,100
    expect(r.renewalCarriedCents).toBe($(1100));
    expect(r.breakageCents).toBe(0);
  });

  it('releases the whole balance when no surplus is approved', () => {
    const r = findRow(run(mk(0)), 'rr3', '2026-08');
    expect(r.breakageCents).toBe($(1100));
    expect(r.closingCents).toBe(0);
  });

  it('A-3: delivery in the decision month is recognized first, breakage comes from what is left', () => {
    // 2 hrs at $250 = $500 consumed from the $1,100 balance; $600 left, below the $1,000 target, so all of it is carried.
    const r = findRow(run(mk(4, [deliver('rr3', '2026-08', 2)])), 'rr3', '2026-08');
    expect(r.recognizedCents).toBe($(500));
    expect(r.renewalCarriedCents).toBe($(600));
    expect(r.breakageCents).toBe(0);
    expect(r.closingCents).toBe($(600));
  });
});
