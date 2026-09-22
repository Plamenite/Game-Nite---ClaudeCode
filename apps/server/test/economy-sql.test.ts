import assert from "assert";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Runs the real Supabase migration against an embedded Postgres, with a
 * stub of Supabase's auth schema, and proves every economy rule holds in
 * the database itself, not just in our TypeScript.
 */
const MIGRATION = new URL("../../../supabase/migrations/20260922000001_economy.sql", import.meta.url);

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
    `);
    await db.exec(readFileSync(MIGRATION, "utf8"));
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
    assert.strictEqual((await db.query<{ d: string }>("select display_name as d from public.profiles where id = $1", [U2])).rows[0].d, "Guest");
  });

  it("the daily bonus can be claimed once per day", async () => {
    await db.query("select public.claim_daily_bonus($1)", [U1]);
    assert.strictEqual(await balance(U1), 1200);
    await rejects(db.query("select public.claim_daily_bonus($1)", [U1]), /already claimed/);
    assert.strictEqual(await balance(U1), 1200);
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
    assert.strictEqual(await balance(U2), 1000, "a refused charge changes nothing");
    await rejects(db.query("select public.charge_table_entry($1, $2, $3)", [U1, "table-x", 750]), /not a table entry tier/);
  });

  it("settling records rewards and refunds, once, and never anything else", async () => {
    await db.query("select public.charge_table_entry($1, $2, $3)", [U2, "table-1", 500]);
    const moves = JSON.stringify([{ user_id: U1, amount: 950, kind: "table_reward" }]);
    await db.query("select public.settle_table($1, $2::jsonb)", ["table-1", moves]);
    assert.strictEqual(await balance(U1), 2150, "entry back plus 450");
    assert.strictEqual(await balance(U2), 500);
    await db.query("select public.settle_table($1, $2::jsonb)", ["table-1", moves]);
    assert.strictEqual(await balance(U1), 2150, "settling twice does not pay twice");

    await rejects(db.query("select public.settle_table($1, $2::jsonb)", ["table-2", JSON.stringify([{ user_id: U1, amount: 5, kind: "purchase" }])]), /only reward or refund/);
    await rejects(db.query("select public.settle_table($1, $2::jsonb)", ["table-2", JSON.stringify([{ user_id: U1, amount: -5, kind: "table_refund" }])]), /positive/);
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
