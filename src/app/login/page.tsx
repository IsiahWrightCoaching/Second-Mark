'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Brand } from '@/components/Brand';

const REASONS: Record<string, string> = {
  expired: 'That link has expired or was already used. Some email apps open links to scan them, which uses them up. Use the code in the email instead.',
  browser: 'That link opened in a different app or browser from the one you signed in from. Use the 6-digit code in the email instead: it works anywhere.',
  missing: 'That link didn’t carry a sign-in code. Send yourself a new one.',
  link: 'That sign-in link didn’t work. Use the code in the email, or send a new one.',
  exchange: 'Sign-in didn’t complete. Send yourself a new code.',
};

/**
 * Passwordless sign-in. The email carries a 6-digit code (and a link as a fallback).
 * The code is the main route because phones open email links in the mail app's own browser,
 * and an app added to the home screen keeps its sign-in separate from Safari, so links often land in the wrong place.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [resent, setResent] = useState(false);

  // Explain why a sign-in link didn't work, instead of silently showing this page again.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const reason = q.get('reason');
    if (!reason) return;
    setError(REASONS[reason] ?? REASONS.exchange);
    setDetail(q.get('detail') ?? '');
    window.history.replaceState(null, '', '/login');
  }, []);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setError(''); setDetail('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? 'Too many codes sent. Wait a minute, then try again.' : 'That didn’t work. Try again in a minute.');
      setDetail(error.message);
      return;
    }
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setDetail('');
    const token = code.replace(/\D/g, '');
    if (token.length < 6) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) {
      setBusy(false);
      setError(/expired/i.test(error.message) ? 'That code has expired. Send a new one.' : 'That code didn’t match. Check it and try again, or send a new one.');
      setDetail(error.message);
      return;
    }
    // A full page load, so the server sees the new session. The app sends first-timers to the welcome step.
    window.location.assign('/today');
  }

  return (
    <main className="auth">
      <Brand />
      {step === 'email' ? (
        <form onSubmit={send} className="q" style={{ gap: 14 }}>
          <h1>Sign in</h1>
          <p className="sub">No password. We&apos;ll email you a 6-digit code.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          {detail && <p className="hint">Detail for support: {detail}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
          <p className="hint">18+ only. Second Mark gives feedback on your own behaviour, not financial advice.</p>
        </form>
      ) : (
        <form onSubmit={verify} className="q" style={{ gap: 14 }}>
          <h1>Check your email</h1>
          <p className="sub">We&apos;ve sent a 6-digit code to {email.trim()}. Open the email in any app, then type the code here. It expires after an hour.</p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input id="code" className="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]*" maxLength={12} autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} />
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          {detail && <p className="hint">Detail for support: {detail}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="hrow">
            <button className="link" type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setDetail(''); }}>Use a different email</button>
            <button className="link" type="button" disabled={busy || resent} onClick={async () => { await send(); setResent(true); setTimeout(() => setResent(false), 60_000); }}>
              {resent ? 'New code sent' : 'Send a new code'}
            </button>
          </div>
          <p className="hint">Can&apos;t find it? Check spam. Codes can take a minute to arrive.</p>
        </form>
      )}
    </main>
  );
}
