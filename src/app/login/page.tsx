'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Brand } from '@/components/Brand';

/** Passwordless sign-in: the trader gets a link by email. Nothing to remember, nothing to leak. */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter a valid email address.'); setState('error'); return; }
    setState('sending');
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setError('That didn’t work. Try again in a minute.'); setState('error'); return; }
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
        <form onSubmit={send} className="q" style={{ gap: 14 }}>
          <h1>Sign in</h1>
          <p className="sub">No password. We&apos;ll email you a link.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {state === 'error' && <p className="err" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Email me a link'}</button>
          <p className="hint">18+ only. Second Mark gives feedback on your own behaviour, not financial advice.</p>
        </form>
      )}
    </main>
  );
}
