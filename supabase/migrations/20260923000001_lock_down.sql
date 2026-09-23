-- Lock the database down to the game server.
--
-- Supabase lets every signed-in or anonymous app user call functions in
-- the public schema directly (POST /rest/v1/rpc/<name>) with the
-- publishable key that ships inside the app. Our functions move coins, so
-- only the game server (service role) may call them. Phones never talk to
-- the database; everything goes through the server.
--
-- Safe to run more than once.

-- Every function in the public schema: nobody but the server.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Functions created later start locked too.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- The player-card view reads profiles with its owner's rights, which would
-- let anyone list every player. The server reads profiles itself instead.
revoke all on public.player_cards from anon, authenticated;

-- Tables: row-level security already limits phones to reading their own
-- rows. Take away writes outright as a second lock.
revoke insert, update, delete, truncate on public.profiles, public.coin_ledger, public.coin_balances,
  public.friendships, public.voice_usage from anon, authenticated;
