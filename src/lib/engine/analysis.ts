import type { Trade, Strategy, Account, DayRating, Feeling } from './types';
import {
  MIN, GAP, ZCRIT, EARLY, followed, offPlan, outcome, sumR, avgR, pc, chron, core,
  welch, prop2, probit, profitFactor, sessionOf, localHour, weekday, tradeNumber, dayKey,
} from './core';
import { fR, fR2, pl, money, pfText } from './format';

/* ================= state patterns ================= */

export interface StateTest {
  key: 'sleep' | 'schedule' | 'carrying' | 'feeling' | 'water' | 'sharpness' | 'afterLoss' | 'belowFee';
  has?: (t: Trade) => boolean;
  only?: (t: Trade) => boolean;
  group: (t: Trade) => boolean;
  measure: (t: Trade) => boolean;
  measureName: string;
  label: string;
  other: string;
  tip: string;
}

/** Tips lead with an action and never refer to course material. */
export const STATE_TESTS: StateTest[] = [
  { key: 'sleep', has: (t) => t.sleepHours != null, group: (t) => (t.sleepHours ?? 99) < 6, measure: offPlan, measureName: 'went off plan', label: "on under 6 hours' sleep", other: 'on 6 hours or more', tip: 'On a short night, cut your size or sit the day out. Your own numbers say it costs you.' },
  { key: 'schedule', has: (t) => t.usualSchedule != null, group: (t) => t.usualSchedule === false, measure: offPlan, measureName: 'went off plan', label: 'after an off-schedule night', other: 'after a normal night', tip: 'Treat a broken or late night like a short one, even if the hours look fine.' },
  { key: 'carrying', has: (t) => t.carrying != null, group: (t) => t.carrying !== 'nothing', measure: (t) => !t.planned, measureName: 'were impulsive', label: 'on days you were carrying something from outside trading', other: 'on clear days', tip: 'Name it before you open a chart. If it is loud, trade smaller or not at all.' },
  { key: 'feeling', has: (t) => t.feeling != null, group: (t) => t.feeling !== 'calm', measure: offPlan, measureName: 'went off plan', label: "on days you didn't feel calm", other: 'on calm days', tip: "Name the feeling before you open a chart. If you're not calm, trade at your default size with a one-trade limit, or sit the day out." },
  { key: 'water', has: (t) => t.water != null, group: (t) => t.water === false, measure: offPlan, measureName: 'went off plan', label: "on days you hadn't had water before trading", other: 'on days you had', tip: 'Have a glass of water before the session, and see whether the gap closes.' },
  { key: 'sharpness', has: (t) => t.sharpness != null, group: (t) => (t.sharpness ?? 99) <= 4, measure: offPlan, measureName: 'went off plan', label: 'when you rated yourself 4 or under', other: 'when you rated yourself 5 or over', tip: 'Rate yourself 4 or under? Set a one-trade limit for the day, at your default size.' },
  { key: 'afterLoss', group: (t) => t.afterLoss, measure: (t) => !t.planned, measureName: 'were impulsive', label: 'straight after a loss', other: 'the rest of the time', tip: 'Set a fixed break after every loss, such as 15 minutes away from the screen. A rule made in advance beats a decision made in the moment.' },
  { key: 'belowFee', group: (t) => t.belowFee, measure: (t) => t.riskPct > t.defaultRiskPct, measureName: 'were oversized', label: 'while still down on your challenge fee', other: 'once the fee was covered', tip: 'While you are still down on the fee, lock your risk at the default. Being down is when sizing creeps.' },
];

