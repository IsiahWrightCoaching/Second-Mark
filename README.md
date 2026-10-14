# Second Mark

The other side of the trade. A trading journal for prop traders that checks every trade against your own plan.

See `CLAUDE.md` for the stack, rules and milestones.

## Set-up
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key.
3. Apply the database migration in `supabase/migrations` (Supabase dashboard → SQL editor, or `supabase db push`).
4. In Supabase → Authentication → URL configuration, set the Site URL and add `<your-domain>/auth/callback` as a redirect URL.
5. `npm run dev`

## Tests
- `npm test` · `npm run test:db` · `npm run typecheck`
