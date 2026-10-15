import 'server-only';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_COOKIE } from './activeAccount';
import { deriveFlags, dayKey, type AccountType } from './engine';

export interface Profile {
  id: string;
  timezone: string;
  consent: boolean;
}

export async function getProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('timezone, health_consent_at').eq('id', user.id).single();
  return { id: user.id, timezone: data?.timezone ?? 'Europe/London', consent: !!data?.health_consent_at };
}

export interface ActiveAccount {
  id: string;
  type: AccountType;
  firm: string;
  size: number;
  fee: number;
  /** Archived or moved on to funded. Breaches are worked out from trades in Milestone 5. */
  closed: boolean;
  label: string;
}

const money = (n: number) => '$' + (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
export const accountLabel = (a: { type: string; firm: string; size: number }) =>
  [a.type.charAt(0).toUpperCase() + a.type.slice(1), a.firm, money(a.size)].filter(Boolean).join(' · ');

/** The account picked on the Accounts tab, or the first one if none is picked. */
export async function getActiveAccount(supabase: SupabaseClient): Promise<ActiveAccount | null> {
  const picked = (await cookies()).get(ACTIVE_COOKIE)?.value;
  const { data } = await supabase.from('accounts').select('id, type, firm, size, fee, archived, closed_as').is('deleted_at', null).order('created_at');
  const rows = data ?? [];
  const a = rows.find((x) => x.id === picked) ?? rows.find((x) => !x.archived && !x.closed_as) ?? rows[0];
  if (!a) return null;
  return { id: a.id, type: a.type, firm: a.firm, size: Number(a.size), fee: Number(a.fee), closed: a.archived || !!a.closed_as, label: accountLabel({ type: a.type, firm: a.firm, size: Number(a.size) }) };
}

/** Today's date in the trader's own time zone, as yyyy-mm-dd. */
export const todayKey = (tz: string) => dayKey(Date.now(), tz);

/**
 * Re-marks after-loss, below-fee and over-limit on every trade in an account.
 * Called after any save, edit or delete, because one trade's position changes the ones after it.
 */
export async function rederiveAccount(supabase: SupabaseClient, accountId: string, tz: string): Promise<void> {
  const [{ data: acct }, { data: trades }, { data: strats }] = await Promise.all([
    supabase.from('accounts').select('type, fee').eq('id', accountId).single(),
    supabase.from('trades').select('id, strategy_id, entry_at, r, result_usd, after_loss, below_fee, over_limit').eq('account_id', accountId),
    supabase.from('strategies').select('id, max_per_day'),
  ]);
  if (!acct || !trades) return;
  const limits = Object.fromEntries((strats ?? []).map((s) => [s.id, s.max_per_day]));
  const flags = deriveFlags(
    { type: acct.type, fee: Number(acct.fee) },
    trades.map((t) => ({ id: t.id, strategyId: t.strategy_id, entryAt: Date.parse(t.entry_at), r: Number(t.r), usd: Number(t.result_usd) })),
    limits, tz,
  );
  const changed = trades.filter((t) => {
    const f = flags.get(t.id)!;
    return f.afterLoss !== t.after_loss || f.belowFee !== t.below_fee || f.overLimit !== t.over_limit;
  });
  await Promise.all(changed.map((t) => {
    const f = flags.get(t.id)!;
    return supabase.from('trades').update({ after_loss: f.afterLoss, below_fee: f.belowFee, over_limit: f.overLimit }).eq('id', t.id);
  }));
}