export type StateResult =
  | { state: 'wait'; test: StateTest }
  | { state: 'none'; test: StateTest; ra: number; rb: number }
  | { state: 'found'; test: StateTest; ra: number; rb: number; n: number; z: number; text: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A pattern needs MIN trades each side, a GAP-point difference and z >= ZCRIT (Bonferroni over the 8 tests). */
export function runStateTest(T: StateTest, ts: Trade[], isChallenge: (t: Trade) => boolean): StateResult {
  const pool = ts.filter((t) => (!T.has || T.has(t)) && (T.key !== 'belowFee' || isChallenge(t)));
  const A = pool.filter(T.group), B = pool.filter((t) => !T.group(t));
  if (A.length < MIN || B.length < MIN) return { state: 'wait', test: T };
  const ka = A.filter(T.measure).length, kb = B.filter(T.measure).length;
  const ra = pc(ka, A.length), rb = pc(kb, B.length), z = prop2(ka, A.length, kb, B.length);
  if (ra - rb < GAP || z < ZCRIT) return { state: 'none', test: T, ra, rb };
  return { state: 'found', test: T, ra, rb, n: A.length + B.length, z, text: `${cap(T.label)}, ${ra}% of your trades ${T.measureName}. ${cap(T.other)}, ${rb}%.` };
}

/* ================= the second mark grid ================= */

export function boxes(ts: Trade[]) {
  const d = ts.filter((t) => outcome(t) !== 'be');
  return {
    earned: d.filter((t) => followed(t) && outcome(t) === 'win'),
    badLuck: d.filter((t) => followed(t) && outcome(t) === 'loss'),
    rewardedMistake: d.filter((t) => offPlan(t) && outcome(t) === 'win'),
    lesson: d.filter((t) => offPlan(t) && outcome(t) === 'loss'),
    breakeven: ts.filter((t) => outcome(t) === 'be'),
  };
}

/* ================= splits ================= */

export type SplitKey = 'strategy' | 'instrument' | 'direction' | 'session' | 'weekday' | 'hour' | 'tradeNumber' | 'version' | 'accountType';

export interface SplitCtx {
  tz: string;
  strategies: Record<string, Strategy>;
  accounts: Record<string, Account>;
  /** All trades, for trade-number-in-day. */
  all: Trade[];
}

export const SPLIT_LABEL: Record<SplitKey, string> = {
  strategy: 'Strategy', instrument: 'Instrument', direction: 'Direction', session: 'Session', weekday: 'Weekday',
  hour: 'Entry hour', tradeNumber: 'Trade number that day', version: 'Strategy version', accountType: 'Account type',
};

export function splitKey(by: SplitKey, t: Trade, c: SplitCtx): string {
  const s = c.strategies[t.strategyId];
  switch (by) {
    case 'strategy': return s ? s.name + (s.kind === 'discretionary' ? ' (self-graded)' : '') : 'Unknown';
    case 'instrument': return t.instrument;
    case 'direction': return t.direction === 'long' ? 'Long' : 'Short';
    case 'session': return sessionOf(t.entryAt);
    case 'weekday': return weekday(t.entryAt, c.tz);
    case 'hour': return String(localHour(t.entryAt, c.tz)).padStart(2, '0') + ':00';
    case 'tradeNumber': return ['1st', '2nd', '3rd+'][Math.min(tradeNumber(t, c.all, c.tz), 3) - 1];
    case 'version': return `${s ? s.name : 'Unknown'} v${t.strategyVersion}`;
    case 'accountType': { const a = c.accounts[t.accountId]; return a ? cap(a.type) : 'Unknown'; }
  }
}

const ORDER: Partial<Record<SplitKey, string[]>> = {
  weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  tradeNumber: ['1st', '2nd', '3rd+'],
};

export interface SplitRow { key: string; trades: Trade[]; n: number; toPlanPct: number; winPct: number; avg: number; total: number }

export function splitRows(by: SplitKey, ts: Trade[], c: SplitCtx): SplitRow[] {
  const g = new Map<string, Trade[]>();
  for (const t of ts) { const k = splitKey(by, t, c); (g.get(k) ?? g.set(k, []).get(k)!).push(t); }
  const rows = [...g.entries()].map(([key, v]) => ({
    key, trades: v, n: v.length, toPlanPct: pc(v.filter(followed).length, v.length),
    winPct: pc(v.filter((t) => outcome(t) === 'win').length, v.length), avg: sumR(v) / v.length, total: sumR(v),
  }));
  const o = ORDER[by];
  if (by === 'hour') rows.sort((a, b) => a.key.localeCompare(b.key));
  else if (o) rows.sort((a, b) => o.indexOf(a.key) - o.indexOf(b.key));
  else rows.sort((a, b) => b.n - a.n);
  return rows;
}

/** Best and worst by average R a trade, among groups with MIN+ trades. */
export function bestWorst(by: SplitKey, ts: Trade[], c: SplitCtx): { best: SplitRow; worst: SplitRow } | null {
  const r = splitRows(by, ts, c).filter((x) => x.n >= MIN).sort((a, b) => b.avg - a.avg);
  return r.length >= 2 ? { best: r[0], worst: r[r.length - 1] } : null;
}

/* ================= streaks ================= */

export function afterTwoLosses(ts: Trade[]): { group: Trade[]; rest: Trade[] } {
  const c = chron(ts), group: Trade[] = [], rest: Trade[] = [];
  c.forEach((t, i) => {
    if (i < 2) return;
    (outcome(c[i - 1]) === 'loss' && outcome(c[i - 2]) === 'loss' ? group : rest).push(t);
  });
  return { group, rest };
}

export function afterTwoWins(ts: Trade[]): { group: Trade[]; rest: Trade[] } {
  const c = chron(ts), group: Trade[] = [], rest: Trade[] = [];
  c.forEach((t, i) => {
    if (i < 2) return;
    (outcome(c[i - 1]) === 'win' && outcome(c[i - 2]) === 'win' ? group : rest).push(t);
  });
  return { group, rest };
}

export const FEELING_LABEL: Record<Feeling, string> = { calm: 'Calm', anxious: 'Anxious', frustrated: 'Frustrated or angry', flat: 'Flat or bored', excited: 'Excited' };

/**
 * Plan rate for each feeling, for display under the feeling pattern. Descriptive only: the single
 * calm-against-the-rest test decides whether anything is claimed, so the bar doesn't rise per option.
 */
export function feelingBreakdown(ts: Trade[]): { feeling: Feeling; label: string; n: number; toPlan: number | null }[] {
  return (Object.keys(FEELING_LABEL) as Feeling[]).map((f) => {
    const v = ts.filter((t) => t.feeling === f);
    return { feeling: f, label: FEELING_LABEL[f], n: v.length, toPlan: v.length >= MIN ? pc(v.filter(followed).length, v.length) : null };
  });
}

export function streaks(ts: Trade[]) {
  let cw = 0, cl = 0, mw = 0, ml = 0;
  for (const t of chron(ts)) {
    const o = outcome(t);
    if (o === 'win') { cw++; cl = 0; } else if (o === 'loss') { cl++; cw = 0; } else { cw = 0; cl = 0; }
    mw = Math.max(mw, cw); ml = Math.max(ml, cl);
  }
  return { maxWins: mw, maxLosses: ml, current: cw ? { kind: 'win' as const, n: cw } : cl ? { kind: 'loss' as const, n: cl } : null };
}

/* ================= strategy or execution ================= */

export interface Verdict {
  strategyId: string;
  name: string;
  kind: 'wait' | 'strategy' | 'execution' | 'working';
  early: boolean;
  head: string;
  text: string;
  short?: string;
  estimate?: boolean;
}

/** Each strategy judged only on its plan trades, using the full record. */
export function verdicts(ts: Trade[], strategies: Record<string, Strategy>): Verdict[] {
  const g = new Map<string, Trade[]>();
  for (const t of ts) (g.get(t.strategyId) ?? g.set(t.strategyId, []).get(t.strategyId)!).push(t);
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length).map(([sid, v]) => {
    const s = strategies[sid];
    const name = (s?.name ?? 'Unknown') + (s?.kind === 'discretionary' ? ' (self-graded)' : '');
    const fo = v.filter(followed), pe = avgR(fo)!, ae = avgR(v)!, early = fo.length < EARLY;
    if (fo.length < MIN) {
      return { strategyId: sid, name, kind: 'wait', early: true, head: 'Too early to judge',
        text: `${fo.length} of ${pl(v.length, 'trade')} followed the plan, so the strategy itself can't be judged yet. That needs at least ${MIN} plan trades. What you can see: ${fR(sumR(v))} across all ${pl(v.length, 'trade')} on it${fo.length < v.length / 2 ? ', mostly off plan' : ''}.` };
    }
    if (pe <= 0) {
      return { strategyId: sid, name, kind: 'strategy', early,
        head: early ? 'Early warning: the strategy may need work' : 'The strategy needs work',
        text: early
          ? `So far, followed exactly, it averages ${fR2(pe)} a trade across ${pl(fo.length, 'plan trade')}. That's too few to be sure. If it's still negative after ${EARLY}, look at the rules before your discipline.`
          : `Followed exactly, it averages ${fR2(pe)} a trade across ${pl(fo.length, 'plan trade')}. Following it more closely won't fix that. Look at the rules first.`,
        short: `${name} averages ${fR2(pe)} a trade even when you follow it exactly. The rules need work before your discipline does.` };
    }
    const gap = pe - ae;
    if (gap >= 0.15) {
      return { strategyId: sid, name, kind: 'execution', early, estimate: true, head: 'The strategy works. Execution is the gap',
        text: `Followed exactly, it averages ${fR2(pe)} a trade. Across all ${pl(v.length, 'trade')} on it, you average ${fR2(ae)}. Trading it as written would have made roughly ${fR(gap * v.length)} more.`,
        short: `${name} averages ${fR2(pe)} a trade when you follow it, and ${fR2(ae)} across all your trades on it. The gap is execution, not the strategy.` };
    }
    return { strategyId: sid, name, kind: 'working', early, head: 'Working as written',
      text: `Followed exactly, it averages ${fR2(pe)} a trade, and you're trading it close to that: ${fR2(ae)} across all ${pl(v.length, 'trade')}.` };
  });
}

