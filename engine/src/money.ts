/**
 * Round dollars to integer cents, half away from zero, matching Google Sheets ROUND(x, 2).
 * The tiny relative nudge makes decimal ties such as 1.005 behave as they do in Sheets
 * (plain Math.round(1.005 * 100) gives 100 because 1.005 is stored as 1.00499999999999989...).
 */
export function roundCents(dollars: number): number {
  const sign = dollars < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(dollars) * 100 * (1 + 1e-12));
  return sign * cents || 0;
}

/** Whole-dollar / decimal-dollar convenience for tests and fixtures. */
export const cents = (dollars: number): number => roundCents(dollars);

export const toDollars = (c: number): number => c / 100;

/** Hours below this are floating-point noise and are treated as zero. */
export const HOURS_EPSILON = 1e-9;

export const snapHours = (h: number): number => (Math.abs(h) < HOURS_EPSILON ? 0 : h);

/** Round a ratio to 6 decimals so exact thresholds (50.00%, 80.00%) trigger despite float error. */
export const round6 = (x: number): number => Math.round(x * 1e6 * (1 + 1e-12)) / 1e6;
