import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/Brand';
import { WelcomeForm } from './WelcomeForm';

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('onboarded_at').eq('id', user.id).single();
  if (profile?.onboarded_at) redirect('/today');
  return (
    <main className="auth">
      <Brand />
      <h1>Before you start</h1>
      <WelcomeForm />
    </main>
  );
}
