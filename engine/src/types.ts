/** A calendar month as `YYYY-MM`. All month inputs are posting months unless stated (docs/SPEC-AMENDMENTS.md A-1). */
export type Month = string;

export type EngagementType = 'RR' | 'Project';
export type Cadence = 'Monthly' | 'Annual' | 'Upfront';

/** Money is always integer cents. Hours are plain numbers at full precision (A-2). */
export interface Engagement {
  id: string;
  type: EngagementType;
}

export interface RenewalDecision {
  /** Month the decision is booked (P). Must be on or after the new term's start month. */
  postingMonth: Month;
  /** Approved surplus hours, valued at THIS term's rate (spec 6.3). */
  surplusHours: number;
  /** Deficit hours Finance chooses to deduct. Capped at the eligible deficit. */
  deficitHoursDeducted: number;
}

export interface Term {
  engagementId: string;
  /** First month of the term. For a delayed renewal this is the backdated start. */
  start: Month;
  /** Last month of the term (inclusive). */
  end: Month;
  cadence: Cadence;
  hours: number;
  /** Effort-based value only, in cents. */
  valueCents: number;
  /** Decision about the PREVIOUS term, entered on this (new) term. */
  decision?: RenewalDecision;
  /** Month the close-out is booked. Releases breakage and forgives backlog (spec 6.5). */
  closeOutMonth?: Month;
}

/** One invoice. Hours and amount are TYPED values (A-1); the accrual schedule only checks them. */
export interface BillingRow {
  postingMonth: Month;
  engagementId: string;
  coversFrom: Month;
  coversTo: Month;
  hours: number;
  amountCents: number;
  /** What the EA typed from the Xero invoice, for the variance check. */
  xeroAmountCents?: number;
}

/** One engagement-month of delivery. `postingMonth` is when the hours count (A-1). */
export interface DeliveryRow {
  postingMonth: Month;
  engagementId: string;
  harvestHours: number;
  adjustmentHours?: number;
}

export interface OpeningBalance {
  engagementId: string;
  deferredCents: number;
  backlogHours: number;
  /** Hours consumed on the current term before cutover (burn rate only). */
  termHoursConsumedBeforeCutover?: number;
}

export interface Settings {
  cutoverMonth: Month;
  horizonMonths: number;
  rrDeferredAccount?: number;
  projectDeferredAccount?: number;
  earnedAccount?: number;
  /** Fractions, default 0.5 and 0.8. */
  burnMilestone?: number;
  burnWarning?: number;
  /** Billing variance tolerance in cents, default 5 (B-3). */
  billingVarianceToleranceCents?: number;
}

export interface EngineInput {
  settings: Settings;
  engagements: Engagement[];
  terms: Term[];
  billing: BillingRow[];
  delivery: DeliveryRow[];
  openingBalances: OpeningBalance[];
}

export type Flag = 'OVER-SERVICED' | 'GOOD-FAITH' | 'CATCH-UP' | 'PROJECT CAP';

/** One engagement x month (spec 5). */
export interface MonthRow {
  engagementId: string;
  month: Month;
  type: EngagementType;
  /** Index into the engagement's terms sorted by start; null if the engagement has no terms. */
  termIndex: number | null;
  /** True when a term's start <= month <= end. */
  termActive: boolean;
  rate: number | null;
  openingCents: number;
  openingBacklogHrs: number;
  /** Carried to the new term in a decision month (informational; spec 5 row 4). */
  renewalCarriedCents: number;
  breakageCents: number;
  backlogForgivenHrs: number;
  additionsCents: number;
  additionsHrs: number;
  /** Opening + Additions. Breakage is released AFTER delivery (A-3), so it is not netted here. */
  availableCents: number;
  deliveredHrs: number;
  demandHrs: number;
  recognizedCents: number;
  recognizedHrs: number;
  closingCents: number;
  closingBacklogHrs: number;
  catchUpCents: number;
  totalRevenueCents: number;
  /** Set in a decision month: index of the term carrying the decision, the eligible deficit and the hours deducted. */
  decisionTermIndex: number | null;
  eligibleDeficitHrs: number;
  deficitDeductedHrs: number;
  flags: Flag[];
}

export interface EngineResult {
  rows: MonthRow[];
  warnings: string[];
}
