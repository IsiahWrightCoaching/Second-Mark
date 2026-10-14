'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Brand } from '@/components/Brand';

const REASONS: Record<string, string> = {
  expired: 'That link has expired or was already used. Some email apps open links to scan them, which uses them up. Send yourself a new one.',
  browser: 'That link was opened in a different browser from the one you asked for it in. Send a new link from this browser, then open the email here too. If your email app opens links inside itself, copy the link into this browser instead.',
  missing: 'That link didn’t carry a sign-in code. Send yourself a new one.',
  link: 'That sign-in link didn’t work. Send yourself a new one.',
  exchange: 'Sign-in didn’t complete. Send yourself a new link.',
};

/** Passwordless sign-in: the trader gets a link by email. Nothing to remember, nothing to leak. */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');

  // Explain why a sign-in link didn't work, instead of silently showing this page again.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const reason = q.get('reason');
    if (!reason) return;
    setError(REASONS[reason] ?? REASONS.exchange);
    setDetail(q.get('detail') ?? '');
    setState('error');
    window.history.replaceState(null, '', '/login');
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter a valid email address.'); setState('error'); return; }
    setState('sending');
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setError(error.status === 429 ? 'Too many links sent. Wait a few minutes, then try again.' : 'That didn’t work. Try again in a minute.'); setDetail(error.message); setState('error'); return; }
    setState('sent');
  }

  return (
    <main className="auth">
      <Brand />
      {state === 'sent' ? (
        <>
          <h1>Check your email</h1>
          <p className="sub">We&apos;ve sent a sign-in link to {email}. Open it on this device. It works once and expires after an hour.</p>
          <button className="link" type="button" onClick={() => setState('idle')}>Use a different email</button>
        </>
      ) : (
        <form onSubmit={(e) => { setDetail(''); return send(e); }} className="q" style={{ gap: 14 }}>
          <h1>Sign in</h1>
          <p className="sub">No password. We&apos;ll email you a link.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {state === 'error' && <p className="err" role="alert">{error}</p>}
          {state === 'error' && detail && <p className="hint">Detail for support: {detail}</p>}
          <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Email me a link'}</button>
          <p className="hint">18+ only. Second Mark gives feedback on your own behaviour, not financial advice.</p>
        </form>
      )}
    </main>
  );
}
