'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { followed, rFromUsd, fR, signedMoney, dayKey, type Exit, type Trade } from '@/lib/engine';
import { saveTrade, deleteTrade, logSkippedSetup, type ImpulseReason } from './actions';

export interface LogStrategy {
  id: string; name: string; kind: 'rules' | 'discretionary'; version: number; checklist: string[]; instruments: string[]; defaultRiskPct: number; maxPerDay: number | null;
}
export interface HistoryRow {
  id: string; strategyId: string; strategyVersion: number; entryAt: number; instrument: string; direction: 'long' | 'short'; planned: boolean;
  impulseReason: string; rulesMet: boolean; missedRules: string[]; grade: 'A' | 'B' | 'C' | null; exit: Exit; riskPct: number; defaultRiskPct: number;
  usd: number; r: number; overLimit: boolean; note: string;
}

const WHY: [ImpulseReason, string][] = [['fomo', 'FOMO'], ['after_loss', 'After a loss'], ['boredom', 'Boredom'], ['back_to_even', 'Back to even'], ['on_a_roll', 'On a roll'], ['target_pressure', 'Target pressure']];
const EXITS: [Exit, string][] = [['as_planned', 'As planned'], ['closed_early', 'Closed winner early'], ['held_loser', 'Held loser or moved stop']];
type Sign = 'profit' | 'loss' | 'be';

/** A datetime-local value in this device's time, which is what the trader sees on their platform clock. */
const localInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

interface Form {
  id?: string; strategyId: string; instrument: string; direction: 'long' | 'short' | null; entry: string; ticked: string[];
  matched: boolean | null; grade: 'A' | 'B' | 'C' | null; planned: boolean | null; why: ImpulseReason | ''; risk: number; exit: Exit | null;
  sign: Sign | null; amount: string; note: string;
}
const fresh = (s: LogStrategy | undefined, entry = ''): Form => ({
  strategyId: s?.id ?? '', instrument: s?.instruments.length === 1 ? s.instruments[0] : '', direction: null, entry, ticked: [],
  matched: null, grade: null, planned: null, why: '', risk: s?.defaultRiskPct ?? 1, exit: null, sign: null, amount: '', note: '',
});

function Chips<T extends string | boolean>({ opts, value, onPick, name, disabled }: { opts: [T, string][]; value: T | null; onPick: (v: T) => void; name: string; disabled?: boolean }) {
  return (
    <div className="chips" role="group" aria-label={name}>
      {opts.map(([v, l]) => <button key={String(v)} type="button" className="chip" aria-pressed={value === v} disabled={disabled} onClick={() => onPick(v)}>{l}</button>)}
    </div>
  );
}

