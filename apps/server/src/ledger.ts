import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AD_REWARD_COINS,
  MAX_AD_REWARDS_PER_DAY,
  STARTING_COINS,
  dailyBonusStatus,
  isTableEntry,
  utcDay,
  type DailyBonusStatus,
  type LedgerMove,
} from "@gamenite/game-rules";

/**
 * The only door through which coins move. Rooms talk to this, never to
 * the database directly. Two implementations:
 *   - MemoryLedger: development and tests, no database, same rules.
 *   - SupabaseLedger: production, calls the SQL functions from
 *     supabase/migrations/*_economy.sql with the service role key.
 */
export interface Ledger {
  /** First sight of a player: profile plus starting coins, once. Returns the balance. */
  ensureProfile(userId: string, displayName: string, isGuest: boolean): Promise<number>;
  getBalance(userId: string): Promise<number>;
  /** Where today's login streak stands: claimed yet, which day, how many coins. */
  dailyBonus(userId: string): Promise<DailyBonusStatus>;
  /** Pays today's streak amount once per UTC day. Returns the balance. */
  claimDailyBonus(userId: string): Promise<number>;
  rewardAd(userId: string, adId: string): Promise<number>;
  /** Charges the entry; throws LedgerError('not enough coins') when unaffordable. Idempotent per table. */
  chargeTableEntry(userId: string, tableId: string, entry: number): Promise<number>;
  /** Records rewards and refunds computed by settleTable(). Idempotent per table. */
  settleTable(tableId: string, moves: readonly LedgerMove[]): Promise<void>;
}

export class LedgerError extends Error {}

/** In-memory ledger with exactly the database's rules. Never for production. */
export class MemoryLedger implements Ledger {
  private balances = new Map<string, number>();
  private keys = new Set<string>();
  private adCounts = new Map<string, number>(); // `${user}:${day}` -> count
  private streaks = new Map<string, { lastClaimDay: string; streakDay: number }>();

  /** Tests pass a clock to walk through days. */
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private today() {
    return utcDay(this.clock());
  }

  private apply(userId: string, amount: number, key: string): boolean {
    if (this.keys.has(key)) return false;
    const next = (this.balances.get(userId) ?? 0) + amount;
    if (next < 0) throw new LedgerError("not enough coins for this table");
    this.keys.add(key);
    this.balances.set(userId, next);
    return true;
  }

  async ensureProfile(userId: string, _displayName: string, _isGuest: boolean): Promise<number> {
    this.apply(userId, STARTING_COINS, `start:${userId}`);
    return this.balances.get(userId) ?? 0;
  }

  async getBalance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  async dailyBonus(userId: string): Promise<DailyBonusStatus> {
    const last = this.streaks.get(userId);
    return dailyBonusStatus(last?.lastClaimDay ?? null, last?.streakDay ?? 0, this.today());
  }

  async claimDailyBonus(userId: string): Promise<number> {
    const today = this.today();
    const status = await this.dailyBonus(userId);
    if (status.claimedToday || !this.apply(userId, status.coins, `daily:${userId}:${today}`)) {
      throw new LedgerError("daily bonus already claimed today");
    }
    this.streaks.set(userId, { lastClaimDay: today, streakDay: status.streakDay });
    return this.balances.get(userId)!;
  }

  async rewardAd(userId: string, adId: string): Promise<number> {
    const dayKey = `${userId}:${this.today()}`;
    if ((this.adCounts.get(dayKey) ?? 0) >= MAX_AD_REWARDS_PER_DAY) throw new LedgerError("daily ad reward limit reached");
    if (!this.apply(userId, AD_REWARD_COINS, `ad:${adId}`)) throw new LedgerError("this ad was already rewarded");
    this.adCounts.set(dayKey, (this.adCounts.get(dayKey) ?? 0) + 1);
    return this.balances.get(userId)!;
  }

  async chargeTableEntry(userId: string, tableId: string, entry: number): Promise<number> {
    if (!isTableEntry(entry) || entry === 0) throw new LedgerError(`not a table entry tier: ${entry}`);
    this.apply(userId, -entry, `entry:${tableId}:${userId}`);
    return this.balances.get(userId)!;
  }

  async settleTable(tableId: string, moves: readonly LedgerMove[]): Promise<void> {
    for (const m of moves) {
      if (m.amount <= 0) throw new LedgerError("settlement amounts must be positive");
      this.apply(m.playerId, m.amount, `${m.kind}:${tableId}:${m.playerId}`);
    }
  }
}

/** Production ledger: every call is one SQL function in Supabase. */
export class SupabaseLedger implements Ledger {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new LedgerError(error.message);
    return data as T;
  }

  ensureProfile(userId: string, displayName: string, isGuest: boolean) {
    return this.rpc<number>("ensure_profile", { p_user: userId, p_display_name: displayName, p_is_guest: isGuest }).then(Number);
  }
  getBalance(userId: string) {
    return this.rpc<number>("get_balance", { p_user: userId }).then(Number);
  }
  dailyBonus(userId: string) {
    return this.rpc<{ claimed_today: boolean; streak_day: number; coins: number }>("daily_bonus_status", { p_user: userId }).then((s) => ({
      claimedToday: Boolean(s.claimed_today),
      streakDay: Number(s.streak_day),
      coins: Number(s.coins),
    }));
  }
  claimDailyBonus(userId: string) {
    return this.rpc<number>("claim_daily_bonus", { p_user: userId }).then(Number);
  }
  rewardAd(userId: string, adId: string) {
    return this.rpc<number>("reward_ad", { p_user: userId, p_ad_id: adId }).then(Number);
  }
  chargeTableEntry(userId: string, tableId: string, entry: number) {
    return this.rpc<number>("charge_table_entry", { p_user: userId, p_table: tableId, p_entry: entry }).then(Number);
  }
  async settleTable(tableId: string, moves: readonly LedgerMove[]) {
    await this.rpc<void>("settle_table", {
      p_table: tableId,
      p_moves: moves.map((m) => ({ user_id: m.playerId, amount: m.amount, kind: m.kind })),
    });
  }
}

/**
 * Pick the ledger from the environment. Production must have Supabase;
 * development falls back to memory so guests can play without a database.
 */
export function ledgerFromEnv(env: NodeJS.ProcessEnv = process.env): Ledger {
  const url = env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return new SupabaseLedger(url, key);
  if (env.NODE_ENV === "production") {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production");
  }
  return new MemoryLedger();
}

let shared: Ledger | null = null;

/** The server's one ledger, created on first use (after env files are loaded). */
export function getLedger(): Ledger {
  return shared ?? (shared = ledgerFromEnv());
}

/** Tests can swap the ledger. */
export function setLedger(ledger: Ledger | null) {
  shared = ledger;
}
