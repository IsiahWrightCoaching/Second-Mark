/** Display helpers shared by the engine's wording and the UI. */

const minus = '−';

/** One decimal R with a sign, e.g. +2.4R, −1.0R, 0.0R. */
export const fR = (v: number): string => (Math.abs(v) < 0.05 ? '0.0R' : `${v < 0 ? minus : '+'}${Math.abs(v).toFixed(1)}R`);
/** Two decimal R for averages, e.g. +0.59R. */
export const fR2 = (v: number | null): string =>
  v == null || Number.isNaN(v) ? '–' : Math.abs(v) < 0.005 ? '0.00R' : `${v < 0 ? minus : '+'}${Math.abs(v).toFixed(2)}R`;
export const money = (n: number, cur = '$'): string => `${n < 0 ? minus : ''}${cur}${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
export const signedMoney = (n: number, cur = '$'): string =>
  Math.round(n) === 0 ? `${cur}0` : `${n < 0 ? minus : '+'}${cur}${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
/** "1 trade", "3 trades". */
export const pl = (n: number, w: string, p?: string): string => `${n} ${n === 1 ? w : p ?? w + 's'}`;
export const pfText = (v: number | null): string => (v == null ? '–' : v === Infinity ? 'no losses' : v.toFixed(2));
