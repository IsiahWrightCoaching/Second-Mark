import { createClient } from '@/lib/supabase/server';
import { StrategyManager, type StrategyRow } from './StrategyManager';

export default async function StrategyPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('strategies').select('id, name, kind, description, checklist, instruments, default_risk_pct, max_per_day, version').eq('archived', false).order('created_at');
  const rows: StrategyRow[] = (data ?? []).map((s) => ({
    id: s.id, name: s.name, kind: s.kind, description: s.description, checklist: s.checklist, instruments: s.instruments,
    defaultRiskPct: Number(s.default_risk_pct), maxPerDay: s.max_per_day, version: s.version,
  }));
  return (
    <section>
      <div><h2>My strategy</h2><h1>Your strategies</h1><p className="sub">Write each strategy once. Every account and every trade uses one.</p></div>
      <StrategyManager strategies={rows} />
    </section>
  );
}