/* ================= mistakes ================= */

export interface MistakeDef { key: string; label: string; test: (t: Trade) => boolean; goal: string; verb: string; plans: [string, string] }

export const MISTAKES: MistakeDef[] = [
  { key: 'impulsive', label: 'Impulsive entries', test: (t) => !t.planned, goal: 'No impulsive entries', verb: 'were impulsive',
    plans: ["If I want a trade that isn't in my plan, then I write down why and wait 10 minutes.", 'If I have just taken a loss, then I step away from the screen for 15 minutes.'] },
  { key: 'checklist', label: 'Entered with the checklist not met', test: (t) => t.planned && !t.rulesMet, goal: 'Only enter with every checklist rule met', verb: 'missed a checklist rule',
    plans: ["If any rule on my checklist isn't true, then I don't enter, however good it looks.", "If I'm unsure a rule is met, then I count it as not met."] },
  { key: 'overLimit', label: 'Traded over your daily limit', test: (t) => t.overLimit, goal: 'Stop at your daily trade limit', verb: 'were over the limit',
    plans: ['If I reach my trade limit, then I close the platform for the day.', 'If I reach my limit and see another setup, then I log it as skipped instead.'] },
  { key: 'oversized', label: 'Oversized', test: (t) => t.riskPct > t.defaultRiskPct, goal: 'Stick to your default risk', verb: 'were oversized',
    plans: ['If I want to size up, then I place the trade at my default risk anyway.', "If I'm down on the account, then my risk stays at the default."] },
  { key: 'heldLoser', label: 'Held a loser or moved the stop', test: (t) => t.exit === 'held_loser', goal: 'Leave the stop where you put it', verb: 'held a loser or moved the stop',
    plans: ['If price nears my stop, then I take my hand off the mouse and let it hit.', 'If I want to move my stop, then I close the trade instead.'] },
  { key: 'closedEarly', label: 'Closed winners early', test: (t) => t.exit === 'closed_early', goal: 'Let winners run to your planned exit', verb: 'closed a winner early',
    plans: ['If I want to close a winner early, then I set an alert at my target and look away.', 'If a trade is in profit, then I only touch it if my plan says to.'] },
];

