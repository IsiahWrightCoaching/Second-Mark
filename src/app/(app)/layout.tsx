import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/Brand';
import { Nav } from '@/components/Nav';

/** Signed-in shell: brand header, account pill, five tabs. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user.id).single();
  if (!profile?.onboarded_at) redirect('/welcome');
  return (
    <>
      <div className="app">
        <header>
          <Brand />
          <Link className="acct" href="/accounts" aria-label="Accounts">Accounts ▾</Link>
        </header>
        {children}
      </div>
      <Nav />
    </>
  );
}
