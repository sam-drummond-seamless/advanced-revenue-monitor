import { describe, expect, it } from 'vitest';
import {
  accrualHours,
  addMonths,
  checkBillingRow,
  engagementStatus,
  expectedBilling,
  findRow,
  monthIndex,
  roundCents,
  runEngine,
  termMonths,
  validateInput,
} from '../src';
import { $, assertInvariants, bill, deliver, input, run, term } from './helpers';

describe('rounding (matches Sheets ROUND half away from zero)', () => {
  it.each([
    [1.005, 101],
    [-1.005, -101],
    [2.675, 268],
    [916.6666666667, 91667],
    [0.004, 0],
    [0, 0],
  ])('roundCents(%s) = %s', (x, c) => expect(roundCents(x)).toBe(c));
});

describe('months', () => {
  it('steps across year ends and rejects bad input', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(() => monthIndex('2026-13')).toThrow();
    expect(() => monthIndex('2026/01')).toThrow();
  });
});

describe('accrual schedule (A-2: unrounded)', () => {
  const t = term({ engagementId: 'a', start: '2026-01', end: '2026-12', hours: 50, valueCents: $(11000) });
  it('monthly accrual is hours / months with no 4.17 x 12 drift', () => {
    expect(termMonths(t)).toBe(12);
    expect(accrualHours(t, '2026-06')).toBeCloseTo(50 / 12, 12);
    const whole = expectedBilling(t, '2026-01', '2026-12');
    expect(whole.hours).toBeCloseTo(50, 9);
    expect(whole.amountCents).toBe($(11000));
  });
  it('annual and upfront accrue everything in the start month', () => {
    const annual = { ...t, cadence: 'Annual' as const };
    expect(accrualHours(annual, '2026-01')).toBe(50);
    expect(accrualHours(annual, '2026-02')).toBe(0);
  });
  it('a monthly invoice of $916.67 sits within the 5 cent tolerance; $917.40 does not (B-3)', () => {
    const ok = checkBillingRow({ ...bill('a', '2026-01', 50 / 12, 916.67), xeroAmountCents: $(916.67) }, t);
    expect(ok.expectedCents).toBe(91667);
    expect(ok.scheduleFlag).toBe(false);
    expect(ok.xeroFlag).toBe(false);
    const bad = checkBillingRow({ ...bill('a', '2026-01', 4.17, 917.4), xeroAmountCents: $(916.67) }, t);
    expect(bad.scheduleFlag).toBe(true);
    expect(bad.xeroFlag).toBe(true);
  });
});

describe('twelve monthly invoices of $916.67', () => {
  it('leave a few cents of deferred balance that never goes negative', () => {
    const months = Array.from({ length: 12 }, (_, i) => addMonths('2026-01', i));
    const inp = input({
      engagements: [{ id: 'a', type: 'RR' }],
      terms: [term({ engagementId: 'a', start: '2026-01', end: '2026-12', hours: 50, valueCents: $(11000) })],
      billing: months.map((m) => bill('a', m, 50 / 12, 916.67)),
      delivery: months.map((m) => deliver('a', m, 50 / 12)),
    }, '2026-01', 12);
    const res = run(inp);
    const last = findRow(res, 'a', '2026-12');
    expect(last.closingBacklogHrs).toBe(0);
    expect(last.closingCents).toBe(0); // delivery of 50/12 hrs x $220 rounds to $916.67 each month
  });
});

describe('status (A-6: no escalation limit)', () => {
  const inp = input({
    engagements: [{ id: 'a', type: 'RR' }, { id: 'b', type: 'RR' }],
    terms: [
      term({ engagementId: 'a', start: '2025-08', end: '2026-07' }),
      term({ engagementId: 'b', start: '2025-08', end: '2026-07', closeOutMonth: '2026-09' }),
    ],
  });
  it('derives Active, Awaiting Renewal and Closed', () => {
    expect(engagementStatus(inp, 'a', '2026-05')).toBe('Active');
    expect(engagementStatus(inp, 'a', '2026-08')).toBe('Awaiting Renewal');
    expect(engagementStatus(inp, 'a', '2030-01')).toBe('Awaiting Renewal');
    expect(engagementStatus(inp, 'b', '2026-08')).toBe('Awaiting Renewal');
    expect(engagementStatus(inp, 'b', '2026-09')).toBe('Closed');
  });
});

