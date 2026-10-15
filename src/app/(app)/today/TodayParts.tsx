'use client';
import { useState, useTransition } from 'react';
import type { Carrying, Feeling, NoTradeReason } from '@/lib/engine';
import { saveCheckin, giveConsent, saveNoTradeDay, clearNoTradeDay, rateDay } from './actions';

export interface CheckinRow {
  sleepHours: number;
  usualSchedule: boolean;
  carrying: Carrying;
  feeling: Feeling | null;
  water: boolean;
  sharpness: number;
}

const CARRY: [Carrying, string][] = [['nothing', 'Nothing'], ['money', 'Money'], ['home', 'Home or relationship'], ['work', 'Work'], ['health', 'Health'], ['other', 'Other']];
const FEEL: [Feeling, string][] = [['calm', 'Calm'], ['anxious', 'Anxious'], ['frustrated', 'Frustrated or angry'], ['flat', 'Flat or bored'], ['excited', 'Excited']];
const label = <T,>(list: [T, string][], v: T) => list.find(([k]) => k === v)?.[1] ?? '';

function Chips<T extends string | boolean>({ opts, value, onPick, name }: { opts: [T, string][]; value: T | null; onPick: (v: T) => void; name: string }) {
  return (
    <div className="chips" role="group" aria-label={name}>
      {opts.map(([v, l]) => <button key={String(v)} type="button" className="chip" aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>)}
    </div>
  );
}

/* ---------- morning check-in ---------- */

export function CheckIn({ saved }: { saved: CheckinRow | null }) {
  const [editing, setEditing] = useState(!saved);
  const [sleep, setSleep] = useState(saved?.sleepHours ?? 7);
  const [sched, setSched] = useState<boolean | null>(saved?.usualSchedule ?? null);
  const [carry, setCarry] = useState<Carrying | null>(saved?.carrying ?? null);
  const [feel, setFeel] = useState<Feeling | null>(saved?.feeling ?? null);
  const [water, setWater] = useState<boolean | null>(saved?.water ?? null);
  const [sharp, setSharp] = useState(saved?.sharpness ?? 6);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const done = sched != null && carry != null && feel != null && water != null;

  if (saved && !editing) {
    return (
      <div className="tile">
        <div className="hrow"><span className="lab">Check-in done</span><button className="link" type="button" onClick={() => setEditing(true)}>Edit</button></div>
        <p className="meta">
          {saved.sleepHours}h sleep · {saved.usualSchedule ? 'usual schedule' : 'off schedule'} · carrying: {label(CARRY, saved.carrying).toLowerCase()} · {saved.feeling ? label(FEEL, saved.feeling).toLowerCase() : 'feeling not recorded'} · {saved.water ? 'had water' : 'no water yet'} · sharpness {saved.sharpness}/10
        </p>
        <p className="hint">Trades you log today are matched to these answers.</p>
      </div>
    );
  }

  function save() {
    if (!done) { setError('Answer every question.'); return; }
    start(async () => {
      const r = await saveCheckin({ sleepHours: sleep, usualSchedule: sched!, carrying: carry!, feeling: feel!, water: water!, sharpness: sharp });
      if (r.error) { setError(r.error); return; }
      setError(''); setEditing(false);
    });
  }

  return (
    <div className="q" style={{ gap: 16 }}>
      <div><h3>Morning check-in</h3><p className="sub">Six taps, every day, trading or not. About 20 seconds.</p></div>
      <div className="q"><span className="lab">Hours slept</span>
        <div className="stepper">
          <button type="button" aria-label="Less sleep" onClick={() => setSleep((s) => Math.max(0, s - 0.5))}>−</button>
          <output aria-live="polite">{sleep}</output>
          <button type="button" aria-label="More sleep" onClick={() => setSleep((s) => Math.min(16, s + 0.5))}>+</button>
        </div>
      </div>
      <div className="q"><span className="lab">Slept and woke at your usual times?</span>
        <Chips name="Usual schedule" opts={[[true, 'Yes'], [false, 'No']]} value={sched} onPick={setSched} /></div>
      <div className="q"><span className="lab">What are you carrying today?</span><span className="hint" style={{ marginTop: -4 }}>Anything from outside trading that&apos;s on your mind.</span>
        <Chips name="Carrying" opts={CARRY} value={carry} onPick={setCarry} /></div>
      <div className="q"><span className="lab">How do you feel right now?</span><span className="hint" style={{ marginTop: -4 }}>Pick the closest one.</span>
        <Chips name="Feeling" opts={FEEL} value={feel} onPick={setFeel} /></div>
      <div className="q"><span className="lab">Had water before trading?</span>
        <Chips name="Water" opts={[[true, 'Yes'], [false, 'Not yet']]} value={water} onPick={setWater} /></div>
      <div className="q"><label className="lab" htmlFor="sharp">How sharp do you feel?</label><span className="hint" style={{ marginTop: -4 }}>1 is foggy or slow, 10 is clear and quick.</span>
        <input type="range" id="sharp" min={1} max={10} step={1} value={sharp} onChange={(e) => setSharp(Number(e.target.value))} />
        <span className="rangeval">{sharp} out of 10</span></div>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn" type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : saved ? 'Update check-in' : 'Save check-in'}</button>
      {saved && <button className="btn ghost small" type="button" onClick={() => setEditing(false)}>Cancel</button>}
    </div>
  );
}

