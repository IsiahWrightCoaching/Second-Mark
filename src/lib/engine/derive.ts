import type { AccountType } from './types';
import { BE_BAND, dayKey } from './core';

/** The minimum a saved trade needs for its order-dependent flags to be worked out. */
export interface DeriveInput {
  id: string;
  strategyId: string;
  entryAt: number;
  r: number;
  usd: number;
}

export interface DerivedFlags {
  /** The previous trade on this account was a loss (beyond the breakeven band). */
  afterLoss: boolean;
  /** A challenge was still down on its fee, counting only earlier trades. */
  belowFee: boolean;
  /** Past the strategy's daily trade limit, by entry order within the trader's local day. */
  overLimit: boolean;
}

/**
 * Works out the flags that depend on a trade's place in the account's history. Run it over the whole
 * account after any save, edit or delete, so back-filled or re-timed trades re-mark everything after them.
 */
export function deriveFlags(
  account: { type: AccountType; fee: number },
  trades: DeriveInput[],
  limits: Record<string, number | null>,
  tz: string,
): Map<string, DerivedFlags> {
  const sorted = trades.slice().sort((a, b) => a.entryAt - b.entryAt || a.id.localeCompare(b.id));
  const out = new Map<string, DerivedFlags>();
  const perDay = new Map<string, number>();
  let cum = 0;
  sorted.forEach((t, i) => {
    const prev = sorted[i - 1];
    const k = `${t.strategyId}|${dayKey(t.entryAt, tz)}`;
    const nth = (perDay.get(k) ?? 0) + 1;
    perDay.set(k, nth);
    const max = limits[t.strategyId] ?? null;
    out.set(t.id, {
      afterLoss: !!prev && prev.r <= -BE_BAND,
      belowFee: account.type === 'challenge' && account.fee > 0 && cum < account.fee,
      overLimit: max != null && nth > max,
    });
    cum += t.usd;
  });
  return out;
}
