import { cookies } from 'next/headers';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AccountsView, type AccountRow } from './AccountsView';
import { ACTIVE_COOKIE } from '@/lib/activeAccount';

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams;
  const supabase = await createClient();
  const [{ data: accts }, { data: links }, { data: strats }, { data: counts }] = await Promise.all([
    supabase.from('accounts').select('id, type, firm, size, targets, max_drawdown_pct, daily_loss_pct, dd_basis, dd_mode, fee, archived, closed_as, manual_fail').is('deleted_at', null).order('created_at'),
    supabase.from('account_strategies').select('account_id, strategy_id'),
    supabase.from('strategies').select('id, name').eq('archived', false).order('created_at'),
    supabase.from('trades').select('account_id'),
  ]);
  const active = (await cookies()).get(ACTIVE_COOKIE)?.value ?? accts?.[0]?.id ?? null;
  const rows: AccountRow[] = (accts ?? []).map((a) => ({
    id: a.id, type: a.type, firm: a.firm, size: Number(a.size), targets: (a.targets ?? []).map(Number), maxDrawdownPct: Number(a.max_drawdown_pct),
    dailyLossPct: Number(a.daily_loss_pct), ddBasis: a.dd_basis, ddMode: a.dd_mode, fee: Number(a.fee), archived: a.archived, closedAs: a.closed_as,
    manualFail: a.manual_fail, strategyIds: (links ?? []).filter((l) => l.account_id === a.id).map((l) => l.strategy_id),
    trades: (counts ?? []).filter((t) => t.account_id === a.id).length,
  }));
  const strategies = (strats ?? []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <section>
      <div><h2>Accounts</h2><h1>Your accounts</h1><p className="sub">Trades are logged to the account you pick here.</p></div>
      {first && !rows.length && (
        <div className="tile">
          <span className="lab">Two steps to get going</span>
          <p className="hint" style={{ fontSize: 14 }}>
            1. {strategies.length ? 'Strategy written.' : <>Write your strategy on the <Link href="/strategy">Strategy tab</Link>.</>} 2. Set up the account you&apos;re trading below.
          </p>
        </div>
      )}
      <AccountsView accounts={rows} strategies={strategies} activeId={active} />
    </section>
  );
}
