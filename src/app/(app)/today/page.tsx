import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getActiveAccount, todayKey } from '@/lib/data';
import { CheckIn, ConsentOff, NoTradeTile, DayRating, type CheckinRow } from './TodayParts';

export default async function TodayPage() {
  const supabase = await createClient();
  const [p, a] = await Promise.all([getProfile(supabase), getActiveAccount(supabase)]);
  if (!p) return null;
  const day = todayKey(p.timezone);
  const [{ data: ci }, nt, rating] = await Promise.all([
    supabase.from('checkins').select('sleep_hours, usual_schedule, carrying, feeling, water, sharpness').eq('day', day).maybeSingle(),
    a ? supabase.from('no_trade_days').select('reason, state').eq('account_id', a.id).eq('day', day).maybeSingle() : Promise.resolve({ data: null }),
    a ? supabase.from('day_ratings').select('rating').eq('account_id', a.id).eq('day', day).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const checkin: CheckinRow | null = ci ? {
    sleepHours: Number(ci.sleep_hours), usualSchedule: ci.usual_schedule, carrying: ci.carrying, feeling: ci.feeling, water: ci.water, sharpness: ci.sharpness,
  } : null;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <section>
      <div><h2>{date}</h2><h1>Today</h1></div>
      {!a && (
        <div className="tile">
          <span className="lab">No account yet</span>
          <p className="hint" style={{ fontSize: 14 }}>Set up the account you&apos;re trading on the <Link href="/accounts">Accounts tab</Link> to log trades and no-trade days.</p>
        </div>
      )}
      {p.consent ? <CheckIn saved={checkin} /> : <ConsentOff />}
      {a && !a.closed && <NoTradeTile saved={nt.data ? { reason: nt.data.reason, state: nt.data.state } : null} accountLabel={a.label} />}
      {a && <DayRating saved={(rating.data?.rating as 'A' | 'B' | 'C' | undefined) ?? null} />}
    </section>
  );
}
