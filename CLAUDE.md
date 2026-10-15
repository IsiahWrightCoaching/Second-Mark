# Second Mark

A trading journal for prop traders that checks whether each trade followed the trader's own plan, and links that to their state (sleep, schedule, what they're carrying, how they feel, water, sharpness). Built by Isiah Wright with Claude.

The full rule set is the project doc `second-mark-logic-spec.md`. The tested prototype (version 18) is the reference for behaviour and wording.

## Stack
- Next.js 15 (App Router) + TypeScript, deployed on Vercel.
- Supabase: Postgres, auth (email magic link), row-level security.
- Vitest for tests. PGlite for database security tests.
- Fonts bundled via @fontsource (no Google requests at runtime).

## Commands
- `npm test` runs the analysis engine tests, including parity with the prototype.
- `npm run test:db` runs the migration in an in-memory Postgres and tries to break row-level security as a second user.
- `npm run typecheck`, `npm run build`.
- Run all three test commands before every commit.

## Non-negotiable rules
1. **Security first.** Every table has row-level security with owner-only policies. Never add a policy that lets one user read another's rows. Never use the service role key in the browser or in a `NEXT_PUBLIC_` variable. Every new table goes into `scripts/test-rls.mjs`.
2. **Health data.** Check-in answers are UK GDPR special category data. They can't be saved without `profiles.health_consent_at` (enforced in the database). Trades logged without a check-in store null state, never defaults.
3. **One engine.** All numbers come from `src/lib/engine`. Screens never recalculate stats themselves. The engine stays pure: no database, no React, no browser.
4. **One definition of "to plan":** planned, rules met, risk within default, exit as planned, inside the daily trade limit (`followed()` in `core.ts`).
5. **Honesty in findings.** Patterns need 8+ trades each side, a 15-point gap and z >= 2.50 (Bonferroni over the 8 state tests). Split cards need the profit factors on either side of 1, a 0.4R gap and a test; "Clear" passes a Bonferroni bar across every comparison on the view. Never loosen these to make the app look smarter.
6. **Wording.** Plain English. "To plan" and "off plan". Tips lead with an action and never refer to course sessions or other existing material. No trade or sizing instructions beyond the trader's own rules. No em dashes.
7. **Dates** are grouped in the trader's own time zone (`profiles.timezone`) via `dayKey(ts, tz)`.
8. **Scope.** New ideas go on the V1.1 list in the build plan, not into the current milestone.

## Milestones
1. Foundation: auth, consent, schema + RLS, strategies, accounts wizard. (live)
2. Logging: check-in, trade log, no-trade days, skipped setups, edit/delete, installable web app. (built; needs migration 20261015120000 run in Supabase)
3. Engine wired to real data (engine already ported and tested).
4. Review and Stats tabs, insight cards, focus habit, check-in warning, two-loss prompt.
5. Accounts lifecycle: prop rules from trades, past accounts, delete (30-day bin), CSV export.
6. Payments: Stripe subscription, 30-day trial, discount codes.
7. Launch kit: legal pages, push reminders, funnel tracking.