describe('validation', () => {
  const eng = [{ id: 'a', type: 'RR' as const }, { id: 'p', type: 'Project' as const }];
  const codes = (i: Parameters<typeof validateInput>[0]) => validateInput(i).map((x) => x.code);
  it('flags overlapping terms, bad cadence, project renewals, cross-term and duplicate invoices', () => {
    const inp = input({
      engagements: eng,
      terms: [
        term({ engagementId: 'a', start: '2026-01', end: '2026-12' }),
        term({ engagementId: 'a', start: '2026-12', end: '2027-11' }),
        term({ engagementId: 'a', start: '2028-01', end: '2028-12', cadence: 'Upfront' }),
        term({ engagementId: 'p', start: '2026-01', end: '2026-12', cadence: 'Upfront' }),
        term({ engagementId: 'p', start: '2027-01', end: '2027-12', cadence: 'Upfront' }),
      ],
      billing: [
        { ...bill('a', '2026-11', 8, 1760), coversFrom: '2026-11', coversTo: '2027-01' },
        bill('a', '2026-03', 4, 880),
        bill('a', '2026-03', 4, 880),
        bill('zzz', '2026-03', 4, 880),
      ],
      delivery: [deliver('zzz', '2026-03', 1)],
    });
    expect(codes(inp)).toEqual(expect.arrayContaining(['TERM_OVERLAP', 'CADENCE', 'PROJECT_TERMS', 'BILLING_TERM', 'BILLING_DUPLICATE', 'BILLING_UNKNOWN', 'DELIVERY_UNKNOWN']));
  });
  it('accepts a clean scenario', () => {
    const inp = input({ engagements: [eng[0]!], terms: [term({ engagementId: 'a', start: '2026-01', end: '2026-12' })], billing: [bill('a', '2026-01', 4, 880)] });
    expect(validateInput(inp)).toEqual([]);
  });
});

describe('journals and pre-term activity', () => {
  it('keeps activity before the first term (uses the first term rate) rather than losing it', () => {
    const inp = input({
      engagements: [{ id: 'a', type: 'RR' }],
      terms: [term({ engagementId: 'a', start: '2026-03', end: '2027-02' })],
      billing: [bill('a', '2026-02', 4, 880, '2026-03')],
      delivery: [deliver('a', '2026-02', 2)],
    }, '2026-01', 4);
    const res = run(inp);
    expect(findRow(res, 'a', '2026-01').totalRevenueCents).toBe(0);
    expect(findRow(res, 'a', '2026-02').recognizedCents).toBe($(440));
    expect(findRow(res, 'a', '2026-02').flags).toEqual(['GOOD-FAITH']);
  });
});

describe('deterministic fuzz: invariants hold for random scenarios', () => {
  // Small seeded generator so failures are reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  it('never goes negative and conserves dollars across 300 random scenarios', () => {
    for (let s = 1; s <= 300; s++) {
      const r = rng(s);
      const months = Array.from({ length: 24 }, (_, i) => addMonths('2026-01', i));
      const hasDecision = r() < 0.5;
      const closeAt = r() < 0.4 ? months[10 + Math.floor(r() * 12)] : undefined;
      const rate2 = r() < 0.5 ? 10560 : 12000 + Math.floor(r() * 3000);
      const inp = input({
        engagements: [{ id: 'x', type: 'RR' }],
        terms: [
          term({ engagementId: 'x', start: '2025-08', end: '2026-07' }),
          term({
            engagementId: 'x', start: '2026-08', end: '2027-07', valueCents: $(rate2),
            ...(hasDecision ? { decision: { postingMonth: months[7 + Math.floor(r() * 3)]!, surplusHours: Math.floor(r() * 8), deficitHoursDeducted: Math.floor(r() * 6) } } : {}),
            ...(closeAt ? { closeOutMonth: closeAt } : {}),
          }),
        ],
        billing: months.filter(() => r() < 0.8).map((m) => bill('x', m, 4, 880)),
        delivery: months.map((m) => deliver('x', m, Math.round(r() * 12 * 4) / 4)),
        openingBalances: [{ engagementId: 'x', deferredCents: Math.floor(r() * 200000), backlogHours: Math.floor(r() * 12) }],
      }, '2026-01', 24);
      assertInvariants(inp, runEngine(inp));
    }
  });
});
