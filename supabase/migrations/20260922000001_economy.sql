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
  daily_streak  int not null default 0,             -- day number of the last daily claim
  last_daily_claim date,                            -- UTC day of that claim
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

-- Display names: printable, at most 16 characters. Empty becomes null.
create or replace function public.clean_display_name(p_name text) returns text
language sql immutable as $$
  select nullif(trim(left(regexp_replace(regexp_replace(coalesce(p_name, ''), '[^\w \-]', '', 'g'), '\s+', ' ', 'g'), 16)), '');
$$;

-- DECIDED: a guest, or an account whose login carries no name, starts as "Player 12345".
create or replace function public.random_player_name() returns text
language sql volatile as $$
  select 'Player ' || lpad(floor(random() * 100000)::int::text, 5, '0');
$$;

-- First sight of a user: create the profile (name imported from the login
-- account, or a random player number) and grant the starting coins once.
create or replace function public.ensure_profile(p_user uuid, p_display_name text, p_is_guest boolean)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, player_code, display_name, is_guest)
  values (p_user, public.new_player_code(), coalesce(public.clean_display_name(p_display_name), public.random_player_name()), p_is_guest)
  on conflict (id) do nothing;

  insert into public.coin_ledger (user_id, amount, kind, idempotency_key)
  values (p_user, 1000, 'starting_bonus', 'start:' || p_user)
  on conflict (idempotency_key) do nothing;

  return public.get_balance(p_user);
end $$;