export interface MistakeCost { def: MistakeDef; n: number; cost: number; how: string }

/** Costs measured against the trader's own plan trades. Rows overlap; total counts each off-plan trade once. */
export function mistakeCosts(ts: Trade[]): { rows: MistakeCost[]; total: { n: number; cost: number } } | null {
  const fo = ts.filter(followed);
  if (fo.length < MIN) return null;
  const pe = avgR(fo)!;
  const pw = avgR(fo.filter((t) => outcome(t) === 'win'));
  const plo = avgR(fo.filter((t) => outcome(t) === 'loss')) ?? -1;
  const vsPlan = (v: Trade[]) => sumR(v) - v.length * pe;
  const how: Record<string, [(v: Trade[]) => number, string]> = {
    impulsive: [vsPlan, 'compared with your average plan trade'],
    checklist: [vsPlan, 'compared with your average plan trade'],
    overLimit: [vsPlan, 'compared with your average plan trade'],
    oversized: [(v) => v.reduce((a, t) => a + (t.r - (t.r * t.defaultRiskPct) / t.riskPct), 0), 'the extra R from the bigger size'],
    heldLoser: [(v) => v.reduce((a, t) => a + (t.r < 0 ? t.r - plo : 0), 0), 'beyond your normal planned loss'],
    closedEarly: [(v) => (pw == null ? 0 : v.reduce((a, t) => a + (t.r > 0 ? t.r - pw : 0), 0)), 'short of your average planned win'],
  };
  const rows = MISTAKES.map((def) => {
    const v = ts.filter(def.test);
    return { def, n: v.length, cost: v.length ? how[def.key][0](v) : 0, how: how[def.key][1] };
  }).filter((m) => m.n).sort((a, b) => a.cost - b.cost);
  const off = ts.filter(offPlan);
  return { rows, total: { n: off.length, cost: off.length ? sumR(off) - off.length * pe : 0 } };
}

