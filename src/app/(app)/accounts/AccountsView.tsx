'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createAccount, setActiveAccount, toggleAccountStrategy, type AccountInput } from './actions';

export interface AccountRow {
  id: string; type: 'challenge' | 'funded' | 'demo'; firm: string; size: number; targets: number[]; maxDrawdownPct: number; dailyLossPct: number;
  ddBasis: 'balance' | 'equity'; ddMode: 'static' | 'trailing'; fee: number; archived: boolean; closedAs: string | null; manualFail: boolean;
  strategyIds: string[]; trades: number;
}
interface Strat { id: string; name: string }

const kSize = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
const label = (a: AccountRow) => `${a.type === 'challenge' ? 'Challenge' : a.type === 'funded' ? 'Funded' : 'Demo'} · ${kSize(a.size)}`;
// M1: past = archived, marked failed or moved on to funded. Rule-based failure is added with the prop engine in M5.
const isPast = (a: AccountRow) => a.archived || a.manualFail || a.closedAs === 'funded';

export function AccountsView({ accounts, strategies, activeId }: { accounts: AccountRow[]; strategies: Strat[]; activeId: string | null }) {
  const [wizard, setWizard] = useState(!accounts.length);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const current = accounts.filter((a) => !isPast(a)), past = accounts.filter(isPast);
  const active = accounts.find((a) => a.id === activeId) ?? null;

  if (wizard) return <Wizard strategies={strategies} onCancel={accounts.length ? () => setWizard(false) : undefined} />;

  const item = (a: AccountRow) => (
    <button key={a.id} className="acc" type="button" aria-current={a.id === activeId} onClick={() => start(() => setActiveAccount(a.id))}>
      <span>
        <span className="k">{a.type}{a.firm ? ` · ${a.firm}` : ''}</span><br />{label(a)}<br />
        <span className="meta">{a.strategyIds.map((id) => strategies.find((s) => s.id === id)?.name).filter(Boolean).join(', ')}</span>
      </span>
      <span className="meta">{a.trades} {a.trades === 1 ? 'trade' : 'trades'}</span>
    </button>
  );

  return (
    <>
      <div className="list" style={{ gap: 10 }}>{current.length ? current.map(item) : <p className="meta">No current accounts. Start one below.</p>}</div>
      {past.length > 0 && (
        <details className="more"><summary><span>Past accounts</span><span className="sum">{past.length}</span></summary>
          <div className="in"><p className="hint">They still count in your all-live stats.</p><div className="list" style={{ gap: 10 }}>{past.map(item)}</div></div>
        </details>
      )}
      {active && !isPast(active) && (
        <div className="tile">
          <h2>Manage {label(active)}</h2>
          <div className="q"><span className="lab">Strategies on this account</span>
            <div className="chips">
              {strategies.map((s) => {
                const on = active.strategyIds.includes(s.id);
                return (
                  <button key={s.id} className="chip" type="button" aria-pressed={on} disabled={pending}
                    onClick={() => start(async () => { const r = await toggleAccountStrategy(active.id, s.id, !on); setError(r.error ?? ''); })}>{s.name}</button>
                );
              })}
            </div>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </div>
      )}
      <button className="btn" type="button" onClick={() => setWizard(true)}>Start a new account</button>
    </>
  );
}

const blank = (): AccountInput & { phases: 1 | 2 } => ({
  type: 'challenge', firm: '', size: 0, fee: 0, targets: [8, 5], phases: 2, maxDrawdownPct: 10, dailyLossPct: 5, ddBasis: 'balance', ddMode: 'static', strategyIds: [],
});

