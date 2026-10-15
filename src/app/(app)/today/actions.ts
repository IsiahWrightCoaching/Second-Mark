'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getActiveAccount, todayKey } from '@/lib/data';
import type { Carrying, Feeling, NoTradeReason } from '@/lib/engine';

type Result = { error?: string };

export interface CheckinInput {
  sleepHours: number;
  usualSchedule: boolean;
  carrying: Carrying;
  feeling: Feeling;
  water: boolean;
  sharpness: number;
}

const CARRYING: Carrying[] = ['nothing', 'money', 'home', 'work', 'health', 'other'];
const FEELINGS: Feeling[] = ['calm', 'anxious', 'frustrated', 'flat', 'excited'];

/** One check-in per day in the trader's own time zone. Saving again the same day updates it. */
export async function saveCheckin(c: CheckinInput): Promise<Result> {
  if (!(c.sleepHours >= 0 && c.sleepHours <= 16)) return { error: 'Hours slept must be between 0 and 16.' };
  if (!CARRYING.includes(c.carrying) || !FEELINGS.includes(c.feeling)) return { error: 'Answer every question.' };
  if (!(Number.isInteger(c.sharpness) && c.sharpness >= 1 && c.sharpness <= 10)) return { error: 'Sharpness is 1 to 10.' };
  const supabase = await createClient();
  const p = await getProfile(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  if (!p.consent) return { error: 'Turn on the check-in first.' };
  const { error } = await supabase.from('checkins').upsert({
    user_id: p.id, day: todayKey(p.timezone), sleep_hours: c.sleepHours, usual_schedule: c.usualSchedule,
    carrying: c.carrying, feeling: c.feeling, water: c.water, sharpness: c.sharpness,
  }, { onConflict: 'user_id,day' });
  if (error) return { error: 'Couldn’t save the check-in. Try again.' };
  revalidatePath('/today');
  revalidatePath('/log');
  return {};
}

/** Turns on the check-in for someone who skipped it at sign-up. */
export async function giveConsent(): Promise<Result> {
  const supabase = await createClient();
  const p = await getProfile(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  const { error } = await supabase.from('profiles').update({ health_consent_at: new Date().toISOString() }).eq('id', p.id);
  if (error) return { error: 'Couldn’t save. Try again.' };
  revalidatePath('/today');
  return {};
}

const REASONS: NoTradeReason[] = ['no_setup', 'not_right_state', 'news_day', 'fear', 'stopped_at_limit', 'rest_day', 'no_time', 'market_closed', 'other'];
const STATES = ['tired', 'emotional', 'carrying', 'unwell', 'rushed'] as const;

export async function saveNoTradeDay(reason: NoTradeReason, state: (typeof STATES)[number] | null): Promise<Result> {
  if (!REASONS.includes(reason)) return { error: 'Choose a reason.' };
  if (state && !STATES.includes(state)) return { error: 'Choose what’s off.' };
  const supabase = await createClient();
  const p = await getProfile(supabase);
  const a = await getActiveAccount(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  if (!a) return { error: 'Set up an account first.' };
  if (a.closed) return { error: 'This account is closed. Switch to a current account.' };
  const { error } = await supabase.from('no_trade_days').upsert({
    user_id: p.id, account_id: a.id, day: todayKey(p.timezone), reason, state: reason === 'not_right_state' ? state : null,
  }, { onConflict: 'account_id,day' });
  if (error) return { error: 'Couldn’t save. Try again.' };
  revalidatePath('/today');
  return {};
}

export async function clearNoTradeDay(): Promise<Result> {
  const supabase = await createClient();
  const p = await getProfile(supabase);
  const a = await getActiveAccount(supabase);
  if (!p || !a) return { error: 'Signed out. Sign in again.' };
  await supabase.from('no_trade_days').delete().eq('account_id', a.id).eq('day', todayKey(p.timezone));
  revalidatePath('/today');
  return {};
}

export async function rateDay(rating: 'A' | 'B' | 'C'): Promise<Result> {
  if (!['A', 'B', 'C'].includes(rating)) return { error: 'Pick A, B or C.' };
  const supabase = await createClient();
  const p = await getProfile(supabase);
  const a = await getActiveAccount(supabase);
  if (!p) return { error: 'Signed out. Sign in again.' };
  if (!a) return { error: 'Set up an account first.' };
  const { error } = await supabase.from('day_ratings').upsert({ user_id: p.id, account_id: a.id, day: todayKey(p.timezone), rating }, { onConflict: 'account_id,day' });
  if (error) return { error: 'Couldn’t save. Try again.' };
  revalidatePath('/today');
  return {};
}
