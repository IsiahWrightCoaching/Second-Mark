/**
 * Supabase settings. The Vercel–Supabase integration sets these automatically.
 * The publishable (anon) key is safe in the browser: row-level security protects the data.
 * Never put the service role / secret key in a NEXT_PUBLIC_ variable.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
