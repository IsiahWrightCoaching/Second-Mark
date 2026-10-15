import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/Brand';
import { Nav } from '@/components/Nav';
import { getActiveAccount } from '@/lib/data';

/** Signed-in shell: brand header, account pill, five tabs. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user.id).single();
  if (!profile?.onboarded_at) redirect('/welcome');
  const active = await getActiveAccount(supabase);
  return (
    <>
      <div className="app">
        <header>
          <Brand />
          <Link className="acct" href="/accounts" aria-label={active ? `Active account: ${active.label}. Change account` : 'Set up an account'}>{active ? active.label : 'Add account'} ▾</Link>
        </header>
        {children}
      </div>
      <Nav account={active?.label ?? null} />
    </>
  );
}