/* ================= insights: Stats findings stated on Review ================= */

export interface Insight {
  source: SplitKey | 'pattern' | 'streak' | 'rule' | 'robust' | 'bigLosses' | 'drawdown' | 'ratings' | 'demoGap' | 'winStreak' | 'earlyChange';
  tier: 'clear' | 'early' | 'fact';
  score: number;
  head: string;
  body: string;
  action: string;
}

const SPLIT_ACTION: Partial<Record<SplitKey, (g: string, lose: boolean) => string>> = {
  instrument: (g, lose) => (lose ? `Trade ${g} smaller or pause it until you know why it loses.` : `${g} is where your edge shows up. Make it your main market.`),
  strategy: (g, lose) => (lose ? `Pause ${g}, or rewrite its rules and test them on demo.` : `Put your screen time into ${g}.`),
  session: (g, lose) => (lose ? `Skip the ${g} session, or trade it at smaller size.` : `The ${g} session is where you make your money. Protect it.`),
  weekday: (g, lose) => (lose ? `Try ${g}s at half size, or as a day off.` : `${g}s work for you. Notice what's different about them.`),
  hour: (g, lose) => (lose ? `Check whether ${g} entries are inside your plan's trading window.` : `Your ${g} entries work best. Is that your plan's window?`),
  direction: (g, lose) => (lose ? `Check whether your ${g.toLowerCase()} trades actually fit your strategy's rules.` : `Your ${g.toLowerCase()} trades carry your results.`),
  tradeNumber: (g, lose) => (lose ? `Try capping your trades for the day before you reach your ${g}.` : `Your ${g} trade of the day does best.`),
  version: (g, lose) => (lose ? `${g} did worse. Consider going back to the earlier rules.` : `${g} is working better than your earlier rules.`),
};
const SPLIT_HEAD: Partial<Record<SplitKey, (g: string) => string>> = {
  instrument: (g) => g, strategy: (g) => g, session: (g) => `The ${g} session`, weekday: (g) => `${g}s`,
  hour: (g) => `Entries at ${g}`, direction: (g) => `${g} trades`, tradeNumber: (g) => `Your ${g} trade of the day`, version: (g) => g,
};
const SPLIT_NOUN: Partial<Record<SplitKey, string>> = {
  instrument: 'instrument', strategy: 'strategy', session: 'session', weekday: 'weekday', hour: 'entry hour',
  direction: 'direction', tradeNumber: 'trade of the day', version: 'version',
};

export interface InsightCtx extends SplitCtx {
  /** Set when viewing one account: enables the drawdown card. */
  account?: { account: Account; isPast: boolean };
  ratings: DayRating[];
  /** Account ids in the current view, for day ratings. */
  viewAccountIds: string[];
  /** All-live view only: demo and challenge trades, for the demo-gap card. */
  demoTrades?: Trade[];
  challengeTrades?: Trade[];
}