export function TradeLog({ account, strategies, history, tz, checkinMissing, consent }: {
  account: { id: string; label: string; closed: boolean; size: number }; strategies: LogStrategy[]; history: HistoryRow[]; tz: string; checkinMissing: boolean; consent: boolean;
}) {
  const [f, setF] = useState<Form>(() => fresh(strategies[0]));
  // The entry time defaults to now on this device. Set after the page loads, so the server and phone agree.
  useEffect(() => { setF((x) => (x.entry ? x : { ...x, entry: localInput(Date.now()) })); }, []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();
  const started = useRef<number | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Form>) => { if (started.current == null && !f.id) started.current = Date.now(); setF((x) => ({ ...x, ...p })); setError(''); };
  const s = strategies.find((x) => x.id === f.strategyId);
  const editing = !!f.id;

  const entryMs = f.entry ? new Date(f.entry).getTime() : NaN;
  const sameDay = useMemo(() => {
    if (!s || !Number.isFinite(entryMs)) return 0;
    const k = dayKey(entryMs, tz);
    return history.filter((t) => t.strategyId === s.id && t.id !== f.id && dayKey(t.entryAt, tz) === k && t.entryAt < entryMs).length;
  }, [history, s, entryMs, tz, f.id]);

  const questionsDone = !!s && !!f.instrument.trim() && !!f.direction && Number.isFinite(entryMs) && f.planned != null && (f.planned || !!f.why) && !!f.exit
    && (s.kind === 'rules' || (f.matched != null && !!f.grade));
  const amount = Number(f.amount.replace(/[^0-9.]/g, ''));
  const usd = f.sign === 'be' ? 0 : f.sign && f.amount ? (f.sign === 'loss' ? -amount : amount) : NaN;
  const r = s && Number.isFinite(usd) ? rFromUsd(usd, account.size, editing ? (history.find((t) => t.id === f.id)?.defaultRiskPct ?? s.defaultRiskPct) : s.defaultRiskPct) : null;

  if (!strategies.length) {
    return (
      <>
        <div><h2>New trade</h2><h1>Log a trade</h1></div>
        <div className="tile"><span className="lab">No strategy on this account</span><p className="hint" style={{ fontSize: 14 }}>Write a strategy on the <Link href="/strategy">Strategy tab</Link>, then link it to {account.label} on the <Link href="/accounts">Accounts tab</Link>.</p></div>
      </>
    );
  }

  function edit(t: HistoryRow) {
    const st = strategies.find((x) => x.id === t.strategyId);
    setF({
      id: t.id, strategyId: t.strategyId, instrument: t.instrument, direction: t.direction, entry: localInput(t.entryAt),
      ticked: st ? st.checklist.filter((c) => !t.missedRules.includes(c)) : [], matched: st?.kind === 'discretionary' ? t.rulesMet : null, grade: t.grade,
      planned: t.planned, why: (t.impulseReason || '') as ImpulseReason | '', risk: t.riskPct, exit: t.exit,
      sign: Math.abs(t.usd) < 0.005 ? 'be' : t.usd < 0 ? 'loss' : 'profit', amount: Math.abs(t.usd) < 0.005 ? '' : String(Math.abs(t.usd)), note: t.note,
    });
    setError(''); setNotice('');
    top.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function save() {
    if (!s) return;
    if (!questionsDone) { setError('Answer every question above first.'); return; }
    if (!Number.isFinite(usd)) { setError('Enter the result.'); return; }
    start(async () => {
      const res = await saveTrade({
        id: f.id, accountId: account.id, strategyId: s.id, instrument: f.instrument, direction: f.direction!, entryAt: entryMs, planned: f.planned!,
        impulseReason: f.planned ? '' : f.why, ticked: f.ticked, matched: f.matched, grade: f.grade, riskPct: f.risk, exit: f.exit!, resultUsd: usd,
        note: f.note, logSeconds: !f.id && started.current ? Math.round((Date.now() - started.current) / 1000) : null,
      });
      if (res.error) { setError(res.error); return; }
      setNotice(editing ? 'Trade updated.' : `Trade saved${r != null ? `: ${fR(r)}` : ''}.`);
      started.current = null;
      setF(fresh(s, localInput(Date.now())));
    });
  }

  const overDefault = f.risk > (s?.defaultRiskPct ?? Infinity) + 1e-9;
  const overLimit = !!s?.maxPerDay && sameDay >= s.maxPerDay;

  return (
    <>
      <div ref={top}><h2>{editing ? 'Editing' : 'New trade'} · {account.label}</h2><h1>{editing ? 'Edit trade' : 'Log a trade'}</h1><p className="sub">Answer these first. Your result unlocks last.</p></div>
      {notice && <p className="hint" role="status" style={{ fontSize: 14 }}>{notice}</p>}
      {account.closed && !editing && (
        <div className="tile"><span className="lab">This account is closed</span><p className="hint" style={{ fontSize: 13 }}>You can still edit its trades below, but new trades need a current account.</p><Link className="btn ghost small" href="/accounts" style={{ textAlign: 'center', textDecoration: 'none' }}>Switch account</Link></div>
      )}
      {checkinMissing && !editing && (
        <div className="tile"><span className="lab">No check-in today</span><p className="hint" style={{ fontSize: 13 }}>Trades still save, but they can&apos;t be matched to your sleep and state, so they&apos;re left out of those patterns.</p><Link className="btn ghost small" href="/today" style={{ textAlign: 'center', textDecoration: 'none' }}>Do the check-in</Link></div>
      )}
      {!consent && !editing && <p className="hint">The check-in is off, so trades are saved without your state. You can turn it on from Today.</p>}

      {(!account.closed || editing) && (
        <div className="q" style={{ gap: 18 }}>
          {strategies.length > 1 && (
            <div className="q"><span className="lab">Strategy</span>
              <Chips name="Strategy" opts={strategies.map((x) => [x.id, x.name] as [string, string])} value={f.strategyId} disabled={editing}
                onPick={(id) => { const n = strategies.find((x) => x.id === id)!; set({ strategyId: id, ticked: [], matched: null, grade: null, risk: n.defaultRiskPct, instrument: n.instruments.length === 1 ? n.instruments[0] : f.instrument }); }} />
            </div>
          )}
          <div className="q"><label className="lab" htmlFor="sym">Instrument</label>
            <input className="txt" id="sym" autoCapitalize="characters" autoComplete="off" placeholder="Type any symbol, e.g. GBPJPY" value={f.instrument} onChange={(e) => set({ instrument: e.target.value.toUpperCase() })} />
            {!!s?.instruments.length && <div className="chips sm">{s.instruments.map((x) => <button key={x} type="button" className="chip" aria-pressed={f.instrument === x} onClick={() => set({ instrument: x })}>{x}</button>)}</div>}
          </div>
          <div className="q"><span className="lab">Direction</span><Chips name="Direction" opts={[['long', 'Long'], ['short', 'Short']]} value={f.direction} onPick={(v) => set({ direction: v })} /></div>
          <div className="field"><label className="lab" htmlFor="entryAt">Entry time</label><input type="datetime-local" id="entryAt" value={f.entry} onChange={(e) => set({ entry: e.target.value })} /></div>
          {s?.kind === 'rules' ? (
            <div className="q"><span className="lab">Checklist: tick what was true at entry</span>
              <div className="chips">{s.checklist.map((c) => <button key={c} type="button" className="chip" aria-pressed={f.ticked.includes(c)} onClick={() => set({ ticked: f.ticked.includes(c) ? f.ticked.filter((x) => x !== c) : [...f.ticked, c] })}>{c}</button>)}</div>
              <p className="hint">{f.ticked.length === s.checklist.length ? 'Every rule met.' : `${s.checklist.length - f.ticked.length} not ticked: this trade will count as off plan.`}</p>
            </div>
          ) : (
            <div className="q"><span className="lab">Did this match your discretionary rules?</span>
              <Chips name="Matched rules" opts={[[true, 'Yes'], [false, 'No']]} value={f.matched} onPick={(v) => set({ matched: v })} />
              <span className="lab">Setup quality</span>
              <Chips name="Setup grade" opts={[['A', 'A setup'], ['B', 'B setup'], ['C', 'C setup']]} value={f.grade} onPick={(v) => set({ grade: v })} />
              <p className="hint">Discretionary plan scores are self-graded, and the app labels them that way.</p>
            </div>
          )}
          <div className="q"><span className="lab">Planned or impulsive?</span><Chips name="Planned or impulsive" opts={[[true, 'Planned'], [false, 'Impulsive']]} value={f.planned} onPick={(v) => set({ planned: v, why: v ? '' : f.why })} /></div>
          {f.planned === false && <div className="q"><span className="lab">Why did you take it?</span><Chips name="Why" opts={WHY} value={f.why || null} onPick={(v) => set({ why: v })} /></div>}
          <div className="q"><span className="lab">Risk taken</span>
            <div className="stepper">
              <button type="button" aria-label="Less risk" onClick={() => set({ risk: Math.max(0.25, Math.round((f.risk - 0.25) * 100) / 100) })}>−</button>
              <output aria-live="polite">{f.risk.toFixed(2)}%</output>
              <button type="button" aria-label="More risk" onClick={() => set({ risk: Math.min(20, Math.round((f.risk + 0.25) * 100) / 100) })}>+</button>
            </div>
            <p className="hint">{overDefault ? `Above your ${s?.defaultRiskPct}% default: this trade counts as oversized.` : `Your default is ${s?.defaultRiskPct}%.`}</p>
          </div>
          <div className="q"><span className="lab">How did you exit?</span><Chips name="Exit" opts={EXITS} value={f.exit} onPick={(v) => set({ exit: v })} /></div>
          <div className={'q' + (questionsDone ? '' : ' locked')} aria-disabled={!questionsDone}>
            <label className="lab" htmlFor="pnl">Result, from your platform ($)</label>
            <Chips name="Result" opts={[['profit', 'Profit'], ['loss', 'Loss'], ['be', 'Breakeven']]} value={f.sign} onPick={(v) => set({ sign: v, amount: v === 'be' ? '' : f.amount })} />
            {f.sign !== 'be' && (
              <div className="pnl"><span className="rangeval" style={{ fontSize: 20, minWidth: 16 }}>{f.sign === 'loss' ? '−' : '+'}</span>
                <input id="pnl" inputMode="decimal" placeholder="Amount, e.g. 500" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></div>
            )}
            <p className="hint">{questionsDone ? (r != null ? `${signedMoney(usd)} is ${fR(r)} at your default risk.` : 'Enter the result as your platform shows it.') : 'Unlocks once the questions above are answered.'}</p>
          </div>
          <div className="field"><label className="lab" htmlFor="tnote">Note (optional)</label><input id="tnote" maxLength={280} placeholder="One line, e.g. entered before the candle closed" value={f.note} onChange={(e) => set({ note: e.target.value })} /></div>
          {overLimit && <p className="hint">This is trade {sameDay + 1} today on a {s!.maxPerDay}-a-day limit, so it counts as off plan.</p>}
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn" type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : editing ? 'Save changes' : 'Save trade'}</button>
          {editing && <button className="btn ghost" type="button" onClick={() => { setF(fresh(s, localInput(Date.now()))); setError(''); }}>Cancel editing</button>}
        </div>
      )}

      {!account.closed && <Skipped accountId={account.id} />}
      <History history={history} strategies={strategies} tz={tz} onEdit={edit} />
    </>
  );
}

function Skipped({ accountId }: { accountId: string }) {
  const [why, setWhy] = useState<'fear' | 'away' | 'too_late' | null>(null);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="tile">
      <span className="lab">Saw a valid setup and didn&apos;t take it?</span>
      <Chips name="Why you skipped it" opts={[['fear', 'Fear or hesitation'], ['away', 'Away from the screen'], ['too_late', 'Spotted it too late']]} value={why} onPick={(v) => { setWhy(v); setMsg(''); }} />
      {msg && <p className="hint" role="status">{msg}</p>}
      <button className="btn ghost small" type="button" disabled={!why || pending} onClick={() => start(async () => {
        const r = await logSkippedSetup(accountId, why!);
        setMsg(r.error ?? 'Skipped setup logged.'); if (!r.error) setWhy(null);
      })}>Log skipped setup</button>
    </div>
  );
}

