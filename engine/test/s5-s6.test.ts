import { describe, expect, it } from 'vitest';
import { burnForTerm, burnTag, findRow, journalsForMonth } from '../src';
import { $, bill, deliver, input, run, term } from './helpers';

/** S5 - Project cap and close-out. 100 hrs, $22,000 upfront, account 200. */
describe('S5 project cap and close-out', () => {
  const eng = [{ id: 'p1', type: 'Project' as const }];
  const mk = (feb: number, closeOut = '2026-03', extraDelivery = [] as ReturnType<typeof deliver>[]) =>
    input(
      {
        engagements: eng,
        terms: [term({ engagementId: 'p1', start: '2026-01', end: '2026-12', cadence: 'Upfront', hours: 100, valueCents: $(22000), closeOutMonth: closeOut })],
        billing: [bill('p1', '2026-01', 100, 22000, '2026-01')],
        delivery: [deliver('p1', '2026-01', 60), deliver('p1', '2026-02', feb), ...extraDelivery],
      },
      '2026-01',
      4,
    );

  it('caps at the prepaid pool, flags PROJECT CAP, burns 110%, then forgives at close-out with no journal', () => {
    const inp = mk(50);
    const res = run(inp);

    const jan = findRow(res, 'p1', '2026-01');
    expect(jan.recognizedCents).toBe($(13200));
    expect(jan.closingCents).toBe($(8800));

    const feb = findRow(res, 'p1', '2026-02');
    expect(feb.recognizedCents).toBe($(8800));
    expect(feb.closingCents).toBe(0);
    expect(feb.closingBacklogHrs).toBe(10);
    expect(feb.flags).toEqual(['PROJECT CAP']);
    const burn = burnForTerm(inp, res, 'p1', 0, '2026-02');
    expect(burn.burnPct).toBeCloseTo(1.1, 12);
    expect(burn.tag).toBe('EXHAUSTED');

    const mar = findRow(res, 'p1', '2026-03');
    expect(mar.backlogForgivenHrs).toBe(10);
    expect(mar.closingBacklogHrs).toBe(0);
    expect(mar.totalRevenueCents).toBe(0);
    expect(journalsForMonth(inp, res, '2026-03').Project.lines).toEqual([]);

    const apr = findRow(res, 'p1', '2026-04'); // Closed: stays at zero
    expect(apr.closingCents).toBe(0);
    expect(apr.closingBacklogHrs).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('variant: 90 hrs delivered releases $2,200 breakage at close-out (Dr 200 / Cr 801)', () => {
    const inp = mk(30);
    const res = run(inp);
    expect(findRow(res, 'p1', '2026-02').closingCents).toBe($(2200));
    const mar = findRow(res, 'p1', '2026-03');
    expect(mar.breakageCents).toBe($(2200));
    expect(mar.totalRevenueCents).toBe($(2200));
    expect(mar.closingCents).toBe(0);
    const j = journalsForMonth(inp, res, '2026-03');
    expect(j.Project.lines.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([[200, $(2200), 0], [801, 0, $(2200)]]);
    expect(j.Project.balanced).toBe(true);
    expect(j.Project.debitWithinFunds).toBe(true); // B-2: the original "debit <= Available" check would fail here
    expect(j.RR.lines).toEqual([]);
  });

  it('A-3: a close-out in the same month as the final delivery still recognizes that delivery first', () => {
    const inp = mk(30, '2026-02');
    const feb = findRow(run(inp), 'p1', '2026-02');
    expect(feb.recognizedCents).toBe($(6600));
    expect(feb.breakageCents).toBe($(2200));
    expect(feb.totalRevenueCents).toBe($(8800));
    expect(feb.closingCents).toBe(0);
    expect(feb.closingBacklogHrs).toBe(0);
  });

  it('ignores and warns about activity after the close-out month', () => {
    const res = run(mk(30, '2026-03', [deliver('p1', '2026-04', 5)]));
    expect(findRow(res, 'p1', '2026-04').deliveredHrs).toBe(0);
    expect(res.warnings.some((w) => w.includes('after close-out'))).toBe(true);
  });
});

/** S6 - Burn alerts at exactly 50.00% and 80.00%. */
describe('S6 burn alerts', () => {
  it('tags at exactly the thresholds, not one hour later', () => {
    expect(burnTag(0.4999)).toBe('NONE');
    expect(burnTag(0.5)).toBe('MILESTONE_50');
    expect(burnTag(0.7999)).toBe('MILESTONE_50');
    expect(burnTag(0.8)).toBe('WARNING_80');
    expect(burnTag(0.9999)).toBe('WARNING_80');
    expect(burnTag(1)).toBe('EXHAUSTED');
    expect(burnTag(1.1)).toBe('EXHAUSTED');
  });

  const mk = (entitlement: number, perMonth: number[], extra: Partial<Parameters<typeof input>[0]['settings']> = {}) => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const inp = input({
      engagements: [{ id: 'rr6', type: 'RR' }],
      terms: [term({ engagementId: 'rr6', start: '2026-01', end: '2026-12', hours: entitlement, valueCents: $(entitlement * 220) })],
      delivery: perMonth.map((h, i) => deliver('rr6', months[i]!, h)),
    });
    inp.settings = { ...inp.settings, ...extra };
    return { inp, res: run(inp) };
  };
  const tag = (entitlement: number, perMonth: number[], asOf = '2026-10') => {
    const { inp, res } = mk(entitlement, perMonth);
    return burnForTerm(inp, res, 'rr6', 0, asOf).tag;
  };

  it('uses real delivery: 24 of 48 hrs is the milestone, 23.99 is not', () => {
    expect(tag(48, [24])).toBe('MILESTONE_50');
    expect(tag(48, [23.99])).toBe('NONE');
  });

  it('80.00% triggers although 8 x 0.1 sums to 0.7999999999999999 in floating point', () => {
    const tenths = Array(8).fill(0.1) as number[];
    expect(tenths.reduce((a, b) => a + b, 0)).toBeLessThan(0.8);
    expect(tag(1, tenths)).toBe('WARNING_80');
    expect(tag(1, Array(5).fill(0.1))).toBe('MILESTONE_50');
  });

  it('exhausts at 100% and honours thresholds from settings', () => {
    expect(tag(10, [10])).toBe('EXHAUSTED');
    const { inp, res } = mk(100, [30], { burnMilestone: 0.3, burnWarning: 0.6 });
    expect(burnForTerm(inp, res, 'rr6', 0, '2026-10').tag).toBe('MILESTONE_50');
  });

  it('reports pace gap and projected run-out', () => {
    const { inp, res } = mk(120, [10, 10, 10, 10]);
    const b = burnForTerm(inp, res, 'rr6', 0, '2026-04');
    expect(b.burnPct).toBeCloseTo(40 / 120, 12);
    expect(b.timeElapsedPct).toBeCloseTo(4 / 12, 12);
    expect(b.paceGap).toBeCloseTo(0, 12);
    expect(b.runOutMonths).toBeCloseTo(8, 9); // 80 hrs left at 10 hrs a month
  });

  it('adds hours consumed before cutover to the current term', () => {
    const inp = input({
      engagements: [{ id: 'rr6', type: 'RR' }],
      terms: [term({ engagementId: 'rr6', start: '2025-10', end: '2026-09', hours: 48, valueCents: $(10560) })],
      openingBalances: [{ engagementId: 'rr6', deferredCents: 0, backlogHours: 0, termHoursConsumedBeforeCutover: 24 }],
      delivery: [],
    });
    expect(burnForTerm(inp, run(inp), 'rr6', 0, '2026-01').tag).toBe('MILESTONE_50');
  });
});