export function insights(ts: Trade[], c: InsightCtx): Insight[] {
  const cards: (Insight & { sig?: string; also?: string[] })[] = [];
  if (ts.length < MIN * 2) return [];
  const isChallenge = (t: Trade) => c.accounts[t.accountId]?.type === 'challenge';

  /* 1 splits: each group against the rest */
  const multiVersion = [...ts.reduce((m, t) => m.set(t.strategyId, (m.get(t.strategyId) ?? new Set()).add(t.strategyVersion)), new Map<string, Set<number>>()).values()].some((x) => x.size > 1);
  const keys = (Object.keys(SPLIT_ACTION) as SplitKey[]).filter((k) => k !== 'version' || multiVersion);
  const cand: { k: SplitKey; key: string; v: Trade[]; r: Trade[]; z: number }[] = [];
  let tested = 0;
  for (const k of keys) {
    for (const row of splitRows(k, ts, c)) {
      const v = row.trades;
      if (v.length < MIN) continue;
      const set = new Set(v), r = ts.filter((t) => !set.has(t));
      if (r.length < MIN) continue;
      tested++;
      const z = welch(v, r), pv = profitFactor(v), pr = profitFactor(r), gap = Math.abs(avgR(v)! - avgR(r)!);
      const straddle = pv != null && pr != null && ((pv < 1 && pr > 1.1) || (pv > 1.1 && pr < 1));
      if (straddle && gap >= 0.4 && Math.abs(z) >= 1.96) cand.push({ k, key: row.key, v, r, z });
    }
  }
  const zB = probit(1 - 0.05 / (2 * Math.max(1, tested)));
  const bestPer = new Map<SplitKey, (typeof cand)[number]>();
  /* Ties (two groups mirror each other, e.g. only two instruments) go to the losing side: it is the one you can act on. */
  const losing = (x: (typeof cand)[number]) => (avgR(x.v)! < avgR(x.r)! ? 0 : 1);
  const byStrength = (a: (typeof cand)[number], b: (typeof cand)[number]) => Math.abs(b.z) - Math.abs(a.z) > 1e-9 ? 1 : Math.abs(a.z) - Math.abs(b.z) > 1e-9 ? -1 : losing(a) - losing(b);
  for (const x of cand.sort(byStrength)) if (!bestPer.has(x.k)) bestPer.set(x.k, x);
  const seen: typeof cards = [];
  for (const x of [...bestPer.values()].sort(byStrength)) {
    const sig = x.v.map((t) => t.id).sort().join();
    const dup = seen.find((s) => s.sig === sig);
    if (dup) { dup.also!.push(SPLIT_HEAD[x.k]!(x.key).replace(/^The /, 'the ')); continue; }
    const lose = avgR(x.v)! < avgR(x.r)!;
    const card = {
      sig, also: [] as string[], source: x.k, score: Math.abs(x.z), tier: (Math.abs(x.z) >= zB ? 'clear' : 'early') as Insight['tier'],
      head: `${SPLIT_HEAD[x.k]!(x.key)}: ${lose ? 'losing you money' : 'your best ' + SPLIT_NOUN[x.k]}`,
      body: `Profit factor ${pfText(profitFactor(x.v))}, averaging ${fR2(avgR(x.v))} a trade over ${pl(x.v.length, 'trade')}. The rest of your trades: profit factor ${pfText(profitFactor(x.r))}, ${fR2(avgR(x.r))} a trade.`,
      action: SPLIT_ACTION[x.k]!(x.key, lose),
    };
    seen.push(card); cards.push(card);
  }
  for (const card of cards) if (card.also?.length) card.body += ` These are exactly the same trades as ${card.also.join(' and ')}, so it's one finding, not two.`;

  /* 2 state patterns that passed their corrected test */
  for (const r of STATE_TESTS.map((T) => runStateTest(T, ts, isChallenge))) {
    if (r.state !== 'found') continue;
    cards.push({ source: 'pattern', score: 3, tier: 'clear', head: r.text.split('.')[0] + '.', body: r.text.split('. ').slice(1).join('. '), action: r.test.tip });
  }

  /* 3 after two losses in a row */
  {
    const { group, rest } = afterTwoLosses(ts);
    if (group.length >= MIN && rest.length >= MIN) {
      const kg = group.filter(followed).length, kr = rest.filter(followed).length, z = prop2(kr, rest.length, kg, group.length);
      if (pc(kr, rest.length) - pc(kg, group.length) >= GAP && z >= 1.96)
        cards.push({ source: 'streak', score: z, tier: z >= ZCRIT ? 'clear' : 'early', head: 'Two losses in a row knock you off plan',
          body: `The trade after two losses in a row went to plan ${pc(kg, group.length)}% of the time (${pl(group.length, 'trade')}). Every other trade: ${pc(kr, rest.length)}%.`,
          action: 'Decide your stop for the day before the session starts, not after the second loss.' });
    }
  }

  /* 3b after two wins in a row: sizing creeps with "house money" (Thaler and Johnson, 1990) */
  {
    const { group, rest } = afterTwoWins(ts);
    const big = (t: Trade) => t.riskPct > t.defaultRiskPct;
    if (group.length >= MIN && rest.length >= MIN) {
      const kg = group.filter(big).length, kr = rest.filter(big).length, z = prop2(kg, group.length, kr, rest.length);
      if (pc(kg, group.length) - pc(kr, rest.length) >= GAP && z >= 1.96)
        cards.push({ source: 'winStreak', score: z, tier: z >= ZCRIT ? 'clear' : 'early', head: 'Two wins in a row and your size creeps up',
          body: `After two wins in a row, ${pc(kg, group.length)}% of your trades were oversized (${pl(group.length, 'trade')}). Every other trade: ${pc(kr, rest.length)}%.`,
          action: 'After two wins, keep risk at your default. Profit from earlier trades is still your money.' });
    }
  }

  /* 4 a skipped checklist rule that costs R */
  {
    const g = new Map<string, Trade[]>();
    for (const t of ts) if (c.strategies[t.strategyId]?.kind === 'rules') (g.get(t.strategyId) ?? g.set(t.strategyId, []).get(t.strategyId)!).push(t);
    for (const [sid, v] of g) {
      const met = v.filter((t) => !t.missedRules.length);
      if (met.length < MIN) continue;
      const rules = [...new Set(v.flatMap((t) => t.missedRules))].map((name) => ({ name, m: v.filter((t) => t.missedRules.includes(name)) }))
        .filter((x) => x.m.length >= MIN).sort((a, b) => avgR(a.m)! - avgR(b.m)!);
      const x = rules[0];
      if (!x) continue;
      const z = welch(met, x.m), gap = avgR(met)! - avgR(x.m)!;
      if (gap >= 0.4 && z >= 1.96)
        cards.push({ source: 'rule', score: z, tier: z >= zB ? 'clear' : 'early', head: `Skipping "${x.name}" costs you`,
          body: `${c.strategies[sid].name}: trades that skipped it averaged ${fR2(avgR(x.m))} over ${pl(x.m.length, 'trade')}. Trades with every rule met: ${fR2(avgR(met))}.`,
          action: 'That rule is earning its place. Treat it as non-negotiable.' });
    }
  }

  /* 5 facts */
  if (ts.length >= 20) {
    const top = ts.slice().sort((a, b) => b.r - a.r).slice(0, 3).filter((t) => t.r > 0);
    const tot = sumR(ts), wo = tot - sumR(top);
    if (tot > 0 && wo <= 0)
      cards.push({ source: 'robust', score: 2, tier: 'fact', head: 'Your profit rests on three trades',
        body: `This record is ${fR(tot)}. Without your best 3 trades it would be ${fR(wo)}.`,
        action: "Your edge isn't proven yet. Keep risk small until the rest of your trades pay on their own." });
  }
  {
    const big = ts.filter((t) => t.r <= -1.5);
    if (big.length >= 3 && sumR(big) <= -4) {
      const held = big.filter((t) => t.exit === 'held_loser').length, over = big.filter((t) => t.riskPct > t.defaultRiskPct).length;
      cards.push({ source: 'bigLosses', score: 2.1, tier: 'fact', head: `${pl(big.length, 'loss', 'losses')} bigger than 1.5R`,
        body: `Together they cost ${fR(sumR(big))}. ${held} came from holding a loser or moving the stop, ${over} from oversizing.`,
        action: held >= over ? 'Leave the stop where you put it. These losses are optional.' : 'Keep risk at your default. These losses are optional.' });
    }
  }
  if (c.account && !c.account.isPast && (c.account.account.type === 'challenge' || c.account.account.type === 'funded') && c.account.account.maxDrawdownPct) {
    const a = c.account.account, s = c.strategies[a.strategyIds[0]];
    const rUsd = (a.size * (s?.defaultRiskPct ?? 1)) / 100, lim = (a.size * a.maxDrawdownPct) / 100, dd = core(ts).maxDrawdown;
    const share = Math.round(((dd * rUsd) / lim) * 100);
    if (share >= 50)
      cards.push({ source: 'drawdown', score: share >= 80 ? 3.5 : 2.2, tier: 'fact', head: `Your worst run would use ${share}% of this account's drawdown`,
        body: `Your deepest losing run here was ${fR(-dd)}. At ${money(rUsd)} a trade, that's ${money(dd * rUsd)} of the ${money(lim)} the firm allows.`,
        action: share >= 80 ? 'One bad run from failing. Consider cutting risk per trade until you have a buffer.' : 'Leave room: consider a smaller risk per trade until you have a buffer.' });
  }

  /* 5b a strategy changed before its last version had enough trades to judge */
  {
    let latest: { name: string; v: number; n: number; at: number } | null = null;
    for (const s of Object.values(c.strategies)) {
      const mine = c.all.filter((t) => t.strategyId === s.id);
      for (let v = 1; v < s.version; v++) {
        const old = mine.filter((t) => t.strategyVersion === v);
        if (!old.length || old.length >= EARLY) continue;
        const at = Math.max(...old.map((t) => t.entryAt));
        if (!latest || at > latest.at) latest = { name: s.name, v, n: old.length, at };
      }
    }
    if (latest && ts.some((t) => c.strategies[t.strategyId]?.name === latest!.name))
      cards.push({ source: 'earlyChange', score: 1.8, tier: 'fact', head: `You changed ${latest.name} after ${pl(latest.n, 'trade')}`,
        body: `Version ${latest.v} had ${pl(latest.n, 'trade')} before the rules changed. Under ${EARLY} trades, a result can't separate the rules from luck, so you can't yet tell whether the change helped.`,
        action: `Give the current version at least ${EARLY} trades before changing it again, unless a rule is plainly broken.` });
  }

  /* 6 day ratings */
  {
    const aDays = c.ratings.filter((d) => c.viewAccountIds.includes(d.accountId) && d.rating === 'A');
    const keysA = new Set(aDays.map((d) => d.accountId + d.dayKey));
    const at = c.all.filter((t) => keysA.has(t.accountId + dayKey(t.entryAt, c.tz)));
    if (aDays.length >= 5 && at.length >= MIN && pc(at.filter(followed).length, at.length) < 75)
      cards.push({ source: 'ratings', score: 1.5, tier: 'fact', head: "You rate days A that weren't",
        body: `You rated ${pl(aDays.length, 'day')} as A game. Only ${pc(at.filter(followed).length, at.length)}% of the trades on those days were to plan.`,
        action: 'Rate the day from your log, not from how it felt or whether it made money.' });
  }

  /* 7 demo against live */
  if (c.demoTrades && c.challengeTrades && c.demoTrades.length >= MIN && c.challengeTrades.length >= MIN) {
    const d = c.demoTrades, ch = c.challengeTrades, kd = d.filter(followed).length, kc = ch.filter(followed).length, z = prop2(kd, d.length, kc, ch.length);
    if (pc(kd, d.length) - pc(kc, ch.length) >= GAP && z >= 1.96)
      cards.push({ source: 'demoGap', score: z, tier: z >= ZCRIT ? 'clear' : 'early', head: 'You trade differently when the money is real',
        body: `${pc(kd, d.length)}% of your demo trades were to plan, against ${pc(kc, ch.length)}% on challenges.`,
        action: 'Your strategy knowledge is fine. The gap is pressure, and that is trainable.' });
  }

  const rank = { clear: 0, fact: 1, early: 2 } as const;
  return cards.map(({ sig: _s, also: _a, ...card }) => card).sort((a, b) => rank[a.tier] - rank[b.tier] || b.score - a.score);
}
