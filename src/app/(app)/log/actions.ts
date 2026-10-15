'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getProfile, rederiveAccount } from '@/lib/data';
import { rFromUsd, dayKey, type Exit } from '@/lib/engine';

type Result = { error?: string; id?: string };

export type ImpulseReason = 'fomo' | 'after_loss' | 'boredom' | 'back_to_even' | 'on_a_roll' | 'target_pressure';

export interface TradeInput {
  id?: string;
  accountId: string;
  strategyId: string;
  instrument: string;
  direction: 'long' | 'short';
  /** Entry time, ms since epoch. */
  entryAt: number;
  planned: boolean;
  impulseReason: ImpulseReason | '';
  /** Rules-based: the checklist items ticked as true at entry. */
  ticked: string[];
  /** Discretionary: matched my rules, and the self-graded setup. */
  matched: boolean | null;
  grade: 'A' | 'B' | 'C' | null;
  riskPct: number;
  exit: Exit;
  /** Signed result in account currency, from the platform. */
  resultUsd: number;
  note: string;
  /** Seconds from first tap to save; new trades only. */
  logSeconds: number | null;
}

const IMPULSE: ImpulseReason[] = ['fomo', 'after_loss', 'boredom', 'back_to_even', 'on_a_roll', 'target_pressure'];

function validate(t: TradeInput): string | null {
  if (!t.instrument.trim() || t.instrument.trim().length > 20) return 'Enter the instrument.';
  if (!['long', 'short'].includes(t.direction)) return 'Pick long or short.';
  if (!Number.isFinite(t.entryAt)) return 'Enter the entry time.';
  if (t.entryAt > Date.now() + 5 * 60_000) return 'The entry time is in the future.';
  if (!t.planned && !IMPULSE.includes(t.impulseReason as ImpulseReason)) return 'Pick why you took it.';
  if (!(t.riskPct > 0 && t.riskPct <= 20)) return 'Risk must be above 0 and at most 20%.';
  if (!['as_planned', 'closed_early', 'held_loser'].includes(t.exit)) return 'Pick how you exited.';
  if (!Number.isFinite(t.resultUsd)) return 'Enter the result.';
  if (t.note.length > 280) return 'Keep the note under 280 characters.';
  return null;
}

