import { expect } from 'vitest';
import {
  cents,
  runEngine,
  type BillingRow,
  type DeliveryRow,
  type EngineInput,
  type EngineResult,
  type Term,
} from '../src';

/** Dollars to cents for readable fixtures. */
export const $ = cents;

export function input(over: Partial<EngineInput> & Pick<EngineInput, 'engagements' | 'terms'>, cutover = '2026-01', horizon = 6): EngineInput {
  return {
    settings: { cutoverMonth: cutover, horizonMonths: horizon },
    billing: [],
    delivery: [],
    openingBalances: [],
    ...over,
  };
}

export const term = (t: Partial<Term> & Pick<Term, 'engagementId' | 'start' | 'end'>): Term => ({
  cadence: 'Monthly',
  hours: 48,
  valueCents: $(10560),
  ...t,
});

export const bill = (engagementId: string, postingMonth: string, hours: number, amount: number, covers = postingMonth): BillingRow => ({
  postingMonth,
  engagementId,
  coversFrom: covers,
  coversTo: covers,
  hours,
  amountCents: $(amount),
});

export const deliver = (engagementId: string, postingMonth: string, harvestHours: number, adjustmentHours = 0): DeliveryRow => ({
  postingMonth,
  engagementId,
  harvestHours,
  adjustmentHours,
});

/**
 * Invariants that hold for every scenario (spec 2.2):
 *  - deferred balance and backlog never go below zero
 *  - dollars are conserved: opening + additions = recognized + breakage + closing
 */
export function assertInvariants(inp: EngineInput, res: EngineResult): void {
  for (const r of res.rows) {
    expect(r.closingCents, `${r.engagementId} ${r.month} closing $`).toBeGreaterThanOrEqual(0);
    expect(r.closingBacklogHrs, `${r.engagementId} ${r.month} backlog`).toBeGreaterThanOrEqual(0);
  }
  for (const e of inp.engagements) {
    const rows = res.rows.filter((r) => r.engagementId === e.id);
    if (rows.length === 0) continue;
    const open = inp.openingBalances.find((o) => o.engagementId === e.id)?.deferredCents ?? 0;
    const adds = rows.reduce((s, r) => s + r.additionsCents, 0);
    const out = rows.reduce((s, r) => s + r.recognizedCents + r.breakageCents, 0);
    expect(open + adds, `${e.id} conservation`).toBe(out + rows[rows.length - 1]!.closingCents);
  }
}

export const run = (inp: EngineInput): EngineResult => {
  const res = runEngine(inp);
  assertInvariants(inp, res);
  return res;
};
