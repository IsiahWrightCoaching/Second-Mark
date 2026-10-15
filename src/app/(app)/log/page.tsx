import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getProfile, getActiveAccount, todayKey } from '@/lib/data';
import { TradeLog, type LogStrategy, type HistoryRow } from './TradeLog';

export default async function LogPage() {
  const supabase = await createClient();
  const [p, a] = await Promise.all([getProfile(supabase), getActiveAccount(supabase)]);
  if (!p) return null;
  if (!a) {
    return (
      <section>
        <div><h2>New trade</h2><h1>Log a trade</h1></div>
        <div className="tile"><span className="lab">No account yet</span><p className="hint" style={{ fontSize: 14 }}>Set up the account you&apos;re trading on the <Link href="/accounts">Accounts tab</Link> first.</p></div>
      </section>
    );
  }
  const [{ data: links }, { data: rows }, { data: ci }] = await Promise.all([
    supabase.from('account_strategies').select('strategies(id, name, kind, version, checklist, instruments, default_risk_pct, max_per_day)').eq('account_id', a.id),
    supabase.from('trades').select('id, strategy_id, strategy_version, entry_at, instrument, direction, planned, impulse_reason, rules_met, missed_rules, grade, exit, risk_pct, default_risk_pct, result_usd, r, over_limit, note')
      .eq('account_id', a.id).order('entry_at', { ascending: false }).limit(200),
    p.consent ? supabase.from('checkins').select('day').eq('day', todayKey(p.timezone)).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  type S = { id: string; name: string; kind: 'rules' | 'discretionary'; version: number; checklist: string[]; instruments: string[]; default_risk_pct: number; max_per_day: number | null };
  const strategies: LogStrategy[] = (links ?? []).map((l) => l.strategies as unknown as S).filter(Boolean).map((s) => ({
    id: s.id, name: s.name, kind: s.kind, version: s.version, checklist: s.checklist ?? [], instruments: s.instruments ?? [], defaultRiskPct: Number(s.default_risk_pct), maxPerDay: s.max_per_day,
  }));
  const history: HistoryRow[] = (rows ?? []).map((t) => ({
    id: t.id, strategyId: t.strategy_id, strategyVersion: t.strategy_version, entryAt: Date.parse(t.entry_at), instrument: t.instrument, direction: t.direction,
    planned: t.planned, impulseReason: t.impulse_reason, rulesMet: t.rules_met, missedRules: t.missed_rules ?? [], grade: t.grade, exit: t.exit,
    riskPct: Number(t.risk_pct), defaultRiskPct: Number(t.default_risk_pct), usd: Number(t.result_usd), r: Number(t.r), overLimit: t.over_limit, note: t.note,
  }));

  return (
    <section>
      <TradeLog
        account={{ id: a.id, label: a.label, closed: a.closed, size: a.size }}
        strategies={strategies}
        history={history}
        tz={p.timezone}
        checkinMissing={p.consent && !ci}
        consent={p.consent}
      />
    </section>
  );
}
