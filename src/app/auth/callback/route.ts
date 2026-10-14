import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Sends the trader back to sign-in with a reason the login page can explain. */
function back(origin: string, reason: string, detail?: string) {
  const q = new URLSearchParams({ reason });
  if (detail) q.set('detail', detail.slice(0, 200));
  return NextResponse.redirect(`${origin}/login?${q}`);
}

/** The email link lands here with a one-time code, which is swapped for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  // Supabase reports problems with the link itself (expired, already used) as query parameters.
  const linkError = searchParams.get('error_code') ?? searchParams.get('error');
  if (linkError) return back(origin, linkError === 'otp_expired' ? 'expired' : 'link', searchParams.get('error_description') ?? linkError);
  const code = searchParams.get('code');
  if (!code) return back(origin, 'missing');
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // The code only works in the browser that asked for it (PKCE). No stored verifier means a different browser or app.
    const otherBrowser = /verifier/i.test(error.message) || error.code === 'pkce_code_verifier_not_found';
    return back(origin, otherBrowser ? 'browser' : 'exchange', error.code ?? error.message);
  }
  // First visit: the welcome step asks for health-data consent and the trader's time zone.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return back(origin, 'exchange', 'no user after exchange');
  const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user.id).single();
  return NextResponse.redirect(`${origin}${profile?.onboarded_at ? '/today' : '/welcome'}`);
}
