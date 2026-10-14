'use client';
import { useEffect, useState, useTransition } from 'react';
import { saveWelcome } from './actions';

/**
 * Separate, explicit consent for health data (UK GDPR special category).
 * The morning check-in asks about sleep, food, mood and what's on your mind, so it can't be saved without this.
 */
export function WelcomeForm() {
  const [tz, setTz] = useState('Europe/London');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'); } catch {} }, []);

  return (
    <form
      className="q"
      style={{ gap: 16 }}
      action={(fd) => start(async () => {
        const r = await saveWelcome(fd);
        if (r?.error) setError(r.error);
      })}
    >
      <p className="sub">Second Mark checks your trades against your own plan, and your plan against how you slept and what you brought to the desk.</p>
      <div className="tile" style={{ gap: 10 }}>
        <span className="lab">Your daily check-in</span>
        <p style={{ margin: 0, fontSize: 14 }}>
          Each morning you&apos;ll answer five quick questions: hours slept, whether you slept at your usual times, what you&apos;re carrying,
          whether you&apos;ve had water and food, and how sharp you feel. UK data law treats some of this as health information, so we need your
          explicit permission to store it. It&apos;s used only to show you your own patterns. You can withdraw permission and delete it at any time.
        </p>
        <label className="toggle" htmlFor="consent">
          <span className="lab">I agree to Second Mark storing my check-in answers</span>
          <input id="consent" name="consent" type="checkbox" role="switch" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        </label>
      </div>
      <div className="field">
        <label htmlFor="tz">Your time zone</label>
        <input id="tz" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} />
        <p className="hint">Used to group your trades into days. Detected from this device.</p>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={!consent || pending}>{pending ? 'Saving…' : 'Continue'}</button>
      <button className="btn ghost small" type="submit" name="skip" value="1" disabled={pending}>Continue without the check-in</button>
      <p className="hint">Without this permission you can still log trades, but the check-in and every sleep and state pattern stay switched off. You can turn it on later.</p>
    </form>
  );
}