export function ConsentOff() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="tile">
      <span className="lab">The check-in is off</span>
      <p className="hint" style={{ fontSize: 14 }}>Your trades still log. Without the check-in, the app can&apos;t link your sleep, mood and state to how you trade.</p>
      {!open ? <button className="btn ghost small" type="button" onClick={() => setOpen(true)}>Turn on the check-in</button> : (
        <>
          <p className="hint" style={{ fontSize: 13 }}>Your answers about sleep, mood, water and what&apos;s on your mind count as health data. They&apos;re stored privately, only you can see them, and you can delete them at any time.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn small" type="button" disabled={pending} onClick={() => start(async () => { const r = await giveConsent(); if (r.error) setError(r.error); })}>I agree. Turn it on</button>
        </>
      )}
    </div>
  );
}

/* ---------- no-trade day ---------- */

const REASONS: [NoTradeReason, string][] = [
  ['no_setup', 'No valid setup'], ['not_right_state', 'Not in the right state'], ['news_day', 'High-impact news day'], ['fear', 'Fear or hesitation'],
  ['stopped_at_limit', 'Stopped at my daily limit'], ['rest_day', 'Planned rest day'], ['no_time', 'No time today'], ['market_closed', 'Market closed or holiday'], ['other', 'Other'],
];
type NtState = 'tired' | 'emotional' | 'carrying' | 'unwell' | 'rushed';
const NT_STATES: [NtState, string][] = [['tired', 'Tired'], ['emotional', 'Emotional'], ['carrying', 'Carrying something'], ['unwell', 'Unwell'], ['rushed', 'Rushed or distracted']];
const GOOD: NoTradeReason[] = ['no_setup', 'not_right_state', 'news_day', 'stopped_at_limit', 'rest_day'];
const scoreHint = (r: NoTradeReason) =>
  GOOD.includes(r) ? 'Counts towards your plan score. Sitting out for a good reason is following your plan.'
    : r === 'fear' ? 'Counts against your plan score: there was a valid setup and you didn’t take it.'
      : 'Not scored either way.';

export function NoTradeTile({ saved, accountLabel }: { saved: { reason: NoTradeReason; state: NtState | null } | null; accountLabel: string }) {
  const [on, setOn] = useState(false);
  const [reason, setReason] = useState<NoTradeReason | ''>('');
  const [state, setState] = useState<NtState | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  if (saved) {
    return (
      <div className="tile">
        <div className="hrow"><span className="lab">No trade today</span><button className="link" type="button" disabled={pending} onClick={() => start(async () => { await clearNoTradeDay(); })}>Undo</button></div>
        <p style={{ margin: 0, fontSize: 14 }}>{label(REASONS, saved.reason)}{saved.state ? ` · ${label(NT_STATES, saved.state).toLowerCase()}` : ''}</p>
        <p className="hint">{scoreHint(saved.reason)}</p>
      </div>
    );
  }

  function save() {
    if (!reason) { setError('Choose a reason.'); return; }
    if (reason === 'not_right_state' && !state) { setError('Choose what’s off.'); return; }
    start(async () => {
      const r = await saveNoTradeDay(reason, state);
      if (r.error) setError(r.error);
    });
  }

  return (
    <div className="tile">
      <label className="toggle" htmlFor="noTrade">
        <span><span className="lab">No trade today</span><br /><span className="hint">Not trading, or finished without a trade? Log it for {accountLabel}.</span></span>
        <input type="checkbox" id="noTrade" role="switch" checked={on} onChange={(e) => setOn(e.target.checked)} />
      </label>
      {on && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          <div className="field"><label htmlFor="ntReason">Why no trade?</label>
            <select id="ntReason" value={reason} onChange={(e) => { setReason(e.target.value as NoTradeReason); setError(''); }}>
              <option value="">Choose a reason</option>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          {reason === 'not_right_state' && <div className="q"><span className="lab">What&apos;s off?</span><Chips name="What's off" opts={NT_STATES} value={state} onPick={setState} /></div>}
          {reason && <p className="hint">{scoreHint(reason)}</p>}
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn" type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Log no-trade day'}</button>
        </div>
      )}
    </div>
  );
}

/* ---------- end of day ---------- */

export function DayRating({ saved }: { saved: 'A' | 'B' | 'C' | null }) {
  const [value, setValue] = useState(saved);
  const [error, setError] = useState('');
  const [, start] = useTransition();
  return (
    <div className="tile">
      <h2>End of day</h2>
      <span className="lab">How did you trade today?</span>
      <Chips name="Day rating" opts={[['A', 'A game'], ['B', 'B game'], ['C', 'C game']]} value={value} onPick={(v) => {
        setValue(v);
        start(async () => { const r = await rateDay(v); if (r.error) { setError(r.error); setValue(saved); } });
      }} />
      {error && <p className="err" role="alert">{error}</p>}
      <p className="hint">Your rating is checked against what you actually did.</p>
    </div>
  );
}