function History({ history, strategies, tz, onEdit }: { history: HistoryRow[]; strategies: LogStrategy[]; tz: string; onEdit: (t: HistoryRow) => void }) {
  const [show, setShow] = useState(20);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  // Built from parts, so the server and the browser print exactly the same text.
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmt = { format: (d: Date) => { const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value])); return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`; } };
  const name = (id: string) => strategies.find((s) => s.id === id)?.name ?? 'Strategy';
  if (!history.length) return <div className="q"><h2>Trade history · this account</h2><p className="meta">No trades yet.</p></div>;
  return (
    <div className="q">
      <h2>Trade history · this account</h2>
      {error && <p className="err" role="alert">{error}</p>}
      <div>
        {history.slice(0, show).map((t) => {
          const toPlan = followed(t as unknown as Trade);
          return (
            <div className="tr" key={t.id}>
              <div>
                <b>{t.instrument}</b> {t.direction === 'long' ? 'long' : 'short'} · <span className="tag">{fmt.format(new Date(t.entryAt))}</span><br />
                <span className="tag">{strategies.length > 1 ? `${name(t.strategyId)} · ` : ''}<b>{toPlan ? 'To plan' : 'Off plan'}</b>{t.note ? ` · ${t.note}` : ''}</span>
              </div>
              <div className="r">{fR(t.r)}<br /><span className="tag">{signedMoney(t.usd)}</span></div>
              <div className="acts">
                {confirm === t.id ? (
                  <>
                    <span className="tag">Delete this trade?</span>
                    <button className="link" type="button" disabled={pending} onClick={() => start(async () => { const r = await deleteTrade(t.id); if (r.error) setError(r.error); setConfirm(null); })}>Yes, delete</button>
                    <button className="link" type="button" onClick={() => setConfirm(null)}>Keep it</button>
                  </>
                ) : (
                  <>
                    <button className="link" type="button" onClick={() => onEdit(t)}>Edit</button>
                    <button className="link" type="button" onClick={() => setConfirm(t.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {history.length > show && <button className="btn ghost small" type="button" onClick={() => setShow((n) => n + 20)}>Show more</button>}
    </div>
  );
}
