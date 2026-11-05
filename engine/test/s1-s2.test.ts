import { describe, expect, it } from 'vitest';
import { findRow, journalsForMonth } from '../src';
import { $, bill, deliver, input, run, term } from './helpers';

/** S1 - Monthly RR with over-servicing (deficit absorption). 48 hrs/yr, $10,560, $880 invoiced monthly. */
describe('S1 monthly RR with over-servicing', () => {
  const inp = input({
    engagements: [{ id: 'rr1', type: 'RR' }],
    terms: [term({ engagementId: 'rr1', start: '2026-01', end: '2026-12' })],
    billing: [bill('rr1', '2026-01', 4, 880), bill('rr1', '2026-02', 4, 880), bill('rr1', '2026-03', 4, 880)],
    delivery: [deliver('rr1', '2026-01', 6), deliver('rr1', '2026-02', 3), deliver('rr1', '2026-03', 2)],
  }, '2026-01', 4);
  const res = run(inp);

  it.each([
    // month, opening $, add $, delivered, backlog in, recognized $, closing $, backlog out
    ['2026-01', 0, 880, 6, 0, 880, 0, 2],
    ['2026-02', 0, 880, 3, 2, 880, 0, 1],
    ['2026-03', 0, 880, 2, 1, 660, 220, 0],
  ])('%s matches the spec table', (m, open, add, del, backIn, rec, close, backOut) => {
    const r = findRow(res, 'rr1', m);
    expect(r.openingCents).toBe($(open));
    expect(r.additionsCents).toBe($(add));
    expect(r.deliveredHrs).toBe(del);
    expect(r.openingBacklogHrs).toBe(backIn);
    expect(r.recognizedCents).toBe($(rec));
    expect(r.closingCents).toBe($(close));
    expect(r.closingBacklogHrs).toBe(backOut);
  });

  it('flags over-servicing while backlog exists; CATCH-UP marks months where funds clear earlier backlog (spec 5 row 16)', () => {
    expect(findRow(res, 'rr1', '2026-01').flags).toEqual(['OVER-SERVICED']);
    expect(findRow(res, 'rr1', '2026-02').flags).toEqual(['OVER-SERVICED', 'CATCH-UP']);
    expect(findRow(res, 'rr1', '2026-03').flags).toEqual(['CATCH-UP']);
  });

  it('shows month 2 and 3 as catch-up that clears earlier backlog', () => {
    expect(findRow(res, 'rr1', '2026-02').catchUpCents).toBe($(880 - 3 * 220));
    expect(findRow(res, 'rr1', '2026-03').catchUpCents).toBe($(660 - 2 * 220));
  });

  it('journals the recognized dollars for RR only', () => {
    const j = journalsForMonth(inp, res, '2026-03');
    expect(j.RR.lines.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([
      [102, $(660), 0],
      [801, 0, $(660)],
    ]);
    expect(j.RR.balanced).toBe(true);
    expect(j.Project.lines).toEqual([]);
  });
});

/** S2 - Delayed renewal with good-faith catch-up. */
describe('S2 delayed renewal with good-faith catch-up', () => {
  const oldTerm = term({ engagementId: 'rr2', start: '2025-08', end: '2026-07', cadence: 'Annual', hours: 50, valueCents: $(11000) });
  const newTerm = term({ engagementId: 'rr2', start: '2026-08', end: '2027-07', cadence: 'Annual', hours: 50, valueCents: $(11000) });
  const delivery = [deliver('rr2', '2026-08', 5), deliver('rr2', '2026-09', 5), deliver('rr2', '2026-10', 5), deliver('rr2', '2026-11', 4)];
  const opening = [{ engagementId: 'rr2', deferredCents: $(440), backlogHours: 0 }];
  const eng = [{ id: 'rr2', type: 'RR' as const }];

  const full = input(
    { engagements: eng, terms: [oldTerm, newTerm], delivery, openingBalances: opening, billing: [bill('rr2', '2026-11', 50, 11000, '2026-08')] },
    '2026-08',
    4,
  );
  const res = run(full);

  it.each([
    ['2026-08', 440, 0, 5, 0, 440, 0, 3, ['GOOD-FAITH']],
    ['2026-09', 0, 0, 5, 3, 0, 0, 8, ['GOOD-FAITH']],
    ['2026-10', 0, 0, 5, 8, 0, 0, 13, ['GOOD-FAITH']],
    ['2026-11', 0, 11000, 4, 13, 3740, 7260, 0, ['CATCH-UP']],
  ])('%s matches the spec table', (m, open, add, del, backIn, rec, close, backOut, flags) => {
    const r = findRow(res, 'rr2', m);
    expect(r.openingCents).toBe($(open));
    expect(r.additionsCents).toBe($(add));
    expect(r.deliveredHrs).toBe(del);
    expect(r.openingBacklogHrs).toBe(backIn);
    expect(r.recognizedCents).toBe($(rec));
    expect(r.closingCents).toBe($(close));
    expect(r.closingBacklogHrs).toBe(backOut);
    expect(r.flags).toEqual(flags);
  });

  it('November holds a single catch-up journal of $2,860 inside $3,740', () => {
    expect(findRow(res, 'rr2', '2026-11').catchUpCents).toBe($(2860));
    const j = journalsForMonth(full, res, '2026-11');
    expect(j.RR.totalCents).toBe($(3740));
    for (const m of ['2026-08', '2026-09', '2026-10']) expect(journalsForMonth(full, res, m).RR.lines.length).toBeLessThanOrEqual(2);
  });

  it('Aug-Oct do not change when the backdated renewal is entered', () => {
    // Before the renewal: no new term, no invoice. Same engine, three months only.
    const before = run(input({ engagements: eng, terms: [oldTerm], delivery, openingBalances: opening }, '2026-08', 3));
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      const a = findRow(before, 'rr2', m);
      const b = findRow(res, 'rr2', m);
      expect(b.recognizedCents).toBe(a.recognizedCents);
      expect(b.closingCents).toBe(a.closingCents);
      expect(b.closingBacklogHrs).toBe(a.closingBacklogHrs);
      expect(b.totalRevenueCents).toBe(a.totalRevenueCents);
      expect(b.flags).toEqual(a.flags);
    }
  });

  it('a rate change on the backdated term restates hours but never dollars (A-4)', () => {
    const dearer = { ...newTerm, valueCents: $(12500) }; // $250/hr
    const before = run(input({ engagements: eng, terms: [oldTerm], delivery, openingBalances: opening }, '2026-08', 3));
    const after = run(input({ engagements: eng, terms: [oldTerm, dearer], delivery, openingBalances: opening, billing: [bill('rr2', '2026-11', 50, 12500, '2026-08')] }, '2026-08', 4));
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      expect(findRow(after, 'rr2', m).recognizedCents).toBe(findRow(before, 'rr2', m).recognizedCents);
      expect(findRow(after, 'rr2', m).closingCents).toBe(findRow(before, 'rr2', m).closingCents);
    }
    // $440 at $250 is 1.76 hrs, so August backlog is 3.24 hrs rather than 3.
    expect(findRow(after, 'rr2', '2026-08').closingBacklogHrs).toBeCloseTo(3.24, 9);
    expect(findRow(after, 'rr2', '2026-10').closingBacklogHrs).toBeCloseTo(13.24, 9);
    const nov = findRow(after, 'rr2', '2026-11');
    expect(nov.recognizedCents).toBe($(17.24 * 250));
    expect(nov.closingBacklogHrs).toBe(0);
  });
});
