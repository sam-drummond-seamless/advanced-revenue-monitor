import { sortedTerms } from './calc';
import { compareMonths, inRange } from './month';
import type { EngineInput, Month } from './types';

export type EngagementStatus = 'Active' | 'Awaiting Renewal' | 'Closed';

/**
 * Derived status as of a month. No time limit or escalation (A-6).
 * Closed = close-out booked on or before asOf. Awaiting Renewal = no term covers asOf and the last term has ended.
 */
export function engagementStatus(input: EngineInput, engagementId: string, asOf: Month): EngagementStatus {
  const terms = sortedTerms(input, engagementId);
  const closed = terms.some((t) => t.closeOutMonth !== undefined && compareMonths(t.closeOutMonth, asOf) <= 0);
  if (closed) return 'Closed';
  if (terms.some((t) => inRange(asOf, t.start, t.end))) return 'Active';
  const last = terms[terms.length - 1];
  if (last && compareMonths(last.end, asOf) < 0) return 'Awaiting Renewal';
  return 'Active';
}
