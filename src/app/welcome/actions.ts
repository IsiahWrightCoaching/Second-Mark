'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}

export async function saveWelcome(fd: FormData): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const skip = fd.get('skip') === '1';
  if (!skip && fd.get('consent') !== 'on') return { error: 'Tick the box to continue, or continue without the check-in.' };
  const timezone = String(fd.get('timezone') || 'Europe/London');
  if (!validTimeZone(timezone)) return { error: 'That time zone wasn’t recognised. Try something like Europe/London.' };
  const now = new Date().toISOString();
  const { error } = await supabase.from('profiles')
    .update(skip ? { timezone, onboarded_at: now } : { health_consent_at: now, timezone, onboarded_at: now })
    .eq('id', user.id);
  if (error) return { error: 'Couldn’t save. Try again.' };
  redirect('/accounts?first=1');
}
