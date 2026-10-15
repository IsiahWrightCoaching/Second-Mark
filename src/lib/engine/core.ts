import type { Trade, NoTradeReason } from './types';

/** Thresholds. Changing any of these changes what the app claims, so keep them in step with the spec. */
export const MIN = 8; // trades needed on each side of any comparison
export const GAP = 15; // percentage points a state pattern must differ by
/** 8 state tests run on every view; Bonferroni one-sided alpha 0.05/8 gives z of about 2.50. */
export const ZCRIT = 2.5;
export const EARLY = 30; // under this many trades, numbers are labelled an early read
export const BE_BAND = 0.05; // |R| under this counts as breakeven

/**
 * The one definition of "to plan" (the second mark). Every number that says "to plan" uses this.
 * Planned, rules met, risk within default, exit as planned, inside the daily trade limit.
 */
export const followed = (t: Trade): boolean =>
  t.planned && t.rulesMet && t.riskPct <= t.defaultRiskPct && t.exit === 'as_planned' && !t.overLimit;
export const offPlan = (t: Trade): boolean => !followed(t);

export type Outcome = 'win' | 'loss' | 'be';
export const outcome = (t: Trade): Outcome => (Math.abs(t.r) < BE_BAND ? 'be' : t.r > 0 ? 'win' : 'loss');

export const sumR = (ts: Trade[]): number => ts.reduce((s, t) => s + t.r, 0);
export const avgR = (ts: Trade[]): number | null => (ts.length ? sumR(ts) / ts.length : null);
export const pc = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);
/** Oldest first. */
export const chron = (ts: Trade[]): Trade[] => ts.slice().sort((a, b) => a.entryAt - b.entryAt);

/** R for a result: dollars divided by the planned risk at the strategy's default on the starting size. */
export function rFromUsd(usd: number, accountSize: number, defaultRiskPct: number): number {
  const riskUsd = (accountSize * defaultRiskPct) / 100;
  return riskUsd ? Math.round((usd / riskUsd) * 10) / 10 : 0;
}

/** Profit factor: R won / R lost. Infinity when there are wins and no losses, null when neither. */
export function profitFactor(ts: Trade[]): number | null {
  const won = ts.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0);
  const lost = -ts.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return lost ? won / lost : won ? Infinity : null;
}

export interface CoreStats {
  n: number;
  wins: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  total: number;
  best: number | null;
  worst: number | null;
  /** Deepest peak-to-trough fall in cumulative R, starting from 0. Positive number. */
  maxDrawdown: number;
}

export function core(ts: Trade[]): CoreStats {
  const w = ts.filter((t) => outcome(t) === 'win');
  const l = ts.filter((t) => outcome(t) === 'loss');
  let c = 0, peak = 0, dd = 0;
  for (const t of chron(ts)) {
    c += t.r;
    peak = Math.max(peak, c);
    dd = Math.max(dd, peak - c);
  }
  return {
    n: ts.length,
    wins: w.length,
    winRate: ts.length ? w.length / ts.length : null,
    avgWin: avgR(w),
    avgLoss: avgR(l),
    expectancy: avgR(ts),
    profitFactor: profitFactor(ts),
    total: sumR(ts),
    best: ts.length ? Math.max(...ts.map((t) => t.r)) : null,
    worst: ts.length ? Math.min(...ts.map((t) => t.r)) : null,
    maxDrawdown: dd,
  };
}

/** Wilson 95% interval for a proportion. */
export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Welch's t statistic on R, treated as z for these sample sizes. Positive when a > b. */
export function welch(a: Trade[], b: Trade[]): number {
  const m = (x: Trade[]) => sumR(x) / x.length;
  const v = (x: Trade[]) => {
    const mu = m(x);
    return x.reduce((s, t) => s + (t.r - mu) ** 2, 0) / Math.max(1, x.length - 1);
  };
  const se = Math.sqrt(v(a) / a.length + v(b) / b.length);
  return se ? (m(a) - m(b)) / se : 0;
}

/** Two-proportion z statistic. Positive when ka/na > kb/nb. */
export function prop2(ka: number, na: number, kb: number, nb: number): number {
  const p = (ka + kb) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  return se ? (ka / na - kb / nb) / se : 0;
}

/** Inverse standard normal (Acklam). */
export function probit(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ---------- dates: everything grouped by the trader's own time zone ---------- */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}
function parts(ts: number, tz: string) {
  const o: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}
/** YYYY-MM-DD in the trader's time zone. */
export const dayKey = (ts: number, tz: string): string => {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
};
export const localHour = (ts: number, tz: string): number => Number(parts(ts, tz).hour) % 24;
export const weekday = (ts: number, tz: string): string => parts(ts, tz).weekday;

/** Sessions are fixed in UTC for V1: Asia before 07:00, London 07:00 to 12:00, New York 12:00 to 21:00. */
export function sessionOf(ts: number): 'Asia' | 'London' | 'New York' {
  const h = new Date(ts).getUTCHours();
  return h < 7 ? 'Asia' : h < 12 ? 'London' : h < 21 ? 'New York' : 'Asia';
}

/** 1-based position of a trade among that account's trades on the same local day. */
export function tradeNumber(t: Trade, all: Trade[], tz: string): number {
  const k = dayKey(t.entryAt, tz);
  return all.filter((x) => x.accountId === t.accountId && dayKey(x.entryAt, tz) === k && x.entryAt <= t.entryAt).length;
}

/* ---------- no-trade days and the plan score ---------- */

export const GOOD_NO_TRADE: NoTradeReason[] = ['no_setup', 'not_right_state', 'news_day', 'stopped_at_limit', 'rest_day'];
export function noTradeScore(r: NoTradeReason): 'good' | 'off' | 'neutral' {
  return GOOD_NO_TRADE.includes(r) ? 'good' : r === 'fear' ? 'off' : 'neutral';
}

/**
 * Plan score = (trades to plan + good no-trade days) / (trades + good no-trade days + fear days).
 * Pass no no-trade days when a single strategy is filtered.
 */
export function planScore(ts: Trade[], days: { reason: NoTradeReason }[]): { score: number | null; toPlan: number; good: number; fear: number } {
  const good = days.filter((d) => noTradeScore(d.reason) === 'good').length;
  const fear = days.filter((d) => noTradeScore(d.reason) === 'off').length;
  const toPlan = ts.filter(followed).length;
  const den = ts.length + good + fear;
  return { score: den ? pc(toPlan + good, den) : null, toPlan, good, fear };
}

/**
 * Daily trade limit by entry order: within each account, strategy and local day,
 * trades past the strategy's limit are over it. Returns new trade objects.
 */
export function relimit(trades: Trade[], limits: Record<string, number | null>, tz: string): Trade[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = `${t.accountId}|${t.strategyId}|${dayKey(t.entryAt, tz)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out = new Map<string, boolean>();
  for (const [k, g] of groups) {
    const max = limits[k.split('|')[1]] ?? null;
    chron(g).forEach((t, i) => out.set(t.id, max != null && i >= max));
  }
  return trades.map((t) => ({ ...t, overLimit: out.get(t.id) ?? false }));
}
