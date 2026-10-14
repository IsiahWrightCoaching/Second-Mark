import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** The email link lands here with a one-time code, which is swapped for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${origin}/login`);
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);
  // First visit: the welcome step asks for health-data consent and the trader's time zone.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user!.id).single();
  return NextResponse.redirect(`${origin}${profile?.onboarded_at ? '/today' : '/welcome'}`);
}