function Wizard({ strategies, onCancel }: { strategies: Strat[]; onCancel?: () => void }) {
  const [w, setW] = useState(blank());
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const steps = w.type === 'demo' ? ['type', 'size', 'strats', 'review'] : ['type', 'size', 'rules', 'strats', 'review'];
  const s = steps[step];
  const set = (p: Partial<typeof w>) => setW((x) => ({ ...x, ...p }));
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const chip = <K extends keyof typeof w>(key: K, opts: [typeof w[K], string][]) => (
    <div className="chips">{opts.map(([v, l]) => <button key={String(v)} className="chip" type="button" aria-pressed={w[key] === v} onClick={() => set({ [key]: v } as Partial<typeof w>)}>{l}</button>)}</div>
  );

  function next() {
    setError('');
    if (s === 'size' && !(w.size > 0)) return setError('Enter the account size.');
    if (s === 'strats' && !w.strategyIds.length) return setError('Pick at least one strategy.');
    if (s !== 'review') return setStep(step + 1);
    start(async () => {
      const r = await createAccount({ ...w, targets: w.phases === 1 ? [w.targets[0]] : w.targets });
      if (r.error) setError(r.error); else window.location.assign('/today');
    });
  }

  return (
    <div className="q" style={{ gap: 18 }}>
      <div className="steps">{steps.map((_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
      {s === 'type' && (<><div><h2>New account · step {step + 1} of {steps.length}</h2><h1>What kind of account?</h1><p className="sub">Demo trades are kept separate from your live stats.</p></div>
        {chip('type', [['challenge', 'Challenge'], ['funded', 'Funded'], ['demo', 'Demo']])}</>)}
      {s === 'size' && (<><div><h2>Step {step + 1} of {steps.length}</h2><h1>{w.type === 'demo' ? 'Demo account' : 'Firm and size'}</h1></div>
        {w.type !== 'demo' && <div className="field"><label htmlFor="wFirm">Firm</label><input id="wFirm" value={w.firm} placeholder="Your prop firm" onChange={(e) => set({ firm: e.target.value })} /></div>}
        <div className="field"><label htmlFor="wSize">Account size ($)</label><input id="wSize" inputMode="numeric" value={w.size || ''} placeholder="100000" onChange={(e) => set({ size: num(e.target.value) })} /></div>
        {w.type === 'challenge' && <div className="field"><label htmlFor="wFee">Fee paid ($)</label><input id="wFee" inputMode="numeric" value={w.fee || ''} placeholder="480" onChange={(e) => set({ fee: num(e.target.value) })} /></div>}</>)}
      {s === 'rules' && (<><div><h2>Step {step + 1} of {steps.length}</h2><h1>Your firm&apos;s rules</h1><p className="sub">Copy these from your firm&apos;s rules page.</p></div>
        {w.type === 'challenge' && (<><div className="q"><span className="lab">Phases</span>{chip('phases', [[1, '1'], [2, '2']])}</div>
          <div className="two">
            <div className="field"><label htmlFor="t1">Phase 1 target (%)</label><input id="t1" inputMode="decimal" value={w.targets[0] || ''} onChange={(e) => set({ targets: [num(e.target.value), w.targets[1] ?? 5] })} /></div>
            {w.phases === 2 && <div className="field"><label htmlFor="t2">Phase 2 target (%)</label><input id="t2" inputMode="decimal" value={w.targets[1] || ''} onChange={(e) => set({ targets: [w.targets[0], num(e.target.value)] })} /></div>}
          </div></>)}
        <div className="two">
          <div className="field"><label htmlFor="wd">Daily drawdown (%)</label><input id="wd" inputMode="decimal" value={w.dailyLossPct || ''} onChange={(e) => set({ dailyLossPct: num(e.target.value) })} /></div>
          <div className="field"><label htmlFor="wm">Max drawdown (%)</label><input id="wm" inputMode="decimal" value={w.maxDrawdownPct || ''} onChange={(e) => set({ maxDrawdownPct: num(e.target.value) })} /></div>
        </div>
        <div className="q"><span className="lab">Drawdown measured on</span>{chip('ddBasis', [['balance', 'Balance'], ['equity', 'Equity']])}</div>
        <div className="q"><span className="lab">Drawdown limit is</span>{chip('ddMode', [['static', 'Static'], ['trailing', 'Trailing']])}</div></>)}
      {s === 'strats' && (<><div><h2>Step {step + 1} of {steps.length}</h2><h1>Which strategies will you trade?</h1><p className="sub">Your checklist, instruments, risk and daily limit come from the strategy.</p></div>
        {strategies.length ? (
          <div className="chips">{strategies.map((x) => {
            const on = w.strategyIds.includes(x.id);
            return <button key={x.id} className="chip" type="button" aria-pressed={on} onClick={() => set({ strategyIds: on ? w.strategyIds.filter((i) => i !== x.id) : [...w.strategyIds, x.id] })}>{x.name}</button>;
          })}</div>
        ) : <p className="sub">You haven&apos;t written a strategy yet. <Link href="/strategy">Add one on the Strategy tab</Link>, then come back.</p>}</>)}
      {s === 'review' && (<><div><h2>Step {step + 1} of {steps.length}</h2><h1>Review</h1></div>
        <div className="q" style={{ fontSize: 13 }}>
          <div className="row"><span>Type</span><span>{w.type}</span></div>
          {w.firm && <div className="row"><span>Firm</span><span>{w.firm}</span></div>}
          <div className="row"><span>Size</span><span>${w.size.toLocaleString('en-GB')}</span></div>
          {w.type === 'challenge' && <div className="row"><span>Targets</span><span>{w.targets[0]}%{w.phases === 2 ? ` then ${w.targets[1]}%` : ''}</span></div>}
          {w.type !== 'demo' && <div className="row"><span>Drawdown</span><span>{w.dailyLossPct}% daily · {w.maxDrawdownPct}% max · {w.ddBasis}, {w.ddMode}</span></div>}
          <div className="row"><span>Strategies</span><span>{w.strategyIds.map((id) => strategies.find((x) => x.id === id)?.name).join(', ')}</span></div>
        </div></>)}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="two">
        <button className="btn ghost" type="button" disabled={!step && !onCancel} onClick={() => (step ? setStep(step - 1) : onCancel?.())}>{step ? 'Back' : 'Cancel'}</button>
        <button className="btn" type="button" disabled={pending} onClick={next}>{s === 'review' ? (pending ? 'Creating…' : 'Create account') : 'Next'}</button>
      </div>
    </div>
  );
}
