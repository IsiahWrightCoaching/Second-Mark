'use client';
import { useState, useTransition } from 'react';
import { saveStrategy, type StrategyInput } from './actions';

export interface StrategyRow extends Required<Omit<StrategyInput, 'id'>> { id: string; version: number }

const ONE_RULE: StrategyInput = {
  name: 'The 1 Rule', kind: 'rules',
  description: 'One pair, one session, one trade a day, 1% risk on current balance.',
  checklist: ['My one pair', 'Inside my one session', 'First trade of the day'], instruments: ['EURUSD'], defaultRiskPct: 1, maxPerDay: 1,
};
const blank = (): StrategyInput => ({ name: '', kind: 'rules', description: '', checklist: [], instruments: [], defaultRiskPct: 1, maxPerDay: null });

export function StrategyManager({ strategies }: { strategies: StrategyRow[] }) {
  const [form, setForm] = useState<StrategyInput | null>(strategies.length ? null : blank());
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();
  const set = (p: Partial<StrategyInput>) => setForm((f) => (f ? { ...f, ...p } : f));

  function submit() {
    if (!form) return;
    start(async () => {
      const r = await saveStrategy(form);
      if (r.error) { setError(r.error); return; }
      setError(''); setForm(null);
      setNotice(form.id ? (r.version && r.version > 1 ? `Saved as version ${r.version}` : 'Strategy saved') : 'Strategy added. Link it to an account to use it.');
    });
  }

  return (
    <>
      {notice && <p className="hint" role="status">{notice}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {strategies.map((s) => (
          <div className="strat" key={s.id}>
            <span className="k">{s.kind === 'rules' ? 'Rules-based' : 'Discretionary'} · version {s.version}</span>
            <h3>{s.name}</h3>
            {s.description && <p style={{ margin: 0, fontSize: 14 }}>{s.description}</p>}
            {s.kind === 'rules' ? (
              <><span className="lab">Checklist</span><ul>{s.checklist.map((c) => <li key={c}>{c}</li>)}</ul></>
            ) : (
              <p className="hint">No fixed checklist. Each trade asks whether it matched your rules, plus a setup grade. Plan scores for this strategy are self-graded.</p>
            )}
            <div className="row"><span>Instruments</span><span>{s.instruments.join(', ') || 'Any'}</span></div>
            <div className="row"><span>Default risk</span><span>{s.defaultRiskPct}%</span></div>
            <div className="row"><span>Max trades a day</span><span>{s.maxPerDay ?? 'No limit'}</span></div>
            <button className="btn ghost small" type="button" onClick={() => { setForm({ ...s }); setNotice(''); }}>Edit</button>
          </div>
        ))}
      </div>

      {!form && <button className="btn" type="button" onClick={() => { setForm(blank()); setNotice(''); }}>Add a strategy</button>}

      {form && (
        <div className="tile" style={{ gap: 14 }}>
          <h3>{form.id ? 'Edit strategy' : 'New strategy'}</h3>
          {!form.id && <button className="btn ghost small" type="button" onClick={() => setForm({ ...ONE_RULE })}>Start from the 1 Rule template</button>}
          <div className="field"><label htmlFor="sfName">Name</label><input id="sfName" value={form.name} placeholder="e.g. London pullback" onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="q"><span className="lab">Type</span>
            <div className="chips">
              {(['rules', 'discretionary'] as const).map((k) => (
                <button key={k} className="chip" type="button" aria-pressed={form.kind === k} onClick={() => set({ kind: k })}>{k === 'rules' ? 'Rules-based' : 'Discretionary'}</button>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor="sfDesc">Your strategy, in your own words</label>
            <textarea id="sfDesc" value={form.description} placeholder="What you look for, how you enter, where your stop and target go" onChange={(e) => set({ description: e.target.value })} /></div>
          {form.kind === 'rules' ? (
            <div className="q"><span className="lab">Entry checklist</span><p className="hint">Yes-or-no conditions you&apos;ll tick on every trade.</p>
              {form.checklist.map((c, i) => (
                <div className="cl" key={c + i}><span>{c}</span>
                  <button type="button" aria-label={`Remove ${c}`} onClick={() => set({ checklist: form.checklist.filter((_, j) => j !== i) })}>×</button></div>
              ))}
              <div className="two">
                <input className="txt" value={newItem} placeholder="e.g. Spread under 1 pip" aria-label="New condition" onChange={(e) => setNewItem(e.target.value)} />
                <button className="btn ghost small" type="button" onClick={() => { if (newItem.trim()) { set({ checklist: [...form.checklist, newItem.trim()] }); setNewItem(''); } }}>Add</button>
              </div>
            </div>
          ) : (
            <p className="hint">Discretionary: no checklist. Each trade asks whether it matched your rules above, plus a setup grade.</p>
          )}
          <div className="field"><label htmlFor="sfInst">Instruments, separated by commas</label>
            <input id="sfInst" value={form.instruments.join(', ')} placeholder="EURUSD, NAS100" onChange={(e) => set({ instruments: e.target.value.split(',') })} /></div>
          <div className="two">
            <div className="field"><label htmlFor="sfRisk">Default risk (%)</label>
              <input id="sfRisk" inputMode="decimal" value={String(form.defaultRiskPct)} onChange={(e) => set({ defaultRiskPct: Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="sfMax">Max trades a day</label>
              <input id="sfMax" inputMode="numeric" value={form.maxPerDay ?? ''} placeholder="No limit" onChange={(e) => set({ maxPerDay: e.target.value ? Number(e.target.value) : null })} /></div>
          </div>
          {form.id && <p className="hint">Changing the checklist starts a new version. Old trades keep the version they were logged with.</p>}
          {error && <p className="err" role="alert">{error}</p>}
          <div className="two">
            <button className="btn ghost" type="button" onClick={() => { setForm(strategies.length ? null : blank()); setError(''); }}>Cancel</button>
            <button className="btn" type="button" disabled={pending} onClick={submit}>{pending ? 'Saving…' : 'Save strategy'}</button>
          </div>
        </div>
      )}
    </>
  );
}
