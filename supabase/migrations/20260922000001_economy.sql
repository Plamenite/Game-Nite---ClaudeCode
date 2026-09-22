-- Gamenite economy: profiles, an append-only coin ledger, and the only
-- ways coins can move. Applied to the Supabase project with
-- `supabase db push` (or pasted into the SQL editor), in order.
--
-- PRINCIPLES
--   * Coins are in-app only. Nothing here can ever pay out real money.
--   * The ledger is append-only: rows are never updated or deleted.
--   * Only the game server (service role) may move coins, through the
--     functions below. Phones can read their own rows and nothing else.
--   * Every movement carries an idempotency key, so a retried request
--     can never apply twice.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  player_code   text not null unique,              -- what friends type to add you
  username      text unique,                       -- optional, chosen later
  display_name  text not null default 'Guest',
  avatar_url    text,
  is_guest      boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- ledger

create table if not exists public.coin_ledger (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  amount           bigint not null,                -- positive credit, negative debit
  kind             text not null check (kind in (
                     'starting_bonus', 'daily_bonus', 'ad_reward',
                     'table_entry', 'table_reward', 'table_refund',
                     'purchase', 'adjustment')),
  ref              text,                           -- table id, purchase id, ...
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);
create index if not exists coin_ledger_user_created on public.coin_ledger (user_id, created_at desc);
create index if not exists coin_ledger_user_kind_created on public.coin_ledger (user_id, kind, created_at desc);

create table if not exists public.coin_balances (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  balance     bigint not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);

-- Keep balances in step with the ledger. The balance check rejects any
-- debit that would overdraw, which rolls back the whole insert.
-- (Update first: Postgres checks constraints on the proposed row of an
-- upsert before it resolves the conflict, so a debit would be refused.)
create or replace function public.apply_ledger_entry() returns trigger
language plpgsql as $$
begin
  update public.coin_balances
    set balance = balance + new.amount, updated_at = now()
    where user_id = new.user_id;
  if not found then
    insert into public.coin_balances (user_id, balance) values (new.user_id, new.amount);
  end if;
  return new;
end $$;

drop trigger if exists coin_ledger_apply on public.coin_ledger;
create trigger coin_ledger_apply
  after insert on public.coin_ledger
  for each row execute function public.apply_ledger_entry();

-- The ledger is history. Nobody rewrites history.
create or replace function public.forbid_ledger_change() returns trigger
language plpgsql as $$
begin
  raise exception 'coin_ledger is append-only';
end $$;

drop trigger if exists coin_ledger_immutable on public.coin_ledger;
create trigger coin_ledger_immutable
  before update or delete on public.coin_ledger
  for each row execute function public.forbid_ledger_change();

-- ---------------------------------------------------------------- helpers

-- Letters and digits that are hard to confuse when read aloud.
create or replace function public.new_player_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where player_code = code);
  end loop;
  return code;
end $$;

create or replace function public.get_balance(p_user uuid) returns bigint
language sql stable as $$
  select coalesce((select balance from public.coin_balances where user_id = p_user), 0);
$$;

-- ---------------------------------------------------------------- the only ways coins move
-- All are SECURITY DEFINER and meant to be called by the server's service
-- role. Each raises a clear error when a rule is broken.

-- First sight of a user: create the profile and grant the starting coins once.
create or replace function public.ensure_profile(p_user uuid, p_display_name text, p_is_guest boolean)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, player_code, display_name, is_guest)
  values (p_user, public.new_player_code(), coalesce(nullif(trim(p_display_name), ''), 'Guest'), p_is_guest)
  on conflict (id) do nothing;

  insert into public.coin_ledger (user_id, amount, kind, idempotency_key)
  values (p_user, 1000, 'starting_bonus', 'start:' || p_user)
  on conflict (idempotency_key) do nothing;

  return public.get_balance(p_user);
end $$;

-- Once per UTC day.
create or replace function public.claim_daily_bonus(p_user uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  today text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
begin
  insert into public.coin_ledger (user_id, amount, kind, idempotency_key)
  values (p_user, 200, 'daily_bonus', 'daily:' || p_user || ':' || today);
  return public.get_balance(p_user);
exception when unique_violation then
  raise exception 'daily bonus already claimed today' using errcode = 'P0001';
end $$;

-- Has today's (UTC) bonus been claimed already?
create or replace function public.daily_bonus_claimed(p_user uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.coin_ledger
    where user_id = p_user and kind = 'daily_bonus'
      and idempotency_key = 'daily:' || p_user || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
  );
$$;

-- One reward per completed ad, at most five per UTC day.
create or replace function public.reward_ad(p_user uuid, p_ad_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  today_count int;
begin
  select count(*) into today_count
  from public.coin_ledger
  where user_id = p_user and kind = 'ad_reward'
    and (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;
  if today_count >= 5 then
    raise exception 'daily ad reward limit reached' using errcode = 'P0001';
  end if;

  insert into public.coin_ledger (user_id, amount, kind, ref, idempotency_key)
  values (p_user, 100, 'ad_reward', p_ad_id, 'ad:' || p_ad_id);
  return public.get_balance(p_user);
exception when unique_violation then
  raise exception 'this ad was already rewarded' using errcode = 'P0001';
end $$;

-- Sitting down at a table costs the entry. Fails if the player cannot afford it.
create or replace function public.charge_table_entry(p_user uuid, p_table text, p_entry bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if p_entry not in (500, 2000, 10000) then
    raise exception 'not a table entry tier: %', p_entry using errcode = 'P0001';
  end if;
  insert into public.coin_ledger (user_id, amount, kind, ref, idempotency_key)
  values (p_user, -p_entry, 'table_entry', p_table, 'entry:' || p_table || ':' || p_user);
  return public.get_balance(p_user);
exception
  when unique_violation then
    return public.get_balance(p_user);  -- already charged for this table: fine
  when check_violation then
    raise exception 'not enough coins for this table' using errcode = 'P0001';
end $$;

-- Record the outcome the server computed with the shared settlement rules.
-- p_moves: [{"user_id": "...", "amount": 950, "kind": "table_reward"}, ...]
create or replace function public.settle_table(p_table text, p_moves jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m jsonb;
begin
  for m in select * from jsonb_array_elements(p_moves) loop
    if (m->>'kind') not in ('table_reward', 'table_refund') then
      raise exception 'settlement may only reward or refund' using errcode = 'P0001';
    end if;
    if (m->>'amount')::bigint <= 0 then
      raise exception 'settlement amounts must be positive' using errcode = 'P0001';
    end if;
    insert into public.coin_ledger (user_id, amount, kind, ref, idempotency_key)
    values ((m->>'user_id')::uuid, (m->>'amount')::bigint, m->>'kind', p_table,
            (m->>'kind') || ':' || p_table || ':' || (m->>'user_id'))
    on conflict (idempotency_key) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------- who can see what

alter table public.profiles      enable row level security;
alter table public.coin_ledger   enable row level security;
alter table public.coin_balances enable row level security;

-- Signed-in phones read their own profile, balance and history. They never write.
drop policy if exists "own profile"  on public.profiles;
drop policy if exists "own ledger"   on public.coin_ledger;
drop policy if exists "own balance"  on public.coin_balances;
create policy "own profile" on public.profiles      for select using (auth.uid() = id);
create policy "own ledger"  on public.coin_ledger   for select using (auth.uid() = user_id);
create policy "own balance" on public.coin_balances for select using (auth.uid() = user_id);

-- Other players' public card: name and code only, through a view.
create or replace view public.player_cards as
  select id, player_code, display_name, avatar_url from public.profiles;
