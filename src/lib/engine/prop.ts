import type { Account, Trade } from './types';
import { chron, dayKey } from './core';

export type AccountStatus = 'active' | 'complete' | 'failed' | 'breached' | 'funded' | 'demo';

export interface AccountState {
  status: AccountStatus;
  phase: number;
  /** When each phase was passed (ms). */
  passedAt: number[];
  phaseProfit: number;
  /** Drawdown used in the current phase, dollars. */
  phaseDrawdown: number;
  breachKind: 'max' | 'daily' | null;
  failedAt: number | null;
  totalUsd: number;
}

/**
 * Walk an account's trades in time order through the firm's rules.
 * Closed trades only: a firm that measures equity can breach on an open trade the journal never sees.
 * Manual phase passes are honoured as phase boundaries at the time they were marked.
 */
export function walkAccount(a: Account, trades: Trade[], tz: string): AccountState {
  const st: AccountState = {
    status: a.type === 'challenge' ? 'active' : a.type,
    phase: 1,
    passedAt: [],
    phaseProfit: 0,
    phaseDrawdown: 0,
    breachKind: null,
    failedAt: null,
    totalUsd: 0,
  };
  const ts = chron(trades.filter((t) => t.accountId === a.id));
  const manual = a.manualPasses.slice().sort((x, y) => x - y);
  let cum = 0, peak = 0, day = '', dayPnl = 0;
  const advance = (at: number) => {
    st.passedAt.push(at);
    st.phase++;
    cum = 0; peak = 0; st.phaseProfit = 0; st.phaseDrawdown = 0;
    if (st.phase > a.targets.length) st.status = 'complete';
  };
  for (const t of ts) {
    st.totalUsd += t.usd;
    if (st.failedAt != null || st.status === 'complete') continue;
    while (manual.length && manual[0] <= t.entryAt) advance(manual.shift()!);
    if ((st.status as AccountStatus) === 'complete') continue; // advance() may have changed it
    const k = dayKey(t.entryAt, tz);
    if (k !== day) { day = k; dayPnl = 0; }
    cum += t.usd; dayPnl += t.usd; peak = Math.max(peak, cum);
    const maxUsd = (a.size * a.maxDrawdownPct) / 100;
    const dd = a.ddMode === 'trailing' ? peak - cum : Math.max(0, -cum);
    st.phaseProfit = cum; st.phaseDrawdown = dd;
    if (a.type !== 'demo' && a.maxDrawdownPct && dd >= maxUsd) { fail(st, a, t.entryAt, 'max'); continue; }
    if (a.type !== 'demo' && a.dailyLossPct && -dayPnl >= (a.size * a.dailyLossPct) / 100) { fail(st, a, t.entryAt, 'daily'); continue; }
    if (a.type === 'challenge' && st.phase <= a.targets.length && cum >= (a.size * a.targets[st.phase - 1]) / 100) advance(t.entryAt);
  }
  if (st.failedAt == null) while (manual.length && st.status !== 'complete') advance(manual.shift()!);
  if (a.manualFail) st.status = 'failed';
  if (a.closedAs === 'funded') st.status = 'complete';
  st.totalUsd = Math.round(st.totalUsd);
  return st;
}

function fail(st: AccountState, a: Account, at: number, kind: 'max' | 'daily') {
  st.failedAt = at;
  st.breachKind = kind;
  st.status = a.type === 'challenge' ? 'failed' : 'breached';
}

/** Past accounts are closed to new trades but still count in all-live stats. */
export const isPast = (a: Account, st: AccountState): boolean =>
  a.archived || st.status === 'failed' || st.status === 'breached' || a.closedAs === 'funded';
