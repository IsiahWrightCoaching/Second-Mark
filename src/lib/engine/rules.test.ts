import { describe, it, expect } from 'vitest';
import type { Trade, Account } from './types';
import { wilson, relimit, walkAccount, runStateTest, STATE_TESTS, planScore, rFromUsd, dayKey, followed, core, ZCRIT, afterTwoWins, feelingBreakdown, insights, deriveFlags } from './index';

let n = 0;
const T = (o: Partial<Trade>): Trade => ({
  id: 't' + n++, accountId: 'a', strategyId: 's', strategyVersion: 1, entryAt: Date.UTC(2026, 9, 1, 14), instrument: 'NAS100',
  direction: 'long', planned: true, impulseReason: '', rulesMet: true, missedRules: [], grade: null, exit: 'as_planned',
  riskPct: 1, defaultRiskPct: 1, overLimit: false, r: 1, usd: 1000, sleepHours: 7, usualSchedule: true, carrying: 'nothing',
  water: true, feeling: 'calm', sharpness: 7, belowFee: false, afterLoss: false, ...o,
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

describe('feeling, water, winning runs and early strategy changes', () => {
  const ctx = (strategies: Record<string, import('./types').Strategy>, all: Trade[]) => ({
    tz: 'UTC', strategies, accounts: { a: A({}) }, all, ratings: [], viewAccountIds: ['a'],
  });
  const S = (o: Partial<import('./types').Strategy>) => ({
    id: 's', name: 'London pullback', kind: 'rules', checklist: ['A'], instruments: ['NAS100'], defaultRiskPct: 1, maxPerDay: null, version: 1, ...o,
  }) as import('./types').Strategy;

  it('the feeling test compares calm days with every other feeling, as one test', () => {
    const t = STATE_TESTS.find((x) => x.key === 'feeling')!;
    const ts = [
      ...Array.from({ length: 20 }, (_, i) => T({ feeling: 'calm', planned: i >= 4 })),
      ...Array.from({ length: 20 }, (_, i) => T({ feeling: i % 2 ? 'frustrated' : 'anxious', planned: i >= 16 })),
    ];
    const r = runStateTest(t, ts, () => false);
    expect(r.state).toBe('found');
    expect(r.state === 'found' && r.text).toBe("On days you didn't feel calm, 80% of your trades went off plan. On calm days, 20%.");
    const b = feelingBreakdown(ts);
    expect(b.find((x) => x.feeling === 'frustrated')).toEqual({ feeling: 'frustrated', label: 'Frustrated or angry', n: 10, toPlan: 20 });
    expect(b.find((x) => x.feeling === 'excited')!.toPlan).toBeNull();
  });

  it('the water test only uses trades with an answer', () => {
    const t = STATE_TESTS.find((x) => x.key === 'water')!;
    const ts = Array.from({ length: 30 }, () => T({ water: null }));
    expect(runStateTest(t, ts, () => false).state).toBe('wait');
  });

  it('eight state tests, so the corrected bar is z of 2.5', () => {
    expect(STATE_TESTS.length).toBe(8);
    expect(ZCRIT).toBe(2.5);
  });

  it('after two wins, oversizing is flagged when it creeps', () => {
    let i = 0;
    const ts: Trade[] = [];
    // Repeating pattern: win, win, then an oversized trade. Gives 10 trades after two wins.
    for (let k = 0; k < 10; k++) ts.push(T({ r: 1, entryAt: i++ }), T({ r: 1, entryAt: i++ }), T({ r: -1, riskPct: 2, entryAt: i++ }), T({ r: -1, entryAt: i++ }));
    const { group } = afterTwoWins(ts);
    expect(group.length).toBeGreaterThanOrEqual(8);
    const cards = insights(ts, ctx({ s: S({}) }, ts));
    expect(cards.some((c) => c.source === 'winStreak')).toBe(true);
  });

  it('a strategy changed after fewer than 30 trades gets a fact card', () => {
    const ts = [
      ...Array.from({ length: 12 }, (_, i) => T({ strategyVersion: 1, entryAt: i, r: i % 2 ? 1 : -1 })),
      ...Array.from({ length: 10 }, (_, i) => T({ strategyVersion: 2, entryAt: 100 + i, r: i % 2 ? 1 : -1 })),
    ];
    const card = insights(ts, ctx({ s: S({ version: 2 }) }, ts)).find((c) => c.source === 'earlyChange');
    expect(card?.head).toBe('You changed London pullback after 12 trades');
  });

  it('no early-change card when the old version had 30 trades', () => {
    const ts = [
      ...Array.from({ length: 30 }, (_, i) => T({ strategyVersion: 1, entryAt: i, r: i % 2 ? 1 : -1 })),
      ...Array.from({ length: 10 }, (_, i) => T({ strategyVersion: 2, entryAt: 100 + i, r: i % 2 ? 1 : -1 })),
    ];
    expect(insights(ts, ctx({ s: S({ version: 2 }) }, ts)).some((c) => c.source === 'earlyChange')).toBe(false);
  });
});

describe('flags worked out from a trade’s place in the account', () => {
  const H = (id: string, h: number, r: number, usd = r * 500, strategyId = 's') => ({ id, strategyId, entryAt: Date.UTC(2026, 9, 1, h), r, usd });
  it('after a loss, below the fee, and over the daily limit', () => {
    const f = deriveFlags({ type: 'challenge', fee: 500 }, [H('a', 9, -1), H('b', 10, 2), H('c', 11, 1)], { s: 2 }, 'UTC');
    expect(f.get('a')).toEqual({ afterLoss: false, belowFee: true, overLimit: false });
    expect(f.get('b')).toEqual({ afterLoss: true, belowFee: true, overLimit: false });
    // After b the account is +500, which covers the 500 fee.
    expect(f.get('c')).toEqual({ afterLoss: false, belowFee: false, overLimit: true });
  });
  it('a back-filled earlier trade re-marks the ones after it', () => {
    const f = deriveFlags({ type: 'funded', fee: 0 }, [H('late', 15, 1), H('early', 8, -1)], { s: 1 }, 'UTC');
    expect(f.get('early')!.overLimit).toBe(false);
    expect(f.get('late')).toEqual({ afterLoss: true, belowFee: false, overLimit: true });
  });
  it('a breakeven is not a loss, and the limit resets each local day', () => {
    const f = deriveFlags({ type: 'demo', fee: 0 }, [
      { id: 'x', strategyId: 's', entryAt: Date.UTC(2026, 9, 1, 22, 30), r: -0.02, usd: -10 },
      { id: 'y', strategyId: 's', entryAt: Date.UTC(2026, 9, 1, 23, 30), r: 1, usd: 500 },
    ], { s: 1 }, 'Europe/London');
    // 22:30 and 23:30 UTC are 23:30 and 00:30 in London: two different days.
    expect(f.get('y')).toEqual({ afterLoss: false, belowFee: false, overLimit: false });
  });
});
