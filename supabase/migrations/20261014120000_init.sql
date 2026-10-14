-- Second Mark: initial schema.
-- Security model: every table has row-level security, and every policy is "owner only".
-- A user can only read or write rows where user_id = their own auth id. There are no
-- admin or shared policies; anonymised totals for firms, if ever needed, come from a
-- separate reporting process, never from these tables directly.

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Europe/London',
  currency text not null default 'USD' check (currency in ('USD','GBP','EUR')),
  -- Sleep, food, mood and health answers are special category data under UK GDPR.
  -- Check-ins cannot be saved until this is set (enforced by policy below).
  health_consent_at timestamptz,
  -- Finished the welcome step, with or without consent.
  onboarded_at timestamptz,
  reminder_time time default '07:30',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Create a profile row for every new sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- strategies ----------
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('rules','discretionary')),
  description text not null default '',
  checklist text[] not null default '{}',
  instruments text[] not null default '{}',
  default_risk_pct numeric(5,2) not null check (default_risk_pct > 0 and default_risk_pct <= 10),
  max_per_day int check (max_per_day is null or max_per_day between 1 and 50),
  version int not null default 1,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger strategies_updated before update on public.strategies for each row execute function public.set_updated_at();

-- Each checklist version is kept, so old trades keep the rules they were logged against.
create table public.strategy_versions (
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  version int not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  checklist text[] not null,
  created_at timestamptz not null default now(),
  primary key (strategy_id, version)
);

-- ---------- accounts ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('challenge','funded','demo')),
  firm text not null default '',
  size numeric(14,2) not null check (size > 0),
  currency text not null default 'USD' check (currency in ('USD','GBP','EUR')),
  targets numeric(5,2)[] not null default '{}',
  max_drawdown_pct numeric(5,2) not null default 0,
  daily_loss_pct numeric(5,2) not null default 0,
  dd_basis text not null default 'balance' check (dd_basis in ('balance','equity')),
  dd_mode text not null default 'static' check (dd_mode in ('static','trailing')),
  fee numeric(10,2) not null default 0,
  archived boolean not null default false,
  closed_as text check (closed_as is null or closed_as = 'funded'),
  -- set when a funded account was created from this challenge
  funded_from uuid references public.accounts(id) on delete set null,
  manual_fail boolean not null default false,
  manual_passes timestamptz[] not null default '{}',
  -- "Recently deleted": hidden at once, hard-deleted after 30 days by a scheduled job.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();

create table public.account_strategies (
  account_id uuid not null references public.accounts(id) on delete cascade,
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (account_id, strategy_id)
);

-- ---------- daily check-in ----------
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sleep_hours numeric(3,1) not null check (sleep_hours between 0 and 16),
  usual_schedule boolean not null,
  carrying text not null check (carrying in ('nothing','money','home','work','health','other')),
  fuel text not null check (fuel in ('both','water_only','food_only','neither')),
  sharpness int not null check (sharpness between 1 and 10),
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

-- ---------- trades ----------
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  strategy_id uuid not null references public.strategies(id) on delete restrict,
  strategy_version int not null,
  entry_at timestamptz not null,
  instrument text not null check (length(instrument) between 1 and 20),
  direction text not null check (direction in ('long','short')),
  planned boolean not null,
  impulse_reason text not null default '' check (impulse_reason in ('','fomo','after_loss','boredom','back_to_even','on_a_roll','target_pressure')),
  rules_met boolean not null,
  missed_rules text[] not null default '{}',
  grade text check (grade is null or grade in ('A','B','C')),
  exit text not null check (exit in ('as_planned','closed_early','held_loser')),
  risk_pct numeric(5,2) not null check (risk_pct > 0),
  default_risk_pct numeric(5,2) not null check (default_risk_pct > 0),
  result_usd numeric(14,2) not null,
  r numeric(8,2) not null,
  over_limit boolean not null default false,
  below_fee boolean not null default false,
  after_loss boolean not null default false,
  -- State copied from that day's check-in when the trade was logged; null if there was none.
  sleep_hours numeric(3,1),
  usual_schedule boolean,
  carrying text,
  fuel text,
  sharpness int,
  note text not null default '' check (length(note) <= 280),
  log_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trades_user_entry on public.trades (user_id, entry_at desc);
create index trades_account on public.trades (account_id, entry_at);
create trigger trades_updated before update on public.trades for each row execute function public.set_updated_at();

-- ---------- no-trade days, skipped setups, ratings, withdrawals, focus ----------
create table public.no_trade_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  reason text not null check (reason in ('no_setup','not_right_state','news_day','fear','stopped_at_limit','rest_day','no_time','market_closed','other')),
  state text check (state is null or state in ('tired','emotional','carrying','unwell','rushed')),
  created_at timestamptz not null default now()
);
create table public.skipped_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now(),
  reason text not null check (reason in ('fear','away','too_late'))
);
create table public.day_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  rating text not null check (rating in ('A','B','C')),
  primary key (account_id, day)
);
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0)
);
create table public.focus (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mistake_key text not null check (mistake_key in ('impulsive','checklist','overLimit','oversized','heldLoser','closedEarly')),
  plan text not null,
  since timestamptz not null default now(),
  base_rate int not null
);

-- ---------- row-level security: owner only, everywhere ----------
do $$
declare t text;
begin
  foreach t in array array['strategies','strategy_versions','accounts','account_strategies','trades','no_trade_days','skipped_setups','day_ratings','withdrawals','focus']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s: owner reads" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s: owner inserts" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s: owner updates" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s: owner deletes" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "profiles: owner reads" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: owner updates" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Check-ins hold health data: owner only, and only after explicit consent.
alter table public.checkins enable row level security;
create policy "checkins: owner reads" on public.checkins for select to authenticated using ((select auth.uid()) = user_id);
create policy "checkins: owner inserts with consent" on public.checkins for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.health_consent_at is not null));
create policy "checkins: owner updates" on public.checkins for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "checkins: owner deletes" on public.checkins for delete to authenticated using ((select auth.uid()) = user_id);

-- Cross-row integrity the policies can't express: a row's account and strategy must belong to the same user.
create or replace function public.check_same_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is not null and not exists (select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id) then
    raise exception 'account does not belong to this user';
  end if;
  if tg_table_name in ('trades','account_strategies') and not exists (select 1 from public.strategies s where s.id = new.strategy_id and s.user_id = new.user_id) then
    raise exception 'strategy does not belong to this user';
  end if;
  return new;
end $$;
create trigger trades_same_owner before insert or update on public.trades for each row execute function public.check_same_owner();
create trigger account_strategies_same_owner before insert or update on public.account_strategies for each row execute function public.check_same_owner();
create trigger no_trade_days_same_owner before insert or update on public.no_trade_days for each row execute function public.check_same_owner();
create trigger skipped_setups_same_owner before insert or update on public.skipped_setups for each row execute function public.check_same_owner();
create trigger day_ratings_same_owner before insert or update on public.day_ratings for each row execute function public.check_same_owner();
create trigger withdrawals_same_owner before insert or update on public.withdrawals for each row execute function public.check_same_owner();
