'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface StrategyInput {
  id?: string;
  name: string;
  kind: 'rules' | 'discretionary';
  description: string;
  checklist: string[];
  instruments: string[];
  defaultRiskPct: number;
  maxPerDay: number | null;
}

type Result = { error?: string; id?: string; version?: number };

function validate(s: StrategyInput): string | null {
  if (!s.name.trim()) return 'Give the strategy a name.';
  if (s.name.trim().length > 80) return 'Keep the name under 80 characters.';
  if (s.kind === 'rules' && !s.checklist.filter((c) => c.trim()).length) return 'Add at least one checklist condition.';
  if (!(s.defaultRiskPct > 0 && s.defaultRiskPct <= 10)) return 'Default risk must be between 0 and 10%.';
  if (s.maxPerDay != null && !(Number.isInteger(s.maxPerDay) && s.maxPerDay >= 1 && s.maxPerDay <= 50)) return 'Max trades a day must be a whole number from 1 to 50, or left empty.';
  return null;
}

/** Saving a changed checklist starts a new version; old trades keep the version they were logged with. */
export async function saveStrategy(input: StrategyInput): Promise<Result> {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Signed out. Sign in again.' };
  const checklist = input.kind === 'rules' ? input.checklist.map((c) => c.trim()).filter(Boolean) : [];
  const instruments = input.instruments.map((x) => x.trim().toUpperCase()).filter(Boolean);
  const row = {
    name: input.name.trim(), kind: input.kind, description: input.description.trim(), checklist, instruments,
    default_risk_pct: input.defaultRiskPct, max_per_day: input.maxPerDay,
  };

  if (!input.id) {
    const { data, error } = await supabase.from('strategies').insert({ ...row, user_id: user.id, version: 1 }).select('id').single();
    if (error || !data) return { error: 'Couldn’t save the strategy.' };
    await supabase.from('strategy_versions').insert({ strategy_id: data.id, version: 1, user_id: user.id, checklist });
    revalidatePath('/strategy');
    return { id: data.id, version: 1 };
  }

  const { data: cur } = await supabase.from('strategies').select('checklist, version').eq('id', input.id).single();
  if (!cur) return { error: 'Strategy not found.' };
  const changed = JSON.stringify(cur.checklist) !== JSON.stringify(checklist);
  const version = changed ? cur.version + 1 : cur.version;
  const { error } = await supabase.from('strategies').update({ ...row, version }).eq('id', input.id);
  if (error) return { error: 'Couldn’t save the strategy.' };
  if (changed) await supabase.from('strategy_versions').insert({ strategy_id: input.id, version, user_id: user.id, checklist });
  revalidatePath('/strategy');
  return { id: input.id, version };
}
