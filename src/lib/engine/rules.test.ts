import { describe, it, expect } from 'vitest';
import type { Trade, Account } from './types';
import { wilson, relimit, walkAccount, runStateTest, STATE_TESTS, planScore, rFromUsd, dayKey, followed, core } from './index';

let n = 0;
const T = (o: Partial<Trade>): Trade => ({
  id: 't' + n++, accountId: 'a', strategyId: 's', strategyVersion: 1, entryAt: Date.UTC(2026, 9, 1, 14), instrument: 'NAS100',
  direction: 'long', planned: true, impulseReason: '', rulesMet: true, missedRules: [], grade: null, exit: 'as_planned',
  riskPct: 1, defaultRiskPct: 1, overLimit: false, r: 1, usd: 1000, sleepHours: 7, usualSchedule: true, carrying: 'nothing',
  fuel: 'both', sharpness: 7, belowFee: false, afterLoss: false, ...o,
});
const A = (o: Partial<Account>): Account => ({
  id: 'a', type: 'challenge', firm: '', size: 100000, targets: [8, 5], maxDrawdownPct: 10, dailyLossPct: 5, ddBasis: 'balance',
  ddMode: 'static', fee: 500, strategyIds: ['s'], archived: false, closedAs: null, manualFail: false, manualPasses: [], ...o,
});

describe('definitions', () => {
  it('to plan needs all five parts', () => {
    expect(followed(T({}))).toBe(true);
    for (const o of [{ planned: false }, { rulesMet: false }, { riskPct: 1.5 }, { exit: 'held_loser' as const }, { overLimit: true }]) expect(followed(T(o))).toBe(false);
  });
  it('R is dollars over planned risk at the default on the starting size', () => {
    expect(rFromUsd(500, 50000, 1)).toBe(1);
    expect(rFromUsd(-750, 50000, 1)).toBe(-1.5);
  });
  it('max drawdown is measured from the high point, starting at zero', () => {
    const ts = [1, 2, -1, -2, -1, 3].map((r, i) => T({ r, entryAt: i }));
    expect(core(ts).maxDrawdown).toBe(4);
  });
  it('Wilson interval for 50 of 100', () => {
    const [lo, hi] = wilson(50, 100)!;
    expect(lo).toBeCloseTo(0.404, 2);
    expect(hi).toBeCloseTo(0.596, 2);
  });
  it('plan score counts good no-trade days and fear days', () => {
    const ts = [T({}), T({ planned: false })];
    expect(planScore(ts, [{ reason: 'no_setup' }, { reason: 'fear' }, { reason: 'no_time' }]).score).toBe(50); // (1+1)/(2+1+1)
  });
});

describe('time zones', () => {
  it('a trade at 23:30 UTC in October is the next day in London', () => {
    const ts = Date.UTC(2026, 9, 14, 23, 30);
    expect(dayKey(ts, 'UTC')).toBe('2026-10-14');
    expect(dayKey(ts, 'Europe/London')).toBe('2026-10-15');
  });
});

describe('daily trade limit by entry order', () => {
  it('back-filling an earlier trade re-marks the later ones', () => {
    const later = [T({ id: 'x1', entryAt: Date.UTC(2026, 9, 1, 14) }), T({ id: 'x2', entryAt: Date.UTC(2026, 9, 1, 15) })];
    const early = T({ id: 'x0', entryAt: Date.UTC(2026, 9, 1, 9) });
    const out = relimit([...later, early], { s: 2 }, 'UTC');
    expect(Object.fromEntries(out.map((t) => [t.id, t.overLimit]))).toEqual({ x0: false, x1: false, x2: true });
  });
});

describe('prop rules', () => {
  it('a day losing past the daily limit fails the challenge even inside max drawdown', () => {
    const d = Date.UTC(2026, 9, 1, 14);
    const ts = [T({ usd: -3000, entryAt: d }), T({ usd: -2500, entryAt: d + 3600e3 })];
    const st = walkAccount(A({}), ts, 'UTC');
    expect(st.status).toBe('failed');
    expect(st.breachKind).toBe('daily');
  });
  it('a manual phase pass survives recalculation', () => {
    const passAt = Date.UTC(2026, 9, 2);
    const ts = [T({ usd: 100, entryAt: Date.UTC(2026, 9, 1) }), T({ usd: 100, entryAt: Date.UTC(2026, 9, 3) })];
    const st = walkAccount(A({ manualPasses: [passAt] }), ts, 'UTC');
    expect(st.phase).toBe(2);
    expect(st.phaseProfit).toBe(100);
  });
  it('trailing drawdown follows the high point', () => {
    const ts = [6000, -5000].map((usd, i) => T({ usd, entryAt: Date.UTC(2026, 9, 1 + i * 2) }));
    const st = walkAccount(A({ ddMode: 'trailing', maxDrawdownPct: 4, dailyLossPct: 0, targets: [20] }), ts, 'UTC');
    expect(st.status).toBe('failed');
  });
});

describe('pattern honesty', () => {
  it('a 25-point gap on 8 trades a side is not called a pattern', () => {
    const short = Array.from({ length: 8 }, (_, i) => T({ sleepHours: 5, planned: i >= 3 }));
    const normal = Array.from({ length: 8 }, (_, i) => T({ sleepHours: 8, planned: i >= 1 }));
    expect(runStateTest(STATE_TESTS[0], [...short, ...normal], () => true).state).toBe('none');
  });
  it('trades with no check-in are left out of state tests', () => {
    const ts = Array.from({ length: 20 }, () => T({ sleepHours: null }));
    expect(runStateTest(STATE_TESTS[0], ts, () => true).state).toBe('wait');
  });
});
