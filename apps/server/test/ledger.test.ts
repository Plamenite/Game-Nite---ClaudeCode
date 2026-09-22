import assert from "assert";

import { LedgerError, MemoryLedger, ledgerFromEnv } from "../src/ledger.js";

describe("MemoryLedger (development ledger with the database's rules)", () => {
  const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof LedgerError && re.test(e.message));

  it("grants the start once, pays the daily bonus once, caps ads at five", async () => {
    const l = new MemoryLedger();
    assert.strictEqual(await l.ensureProfile("u1", "Zain", false), 1000);
    assert.strictEqual(await l.ensureProfile("u1", "Zain", false), 1000);
    assert.match(await l.playerCode("u1"), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.strictEqual(await l.playerCode("u1"), await l.playerCode("u1"), "a player keeps one code");
    assert.notStrictEqual(await l.playerCode("u1"), await l.playerCode("u2"));
    assert.strictEqual(await l.claimDailyBonus("u1"), 1200);
    await rejects(l.claimDailyBonus("u1"), /already claimed/);
    for (let i = 1; i <= 5; i++) await l.rewardAd("u1", `ad-${i}`);
    assert.strictEqual(await l.getBalance("u1"), 1700);
    await rejects(l.rewardAd("u1", "ad-6"), /limit/);
    await rejects(l.rewardAd("u2", "ad-1"), /already rewarded/);
  });

  it("the daily bonus follows a login streak: grows each day, caps at seven, restarts after a gap", async () => {
    let now = Date.parse("2026-09-22T12:00:00Z");
    const l = new MemoryLedger(() => new Date(now));
    const day = 24 * 60 * 60 * 1000;
    await l.ensureProfile("u1", "Zain", false);
    assert.deepStrictEqual(await l.dailyBonus("u1"), { claimedToday: false, streakDay: 1, coins: 200 });
    assert.strictEqual(await l.claimDailyBonus("u1"), 1200);
    assert.deepStrictEqual(await l.dailyBonus("u1"), { claimedToday: true, streakDay: 1, coins: 200 });
    await rejects(l.claimDailyBonus("u1"), /already claimed/);

    now += day; // day 2 pays 250
    assert.deepStrictEqual(await l.dailyBonus("u1"), { claimedToday: false, streakDay: 2, coins: 250 });
    assert.strictEqual(await l.claimDailyBonus("u1"), 1450);

    for (let d = 3; d <= 8; d++) { now += day; await l.claimDailyBonus("u1"); } // 300+350+400+450+500+500
    assert.strictEqual(await l.getBalance("u1"), 1450 + 2500);
    assert.deepStrictEqual(await l.dailyBonus("u1"), { claimedToday: true, streakDay: 8, coins: 500 });

    now += 2 * day; // missed a day: back to day 1
    assert.deepStrictEqual(await l.dailyBonus("u1"), { claimedToday: false, streakDay: 1, coins: 200 });
    assert.strictEqual(await l.claimDailyBonus("u1"), 3950 + 200);
  });

  it("charges entries once, refuses overdrafts, settles once", async () => {
    const l = new MemoryLedger();
    await l.ensureProfile("a", "A", true);
    await l.ensureProfile("b", "B", true);
    assert.strictEqual(await l.chargeTableEntry("a", "t1", 500), 500);
    assert.strictEqual(await l.chargeTableEntry("a", "t1", 500), 500, "idempotent");
    await rejects(l.chargeTableEntry("b", "t1", 2000), /not enough coins/);
    assert.strictEqual(await l.getBalance("b"), 1000);
    await rejects(l.chargeTableEntry("a", "t2", 750), /tier/);
    await l.chargeTableEntry("b", "t1", 500);
    const moves = [{ playerId: "a", amount: 950, kind: "table_reward" as const }];
    await l.settleTable("t1", moves);
    await l.settleTable("t1", moves);
    assert.strictEqual(await l.getBalance("a"), 1450);
    assert.strictEqual(await l.getBalance("b"), 500);
    await rejects(l.settleTable("t3", [{ playerId: "a", amount: -1, kind: "table_refund" }]), /positive/);
  });

  it("ledgerFromEnv: memory in development, Supabase when configured, refuses production without it", () => {
    assert.ok(ledgerFromEnv({}) instanceof MemoryLedger);
    assert.throws(() => ledgerFromEnv({ NODE_ENV: "production" }), /required in production/);
    const supa = ledgerFromEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
    assert.strictEqual(supa.constructor.name, "SupabaseLedger");
  });
});
