/**
 * Parity with the tested prototype: the same 134 trades must give the same answers
 * in this engine as they did in the prototype (version 18). If this fails, the port has drifted.
 */
import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/prototype.json';
import type { Trade, Strategy, Account, DayRating } from './types';
import { core, walkAccount, isPast, verdicts, mistakeCosts, insights, runStateTest, STATE_TESTS } from './index';

const trades = fixture.trades as Trade[];
const strategies = Object.fromEntries((fixture.strategies as Strategy[]).map((s) => [s.id, s]));
const accounts = Object.fromEntries((fixture.accounts as Account[]).map((a) => [a.id, a]));
const ratings = fixture.ratings as DayRating[];
const TZ = 'UTC';
const live = (fixture.accounts as Account[]).filter((a) => a.type !== 'demo').map((a) => a.id);
const KEY: Record<string, string> = { sleep: 'sleep', schedule: 'sched', carrying: 'carry', fuel: 'fuel', sharpness: 'feel', afterLoss: 'loss', belowFee: 'fee' };
/**
 * Deliberate change from the prototype: when a split has two groups that mirror each other exactly
 * (equal strength), the card now always shows the losing side. The prototype picked by floating-point noise.
 */
const MIRROR: Record<string, string> = {
  'NAS100: your best instrument': 'US30: losing you money',
  'London pullback: your best strategy': 'Discretionary (self-graded): losing you money',
  'Long trades: your best direction': 'Short trades: losing you money',
};
const canon = (h: string) => MIRROR[h] ?? h;
const close = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);

describe('engine matches the prototype', () => {
  for (const exp of fixture.expected) {
    const [acctId, scope] = exp.view.split('|');
    const ts = trades.filter((t) => (scope === 'acct' ? t.accountId === acctId : live.includes(t.accountId)));
    const isChallenge = (t: Trade) => accounts[t.accountId].type === 'challenge';

    it(`${exp.view}: trade count and core stats`, () => {
      expect(ts.length).toBe(exp.n);
      const c = core(ts);
      expect(close(c.winRate, exp.core.wr)).toBe(true);
      expect(close(c.expectancy, exp.core.exp)).toBe(true);
      const pf = exp.core.pf as unknown;
      expect(pf === 'inf' ? c.profitFactor === Infinity : close(c.profitFactor, pf as number)).toBe(true);
      expect(close(c.total, exp.core.tot)).toBe(true);
      expect(close(c.maxDrawdown, exp.core.dd)).toBe(true);
    });

    it(`${exp.view}: state patterns`, () => {
      const got = STATE_TESTS.map((T) => {
        const r = runStateTest(T, ts, isChallenge);
        return [KEY[T.key], r.state, 'ra' in r ? r.ra : null, 'rb' in r ? r.rb : null];
      });
      expect(got).toEqual(exp.tests);
    });

    it(`${exp.view}: strategy verdicts`, () => {
      expect(verdicts(ts, strategies).map((v) => [v.kind, v.head])).toEqual(exp.verdicts);
    });

    it(`${exp.view}: mistake costs`, () => {
      const m = mistakeCosts(ts);
      if (!exp.mistakes) return expect(m).toBeNull();
      expect(m!.rows.map((x) => [x.def.label, x.n])).toEqual(exp.mistakes.rows.map((r) => [r[0], r[1]]));
      m!.rows.forEach((x, i) => expect(x.cost).toBeCloseTo(exp.mistakes!.rows[i][2] as number, 6));
      expect(m!.total.n).toBe(exp.mistakes.total[0]);
      expect(m!.total.cost).toBeCloseTo(exp.mistakes.total[1], 6);
    });

    it(`${exp.view}: insight cards`, () => {
      const a = accounts[acctId];
      const st = walkAccount(a, trades, TZ);
      const got = insights(ts, {
        tz: TZ, strategies, accounts, all: trades, ratings,
        account: scope === 'acct' ? { account: a, isPast: isPast(a, st) } : undefined,
        viewAccountIds: scope === 'acct' ? [acctId] : live,
        demoTrades: scope === 'live' ? trades.filter((t) => accounts[t.accountId].type === 'demo') : undefined,
        challengeTrades: scope === 'live' ? trades.filter((t) => accounts[t.accountId].type === 'challenge') : undefined,
      });
      expect(got.map((x) => [x.tier, canon(x.head)])).toEqual(exp.insights.map(([t, h]) => [t, canon(h)]));
    });
  }

  it('prop rules: every account ends in the same state', () => {
    const got = (fixture.accounts as Account[]).map((a) => {
      const st = walkAccount(a, trades, TZ);
      return [a.id, st.status, st.phase, st.breachKind];
    });
    expect(got).toEqual(fixture.expected[0].walk);
  });
});
