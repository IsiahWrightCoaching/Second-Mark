'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_COOKIE } from '@/lib/activeAccount';


export interface AccountInput {
  type: 'challenge' | 'funded' | 'demo';
  firm: string;
  size: number;
  fee: number;
  targets: number[];
  maxDrawdownPct: number;
  dailyLossPct: number;
  ddBasis: 'balance' | 'equity';
  ddMode: 'static' | 'trailing';
  strategyIds: string[];
}

function validate(a: AccountInput): string | null {
  if (!['challenge', 'funded', 'demo'].includes(a.type)) return 'Pick an account type.';
  if (!(a.size > 0)) return 'Enter the account size.';
  if (a.fee < 0) return 'The fee can’t be negative.';
  if (a.type === 'challenge' && (!a.targets.length || a.targets.some((t) => !(t > 0 && t <= 100)))) return 'Enter each phase target as a percentage.';
  if (a.type !== 'demo' && !(a.maxDrawdownPct > 0 && a.maxDrawdownPct <= 100)) return 'Enter the max drawdown as a percentage.';
  if (a.dailyLossPct < 0 || a.dailyLossPct > 100) return 'Daily drawdown must be a percentage.';
  if (!a.strategyIds.length) return 'Pick at least one strategy.';
  return null;
}

export async function createAccount(input: AccountInput): Promise<{ error?: string; id?: string }> {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Signed out. Sign in again.' };
  const demo = input.type === 'demo';
  const { data, error } = await supabase.from('accounts').insert({
    user_id: user.id, type: input.type, firm: demo ? '' : input.firm.trim(), size: input.size, fee: input.type === 'challenge' ? input.fee : 0,
    targets: input.type === 'challenge' ? input.targets : [], max_drawdown_pct: demo ? 0 : input.maxDrawdownPct,
    daily_loss_pct: demo ? 0 : input.dailyLossPct, dd_basis: input.ddBasis, dd_mode: input.ddMode,
  }).select('id').single();
  if (error || !data) return { error: 'Couldn’t create the account.' };
  const { error: e2 } = await supabase.from('account_strategies').insert(input.strategyIds.map((sid) => ({ account_id: data.id, strategy_id: sid, user_id: user.id })));
  if (e2) return { error: 'Account created, but linking its strategies failed. Edit it on this screen.' };
  (await cookies()).set(ACTIVE_COOKIE, data.id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  return { id: data.id };
}

export async function setActiveAccount(id: string) {
  (await cookies()).set(ACTIVE_COOKIE, id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}

export async function toggleAccountStrategy(accountId: string, strategyId: string, on: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Signed out.' };
  if (!on) {
    const { count } = await supabase.from('account_strategies').select('*', { count: 'exact', head: true }).eq('account_id', accountId);
    if ((count ?? 0) <= 1) return { error: 'An account needs at least one strategy.' };
    await supabase.from('account_strategies').delete().eq('account_id', accountId).eq('strategy_id', strategyId);
  } else {
    await supabase.from('account_strategies').insert({ account_id: accountId, strategy_id: strategyId, user_id: user.id });
  }
  revalidatePath('/accounts');
  return {};
}
