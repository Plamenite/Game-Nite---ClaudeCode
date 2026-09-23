import assert from "assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Runs the real Supabase migration against an embedded Postgres, with a
 * stub of Supabase's auth schema, and proves every economy rule holds in
 * the database itself, not just in our TypeScript.
 */
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("economy SQL (embedded Postgres)", function () {
  this.timeout(60000);
  let db: PGlite;

  const balance = async (user: string) => Number((await db.query<{ b: string }>("select public.get_balance($1) as b", [user])).rows[0].b);
  const rejects = async (promise: Promise<unknown>, pattern: RegExp) =>
    assert.rejects(promise, (e: unknown) => {
      assert.match(String((e as Error).message), pattern);
      return true;
    });

  before(async () => {
    db = new PGlite();
    // Supabase provides these; a plain Postgres does not.
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      insert into auth.users (id) values ('${U1}'), ('${U2}');
      -- Supabase's roles, and its default of letting app users call public functions.
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `);
    // Every migration, in order, the way Supabase applies them.
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    }
  });

  after(async () => db.close());

  it("first sight creates the profile and grants the start exactly once", async () => {
    await db.query("select public.ensure_profile($1, $2, $3)", [U1, "  Zain  ", false]);
    assert.strictEqual(await balance(U1), 1000);
    await db.query("select public.ensure_profile($1, $2, $3)", [U1, "Zain", false]);
    assert.strictEqual(await balance(U1), 1000, "no second starting bonus");
    const p = (await db.query<{ display_name: string; player_code: string; is_guest: boolean }>("select display_name, player_code, is_guest from public.profiles where id = $1", [U1])).rows[0];
    assert.strictEqual(p.display_name, "Zain");
    assert.match(p.player_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.strictEqual(p.is_guest, false);
    await db.query("select public.ensure_profile($1, $2, $3)", [U2, "", true]);
    const guestName = (await db.query<{ d: string }>("select display_name as d from public.profiles where id = $1", [U2])).rows[0].d;
    assert.match(guestName, /^Player \d{5}$/, "a guest starts as a random player number");

    // Names can be changed, within reason.
    assert.strictEqual((await db.query<{ n: string }>("select public.set_display_name($1, $2) as n", [U2, "  Ali   Khan!! "])).rows[0].n, "Ali Khan");
    await rejects(db.query("select public.set_display_name($1, $2)", [U2, " x "]), /at least 2/);
    assert.strictEqual((await db.query<{ d: string }>("select display_name as d from public.profiles where id = $1", [U2])).rows[0].d, "Ali Khan");
  });

  it("the daily bonus can be claimed once per day", async () => {
    const status = async (user: string) => (await db.query<{ s: Record<string, unknown> }>("select public.daily_bonus_status($1) as s", [user])).rows[0].s;
    assert.deepStrictEqual(await status(U1), { claimed_today: false, streak_day: 1, coins: 200 });
    await db.query("select public.claim_daily_bonus($1)", [U1]);
    assert.strictEqual(await balance(U1), 1200);
    assert.deepStrictEqual(await status(U1), { claimed_today: true, streak_day: 1, coins: 200 });
    await rejects(db.query("select public.claim_daily_bonus($1)", [U1]), /already claimed/);
    assert.strictEqual(await balance(U1), 1200);
    const row = (await db.query<{ ref: string; day: number }>("select ref, daily_streak as day from public.coin_ledger l join public.profiles p on p.id = l.user_id where l.user_id = $1 and kind = 'daily_bonus'", [U1])).rows[0];
    assert.deepStrictEqual(row, { ref: "day:1", day: 1 });
  });

  it("the daily bonus grows with a login streak, caps at day seven, and restarts after a missed day", async () => {
    const status = async (user: string) => (await db.query<{ s: Record<string, unknown> }>("select public.daily_bonus_status($1) as s", [user])).rows[0].s;
    const pretend = (user: string, daysAgo: number, streak: number) =>
      db.query("update public.profiles set last_daily_claim = (now() at time zone 'UTC')::date - $2::int, daily_streak = $3 where id = $1", [user, daysAgo, streak]);

    // Claimed yesterday as day 3: today is day 4 and pays 350.
    await pretend(U2, 1, 3);
    assert.deepStrictEqual(await status(U2), { claimed_today: false, streak_day: 4, coins: 350 });
    await db.query("select public.claim_daily_bonus($1)", [U2]);
    assert.strictEqual(await balance(U2), 1350);
    assert.deepStrictEqual(await status(U2), { claimed_today: true, streak_day: 4, coins: 350 });

    // Long streaks keep counting but the coins stay at the day-seven amount.
    await pretend(U1, 1, 9);
    assert.deepStrictEqual(await status(U1), { claimed_today: false, streak_day: 10, coins: 500 });

    // Missing a day restarts at day 1.
    await pretend(U1, 2, 9);
    assert.deepStrictEqual(await status(U1), { claimed_today: false, streak_day: 1, coins: 200 });
    // Today's key is already in the ledger for U1, so the claim itself still refuses.
    await rejects(db.query("select public.claim_daily_bonus($1)", [U1]), /already claimed/);
    await pretend(U1, 0, 1);
  });

  it("ad rewards: one per ad id, at most five per day", async () => {
    for (let i = 1; i <= 5; i++) await db.query("select public.reward_ad($1, $2)", [U1, `ad-${i}`]);
    assert.strictEqual(await balance(U1), 1700);
    await rejects(db.query("select public.reward_ad($1, $2)", [U1, "ad-6"]), /limit/);
    await rejects(db.query("select public.reward_ad($1, $2)", [U2, "ad-1"]), /already rewarded/);
    assert.strictEqual(await balance(U1), 1700);
  });

  it("a table entry is charged once, refused when unaffordable, and only in real tiers", async () => {
    assert.strictEqual(Number((await db.query<{ b: string }>("select public.charge_table_entry($1, $2, $3) as b", [U1, "table-1", 500])).rows[0].b), 1200);
    // Retrying the same charge is harmless.
    await db.query("select public.charge_table_entry($1, $2, $3)", [U1, "table-1", 500]);
    assert.strictEqual(await balance(U1), 1200);
    await rejects(db.query("select public.charge_table_entry($1, $2, $3)", [U2, "table-1", 2000]), /not enough coins/);
    assert.strictEqual(await balance(U2), 1350, "a refused charge changes nothing");
    await rejects(db.query("select public.charge_table_entry($1, $2, $3)", [U1, "table-x", 750]), /not a table entry tier/);
  });

  it("settling records rewards and refunds, once, and never anything else", async () => {
    await db.query("select public.charge_table_entry($1, $2, $3)", [U2, "table-1", 500]);
    const moves = JSON.stringify([{ user_id: U1, amount: 950, kind: "table_reward" }]);
    await db.query("select public.settle_table($1, $2::jsonb)", ["table-1", moves]);
    assert.strictEqual(await balance(U1), 2150, "entry back plus 450");
    assert.strictEqual(await balance(U2), 850);
    await db.query("select public.settle_table($1, $2::jsonb)", ["table-1", moves]);
    assert.strictEqual(await balance(U1), 2150, "settling twice does not pay twice");

    await rejects(db.query("select public.settle_table($1, $2::jsonb)", ["table-2", JSON.stringify([{ user_id: U1, amount: 5, kind: "purchase" }])]), /only reward or refund/);
    await rejects(db.query("select public.settle_table($1, $2::jsonb)", ["table-2", JSON.stringify([{ user_id: U1, amount: -5, kind: "table_refund" }])]), /positive/);
  });

  it("friends: ask by code, a request both ways is a yes, answer, remove, never yourself", async () => {
    const lists = async (u: string) => (await db.query<{ l: { friends: any[]; incoming: any[]; outgoing: any[] } }>("select public.friend_lists($1) as l", [u])).rows[0].l;
    const request = async (u: string, f: string) => (await db.query<{ r: string }>("select public.request_friend($1, $2) as r", [u, f])).rows[0].r;
    const areFriends = async (u: string, f: string) => (await db.query<{ b: boolean }>("select public.are_friends($1, $2) as b", [u, f])).rows[0].b;

    const code1 = (await db.query<{ c: string }>("select player_code as c from public.profiles where id = $1", [U1])).rows[0].c;
    assert.strictEqual((await db.query<{ id: string }>("select public.user_id_by_code($1) as id", [` ${code1.toLowerCase()} `])).rows[0].id, U1);
    assert.strictEqual((await db.query<{ id: string }>("select public.user_id_by_code($1) as id", ["ZZZZZZZZ"])).rows[0].id, null);
    await rejects(db.query("select public.request_friend($1, $1)", [U1]), /own code/);

    assert.strictEqual(await request(U1, U2), "requested");
    assert.strictEqual(await request(U1, U2), "requested", "asking twice changes nothing");
    assert.deepStrictEqual((await lists(U1)).outgoing.map((r) => r.user_id), [U2]);
    assert.deepStrictEqual((await lists(U2)).incoming.map((r) => r.user_id), [U1]);
    assert.strictEqual(await areFriends(U1, U2), false);

    assert.strictEqual(await request(U2, U1), "accepted", "they asked me: a request back is a yes");
    assert.strictEqual(await areFriends(U2, U1), true);
    assert.deepStrictEqual((await lists(U1)).friends.map((r) => [r.user_id, r.display_name]), [[U2, "Ali Khan"]]);
    assert.strictEqual(await request(U1, U2), "already");

    await db.query("select public.remove_friend($1, $2)", [U1, U2]);
    assert.strictEqual(await areFriends(U1, U2), false);
    assert.deepStrictEqual(await lists(U1), { friends: [], incoming: [], outgoing: [] });

    assert.strictEqual(await request(U2, U1), "requested");
    await rejects(db.query("select public.answer_friend($1, $2, true)", [U2, U1]), /no request/); // you cannot answer your own request
    await db.query("select public.answer_friend($1, $2, false)", [U1, U2]);
    assert.deepStrictEqual(await lists(U2), { friends: [], incoming: [], outgoing: [] }, "declined: gone");
    await rejects(db.query("select public.answer_friend($1, $2, true)", [U1, U2]), /no request/);
    assert.strictEqual(await request(U2, U1), "requested");
    await db.query("select public.answer_friend($1, $2, true)", [U1, U2]);
    assert.strictEqual(await areFriends(U1, U2), true);
  });

  it("voice minutes add up per day and never go negative", async () => {
    const today = async (u: string) => Number((await db.query<{ s: string }>("select public.voice_seconds_today($1) as s", [u])).rows[0].s);
    assert.strictEqual(await today(U1), 0);
    assert.strictEqual(Number((await db.query<{ t: string }>("select public.add_voice_seconds($1, $2) as t", [U1, 90])).rows[0].t), 90);
    assert.strictEqual(Number((await db.query<{ t: string }>("select public.add_voice_seconds($1, $2) as t", [U1, 30])).rows[0].t), 120);
    assert.strictEqual(await today(U1), 120);
    assert.strictEqual(await today(U2), 0, "each player has their own count");
    await rejects(db.query("select public.add_voice_seconds($1, $2)", [U1, -5]), /negative/);
  });

  it("app users cannot call the coin functions or write tables directly; only the server can", async () => {
    const asRole = async (role: string, sql: string, params: unknown[] = []) => {
      await db.exec(`set role ${role}`);
      try {
        return await db.query(sql, params);
      } finally {
        await db.exec("reset role");
      }
    };
    const moves = JSON.stringify([{ user_id: U2, amount: 1000000, kind: "table_reward" }]);
    for (const role of ["anon", "authenticated"]) {
      await rejects(asRole(role, "select public.settle_table($1, $2::jsonb)", ["mint", moves]), /permission denied/);
      await rejects(asRole(role, "select public.claim_daily_bonus($1)", [U2]), /permission denied/);
      await rejects(asRole(role, "select public.ensure_profile($1, $2, $3)", [U2, "x", true]), /permission denied/);
      await rejects(asRole(role, "select public.request_friend($1, $2)", [U1, U2]), /permission denied/);
      await rejects(asRole(role, "select public.get_balance($1)", [U2]), /permission denied/);
      await rejects(asRole(role, "select * from public.player_cards"), /permission denied/);
      await rejects(asRole(role, "insert into public.coin_ledger (user_id, amount, kind, idempotency_key) values ($1, 5, 'adjustment', 'x')", [U2]), /permission denied/);
    }
    // The server (service role) still works.
    const before = await balance(U2);
    await asRole("service_role", "select public.voice_seconds_today($1)", [U2]);
    assert.strictEqual(await balance(U2), before, "a refused call changed nothing");
  });

  it("the ledger is append-only and balances never go below zero", async () => {
    await rejects(db.query("update public.coin_ledger set amount = 999999 where user_id = $1", [U1]), /append-only/);
    await rejects(db.query("delete from public.coin_ledger where user_id = $1", [U1]), /append-only/);
    await rejects(
      db.query("insert into public.coin_ledger (user_id, amount, kind, idempotency_key) values ($1, -999999, 'adjustment', 'adj-1')", [U1]),
      /balance_check|check constraint/,
    );
    assert.strictEqual(await balance(U1), 2150);
    const rows = (await db.query<{ n: string }>("select count(*) as n from public.coin_ledger where user_id = $1", [U1])).rows[0];
    assert.strictEqual(Number(rows.n), 1 + 1 + 5 + 1 + 1, "start, daily, five ads, entry, reward");
  });
});
