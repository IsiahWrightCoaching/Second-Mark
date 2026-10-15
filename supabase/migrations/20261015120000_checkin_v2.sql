-- Second Mark: migration 2 (Milestone 2, logging).
-- 1. The check-in drops food, keeps water as its own yes/no, and adds how the trader feels.
-- 2. A trade can only carry check-in (health) data if the trader has given consent.
-- 3. One no-trade day per account per day.
-- Safe to run on a database that already has rows: old water-and-food answers are carried
-- across as water yes/no, and nothing is deleted.

-- ---------- check-ins ----------
alter table public.checkins add column water boolean;
alter table public.checkins add column feeling text check (feeling is null or feeling in ('calm','anxious','frustrated','flat','excited'));
update public.checkins set water = fuel in ('both','water_only');
alter table public.checkins alter column water set not null;
alter table public.checkins drop column fuel;
-- Every new or edited check-in must answer how you feel. "not valid" leaves any older rows alone
-- rather than inventing an answer for them.
alter table public.checkins add constraint checkins_feeling_required check (feeling is not null) not valid;

-- Editing a check-in also needs consent (if consent is withdrawn, the answers can be deleted but not changed).
drop policy "checkins: owner updates" on public.checkins;
create policy "checkins: owner updates with consent" on public.checkins for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.health_consent_at is not null));

-- ---------- trades ----------
alter table public.trades add column water boolean;
alter table public.trades add column feeling text check (feeling is null or feeling in ('calm','anxious','frustrated','flat','excited'));
update public.trades set water = fuel in ('both','water_only') where fuel is not null;
alter table public.trades drop column fuel;

-- State copied onto a trade is health data too, so it needs consent, enforced here rather than trusted to the app.
create or replace function public.trades_state_needs_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.sleep_hours is not null or new.usual_schedule is not null or new.carrying is not null
      or new.water is not null or new.feeling is not null or new.sharpness is not null)
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.health_consent_at is not null) then
    raise exception 'check-in data needs health-data consent';
  end if;
  return new;
end $$;
create trigger trades_state_consent before insert or update on public.trades for each row execute function public.trades_state_needs_consent();

-- ---------- no-trade days ----------
alter table public.no_trade_days add constraint no_trade_days_one_per_day unique (account_id, day);

-- ---------- fix: ownership check on tables without a strategy ----------
-- The first version referred to new.strategy_id inside one condition, which Postgres resolves even when
-- the table has no such column, so inserts into no_trade_days, skipped_setups, day_ratings and withdrawals
-- failed. Nesting the strategy check means it is only read on tables that have it.
create or replace function public.check_same_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is not null and not exists (select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id) then
    raise exception 'account does not belong to this user';
  end if;
  if tg_table_name in ('trades','account_strategies') then
    if not exists (select 1 from public.strategies s where s.id = new.strategy_id and s.user_id = new.user_id) then
      raise exception 'strategy does not belong to this user';
    end if;
  end if;
  return new;
end $$;