-- Players may change their display name (2 to 16 printable characters).
create or replace function public.set_display_name(p_user uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  clean text := public.clean_display_name(p_name);
begin
  if clean is null or length(clean) < 2 then
    raise exception 'a name needs at least 2 letters or digits' using errcode = 'P0001';
  end if;
  update public.profiles set display_name = clean where id = p_user;
  if not found then
    raise exception 'no profile for this player' using errcode = 'P0001';
  end if;
  return clean;
end $$;

-- Login streak: 200 on day 1, +50 per consecutive UTC day, 500 from day 7
-- on. Miss a day and it restarts at day 1. Same arithmetic as
-- dailyBonusForDay() in packages/game-rules/src/economy.ts.
create or replace function public.daily_bonus_coins(p_day int) returns bigint
language sql immutable as $$
  select 200 + 50 * (least(greatest(p_day, 1), 7) - 1);
$$;

-- Which streak day today's claim is, given the last claim.
create or replace function public.daily_streak_day(p_last_claim date, p_last_streak int, p_today date) returns int
language sql immutable as $$
  select case
    when p_last_claim = p_today then greatest(p_last_streak, 1)
    when p_last_claim = p_today - 1 then greatest(p_last_streak, 0) + 1
    else 1
  end;
$$;

-- Where the player's streak stands today:
-- {"claimed_today": false, "streak_day": 4, "coins": 350}
create or replace function public.daily_bonus_status(p_user uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'claimed_today', coalesce(p.last_daily_claim = today.d, false),
    'streak_day', public.daily_streak_day(p.last_daily_claim, p.daily_streak, today.d),
    'coins', public.daily_bonus_coins(public.daily_streak_day(p.last_daily_claim, p.daily_streak, today.d))
  )
  from (select (now() at time zone 'UTC')::date as d) as today
  left join public.profiles p on p.id = p_user;
$$;

-- Once per UTC day; the amount follows the streak.
create or replace function public.claim_daily_bonus(p_user uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'UTC')::date;
  last_claim date;
  last_streak int;
  day int;
begin
  select last_daily_claim, daily_streak into last_claim, last_streak
    from public.profiles where id = p_user for update;
  if not found then
    raise exception 'no profile for this player' using errcode = 'P0001';
  end if;
  if last_claim = today then
    raise exception 'daily bonus already claimed today' using errcode = 'P0001';
  end if;

  day := public.daily_streak_day(last_claim, last_streak, today);
  insert into public.coin_ledger (user_id, amount, kind, ref, idempotency_key)
  values (p_user, public.daily_bonus_coins(day), 'daily_bonus', 'day:' || day,
          'daily:' || p_user || ':' || to_char(today, 'YYYY-MM-DD'));
  update public.profiles set daily_streak = day, last_daily_claim = today where id = p_user;
  return public.get_balance(p_user);
exception when unique_violation then
  raise exception 'daily bonus already claimed today' using errcode = 'P0001';
end $$;

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

-- ---------------------------------------------------------------- friends
-- DECIDED: Gamenite's own list. One row per pair (a < b); the row is a
-- request until accepted_at is set. Only the server writes, via the
-- functions below; phones read their own rows at most.

create table if not exists public.friendships (
  a             uuid not null references public.profiles (id) on delete cascade,
  b             uuid not null references public.profiles (id) on delete cascade,
  requested_by  uuid not null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists friendships_b on public.friendships (b);

create or replace function public.user_id_by_code(p_code text) returns uuid
language sql stable as $$
  select id from public.profiles where player_code = upper(trim(p_code));
$$;

-- Ask to be friends. A request both ways is a yes. Returns 'requested', 'accepted' or 'already'.
create or replace function public.request_friend(p_user uuid, p_friend uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  lo uuid := least(p_user, p_friend);
  hi uuid := greatest(p_user, p_friend);
  pair public.friendships;
begin
  if p_user = p_friend then
    raise exception 'that is your own code' using errcode = 'P0001';
  end if;
  select * into pair from public.friendships where a = lo and b = hi for update;
  if not found then
    insert into public.friendships (a, b, requested_by) values (lo, hi, p_user);
    return 'requested';
  end if;
  if pair.accepted_at is not null then
    return 'already';
  end if;
  if pair.requested_by <> p_user then
    update public.friendships set accepted_at = now() where a = lo and b = hi;
    return 'accepted';
  end if;
  return 'requested';
end $$;

-- Accept or decline a request that came in.
create or replace function public.answer_friend(p_user uuid, p_friend uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  lo uuid := least(p_user, p_friend);
  hi uuid := greatest(p_user, p_friend);
  pair public.friendships;
begin
  select * into pair from public.friendships where a = lo and b = hi for update;
  if not found or pair.accepted_at is not null or pair.requested_by = p_user then
    raise exception 'no request from them' using errcode = 'P0001';
  end if;
  if p_accept then
    update public.friendships set accepted_at = now() where a = lo and b = hi;
  else
    delete from public.friendships where a = lo and b = hi;
  end if;
end $$;

-- Remove a friend, or withdraw a request.
create or replace function public.remove_friend(p_user uuid, p_friend uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friendships where a = least(p_user, p_friend) and b = greatest(p_user, p_friend);
$$;

create or replace function public.are_friends(p_user uuid, p_other uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.friendships
    where a = least(p_user, p_other) and b = greatest(p_user, p_other) and accepted_at is not null
  );
$$;

-- {"friends": [{"user_id", "player_code", "display_name"}], "incoming": [...], "outgoing": [...]}
create or replace function public.friend_lists(p_user uuid) returns jsonb
language sql stable as $$
  with pairs as (
    select case when f.a = p_user then f.b else f.a end as other, f.requested_by, f.accepted_at
    from public.friendships f
    where f.a = p_user or f.b = p_user
  ), cards as (
    select p.id as user_id, p.player_code, p.display_name, pairs.requested_by, pairs.accepted_at
    from pairs join public.profiles p on p.id = pairs.other
  )
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'player_code', player_code, 'display_name', display_name) order by display_name)
                         from cards where accepted_at is not null), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'player_code', player_code, 'display_name', display_name) order by display_name)
                          from cards where accepted_at is null and requested_by <> p_user), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'player_code', player_code, 'display_name', display_name) order by display_name)
                          from cards where accepted_at is null and requested_by = p_user), '[]'::jsonb)
  );
$$;

alter table public.friendships enable row level security;
drop policy if exists "own friendships" on public.friendships;
create policy "own friendships" on public.friendships for select using (auth.uid() in (a, b));