export async function saveTrade(t: TradeInput): Promise<Result> {
  const err = validate(t);
  if (err) return { error: err };
  const supabase = await createClient();
  const p = await getProfile(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };

  const [{ data: acct }, { data: strat }, { data: link }] = await Promise.all([
    supabase.from('accounts').select('id, size, archived, closed_as, deleted_at').eq('id', t.accountId).single(),
    supabase.from('strategies').select('id, kind, version, checklist, default_risk_pct').eq('id', t.strategyId).single(),
    supabase.from('account_strategies').select('strategy_id').eq('account_id', t.accountId).eq('strategy_id', t.strategyId).maybeSingle(),
  ]);
  if (!acct || acct.deleted_at) return { error: 'Account not found.' };
  if (!strat) return { error: 'Strategy not found.' };
  if (!t.id && (acct.archived || acct.closed_as)) return { error: 'This account is closed. New trades need a current account.' };
  if (!t.id && !link) return { error: 'That strategy isn’t linked to this account.' };

  const kind = strat.kind as 'rules' | 'discretionary';
  const checklist: string[] = strat.checklist ?? [];
  const missed = kind === 'rules' ? checklist.filter((c) => !t.ticked.includes(c)) : [];
  if (kind === 'discretionary' && (t.matched == null || !t.grade)) return { error: 'Answer whether it matched your rules, and grade the setup.' };
  const defaultRisk = Number(strat.default_risk_pct);
  const row = {
    account_id: t.accountId, strategy_id: t.strategyId, entry_at: new Date(t.entryAt).toISOString(),
    instrument: t.instrument.trim().toUpperCase(), direction: t.direction, planned: t.planned, impulse_reason: t.planned ? '' : t.impulseReason,
    rules_met: kind === 'rules' ? missed.length === 0 : !!t.matched, missed_rules: missed, grade: kind === 'discretionary' ? t.grade : null,
    exit: t.exit, risk_pct: t.riskPct, result_usd: Math.round(t.resultUsd * 100) / 100,
    r: Math.round(rFromUsd(t.resultUsd, Number(acct.size), defaultRisk) * 100) / 100, note: t.note.trim(),
  };

  let id = t.id;
  if (id) {
    // Editing keeps the trade's original state, strategy version and default risk.
    const { data: old } = await supabase.from('trades').select('account_id, strategy_id, strategy_version, default_risk_pct').eq('id', id).single();
    if (!old) return { error: 'Trade not found.' };
    if (old.account_id !== t.accountId || old.strategy_id !== t.strategyId) return { error: 'A saved trade can’t move to another account or strategy. Delete it and log it again.' };
    const keepRisk = Number(old.default_risk_pct);
    // Missed rules are checked against the checklist of the version the trade was logged under.
    let oldMissed = missed;
    if (kind === 'rules' && old.strategy_version !== strat.version) {
      const { data: v } = await supabase.from('strategy_versions').select('checklist').eq('strategy_id', old.strategy_id).eq('version', old.strategy_version).maybeSingle();
      if (v) oldMissed = (v.checklist as string[]).filter((c) => !t.ticked.includes(c));
    }
    const { error } = await supabase.from('trades').update({
      ...row, missed_rules: oldMissed, rules_met: kind === 'rules' ? oldMissed.length === 0 : row.rules_met,
      r: Math.round(rFromUsd(t.resultUsd, Number(acct.size), keepRisk) * 100) / 100,
    }).eq('id', id);
    if (error) return { error: 'Couldn’t save the trade. Try again.' };
  } else {
    // State is copied from that day's check-in, in the trader's own time zone. No check-in, or no consent: empty, never a default.
    let state = { sleep_hours: null, usual_schedule: null, carrying: null, feeling: null, water: null, sharpness: null } as Record<string, unknown>;
    if (p.consent) {
      const { data: ci } = await supabase.from('checkins').select('sleep_hours, usual_schedule, carrying, feeling, water, sharpness').eq('day', dayKey(t.entryAt, p.timezone)).maybeSingle();
      if (ci) state = ci;
    }
    const { data, error } = await supabase.from('trades').insert({
      ...row, ...state, user_id: p.id, strategy_version: strat.version, default_risk_pct: defaultRisk, log_seconds: t.logSeconds,
    }).select('id').single();
    if (error || !data) return { error: 'Couldn’t save the trade. Try again.' };
    id = data.id;
  }
  await rederiveAccount(supabase, t.accountId, p.timezone);
  revalidatePath('/log');
  revalidatePath('/today');
  return { id };
}

export async function deleteTrade(id: string): Promise<Result> {
  const supabase = await createClient();
  const p = await getProfile(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  const { data: old } = await supabase.from('trades').select('account_id').eq('id', id).single();
  if (!old) return { error: 'Trade not found.' };
  const { error } = await supabase.from('trades').delete().eq('id', id);
  if (error) return { error: 'Couldn’t delete the trade. Try again.' };
  await rederiveAccount(supabase, old.account_id, p.timezone);
  revalidatePath('/log');
  return {};
}

export async function logSkippedSetup(accountId: string, reason: 'fear' | 'away' | 'too_late'): Promise<Result> {
  if (!['fear', 'away', 'too_late'].includes(reason)) return { error: 'Pick a reason.' };
  const supabase = await createClient();
  const p = await getProfile(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  const { error } = await supabase.from('skipped_setups').insert({ user_id: p.id, account_id: accountId, reason });
  if (error) return { error: 'Couldn’t save. Try again.' };
  revalidatePath('/log');
  return {};
}
