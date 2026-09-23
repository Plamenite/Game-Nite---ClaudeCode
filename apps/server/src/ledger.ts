import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AD_REWARD_COINS,
  MAX_AD_REWARDS_PER_DAY,
  STARTING_COINS,
  dailyBonusStatus,
  generateLoungeCode,
  isTableEntry,
  randomPlayerName,
  sanitizeDisplayName,
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
export interface FriendEntry {
  userId: string;
  playerCode: string;
  name: string;
}

export interface FriendPairs {
  friends: FriendEntry[];
  /** They asked me. */
  incoming: FriendEntry[];
  /** I asked them. */
  outgoing: FriendEntry[];
}

/** What sending a request did: asked, or a request both ways became a friendship, or nothing new. */
export type FriendRequestOutcome = "requested" | "accepted" | "already";

/**
 * The server's one door to the database: coins, profiles and friends.
 * Rooms and endpoints talk to this, never to the database directly.
 */
export interface Ledger {
  /** First sight of a player: profile plus starting coins, once. Returns the balance. */
  ensureProfile(userId: string, displayName: string, isGuest: boolean): Promise<number>;
  getBalance(userId: string): Promise<number>;
  /** The 8-character code friends add you with; it also opens your lounge. */
  playerCode(userId: string): Promise<string>;
  /** The name other players see. Set at first sight (login account, or "Player 12345"), changeable. */
  displayName(userId: string): Promise<string>;
  setDisplayName(userId: string, name: string): Promise<string>;
  /** Where today's login streak stands: claimed yet, which day, how many coins. */
  dailyBonus(userId: string): Promise<DailyBonusStatus>;
  /** Pays today's streak amount once per UTC day. Returns the balance. */
  claimDailyBonus(userId: string): Promise<number>;
  rewardAd(userId: string, adId: string): Promise<number>;
  /** Charges the entry; throws LedgerError('not enough coins') when unaffordable. Idempotent per table. */
  chargeTableEntry(userId: string, tableId: string, entry: number): Promise<number>;
  /** Records rewards and refunds computed by settleTable(). Idempotent per table. */
  settleTable(tableId: string, moves: readonly LedgerMove[]): Promise<void>;

  // ---- friends (DECIDED): add by code, the other side accepts, one row per pair.
  userIdByCode(code: string): Promise<string | null>;
  friendPairs(userId: string): Promise<FriendPairs>;
  requestFriend(userId: string, friendId: string): Promise<FriendRequestOutcome>;
  /** Accept or decline a request that came in; throws when there is none. */
  answerFriend(userId: string, friendId: string, accept: boolean): Promise<void>;
  /** Remove a friend, or withdraw a request. */
  removeFriend(userId: string, friendId: string): Promise<void>;
  areFriends(userId: string, otherId: string): Promise<boolean>;

  // ---- voice (DECIDED): the server meters minutes against a daily allowance.
  voiceSecondsToday(userId: string): Promise<number>;
  /** Adds to today's total and returns it. */
  addVoiceSeconds(userId: string, seconds: number): Promise<number>;
}

export class LedgerError extends Error {}

/** In-memory ledger with exactly the database's rules. Never for production. */
export class MemoryLedger implements Ledger {
  private balances = new Map<string, number>();
  private keys = new Set<string>();
  private adCounts = new Map<string, number>(); // `${user}:${day}` -> count
  private streaks = new Map<string, { lastClaimDay: string; streakDay: number }>();
  private codes = new Map<string, string>();
  private names = new Map<string, string>();
  /** One entry per pair, keyed by the two ids in sorted order. */
  private pairs = new Map<string, { requestedBy: string; accepted: boolean }>();
  private voice = new Map<string, number>(); // `${user}:${day}` -> seconds

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

  async ensureProfile(userId: string, displayName: string, _isGuest: boolean): Promise<number> {
    if (!this.names.has(userId)) this.names.set(userId, sanitizeDisplayName(displayName, 16, "") || randomPlayerName());
    this.apply(userId, STARTING_COINS, `start:${userId}`);
    return this.balances.get(userId) ?? 0;
  }

  async displayName(userId: string): Promise<string> {
    return this.names.get(userId) ?? randomPlayerName();
  }

  async setDisplayName(userId: string, name: string): Promise<string> {
    const clean = sanitizeDisplayName(name, 16, "");
    if (clean.length < 2) throw new LedgerError("a name needs at least 2 letters or digits");
    this.names.set(userId, clean);
    return clean;
  }

  async getBalance(userId: string): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  async playerCode(userId: string): Promise<string> {
    let code = this.codes.get(userId);
    if (!code) {
      do code = generateLoungeCode(); while ([...this.codes.values()].includes(code));
      this.codes.set(userId, code);
    }
    return code;
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

  async voiceSecondsToday(userId: string): Promise<number> {
    return this.voice.get(`${userId}:${this.today()}`) ?? 0;
  }

  async addVoiceSeconds(userId: string, seconds: number): Promise<number> {
    if (seconds < 0) throw new LedgerError("seconds must not be negative");
    const key = `${userId}:${this.today()}`;
    const total = (this.voice.get(key) ?? 0) + Math.round(seconds);
    this.voice.set(key, total);
    return total;
  }

  private pairKey(a: string, b: string) {
    return [a, b].sort().join("|");
  }

  async userIdByCode(code: string): Promise<string | null> {
    for (const [userId, c] of this.codes) if (c === code) return userId;
    return null;
  }

  async requestFriend(userId: string, friendId: string): Promise<FriendRequestOutcome> {
    if (userId === friendId) throw new LedgerError("that is your own code");
    const key = this.pairKey(userId, friendId);
    const existing = this.pairs.get(key);
    if (!existing) {
      this.pairs.set(key, { requestedBy: userId, accepted: false });
      return "requested";
    }
    if (existing.accepted) return "already";
    if (existing.requestedBy !== userId) {
      existing.accepted = true; // they had asked me: a request both ways is a yes
      return "accepted";
    }
    return "requested";
  }

  async answerFriend(userId: string, friendId: string, accept: boolean): Promise<void> {
    const key = this.pairKey(userId, friendId);
    const existing = this.pairs.get(key);
    if (!existing || existing.accepted || existing.requestedBy === userId) throw new LedgerError("no request from them");
    if (accept) existing.accepted = true;
    else this.pairs.delete(key);
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    this.pairs.delete(this.pairKey(userId, friendId));
  }

  async areFriends(userId: string, otherId: string): Promise<boolean> {
    return this.pairs.get(this.pairKey(userId, otherId))?.accepted === true;
  }

  async friendPairs(userId: string): Promise<FriendPairs> {
    const lists: FriendPairs = { friends: [], incoming: [], outgoing: [] };
    for (const [key, pair] of this.pairs) {
      const [a, b] = key.split("|");
      if (a !== userId && b !== userId) continue;
      const other = a === userId ? b : a;
      const entry: FriendEntry = { userId: other, playerCode: await this.playerCode(other), name: await this.displayName(other) };
      if (pair.accepted) lists.friends.push(entry);
      else if (pair.requestedBy === userId) lists.outgoing.push(entry);
      else lists.incoming.push(entry);
    }
    for (const list of [lists.friends, lists.incoming, lists.outgoing]) list.sort((x, y) => x.name.localeCompare(y.name));
    return lists;
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
  async playerCode(userId: string) {
    const { data, error } = await this.client.from("profiles").select("player_code").eq("id", userId).single();
    if (error) throw new LedgerError(error.message);
    return String(data.player_code);
  }
  async displayName(userId: string) {
    const { data, error } = await this.client.from("profiles").select("display_name").eq("id", userId).single();
    if (error) throw new LedgerError(error.message);
    return String(data.display_name);
  }
  setDisplayName(userId: string, name: string) {
    return this.rpc<string>("set_display_name", { p_user: userId, p_name: name }).then(String);
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

  async userIdByCode(code: string) {
    const { data, error } = await this.client.from("profiles").select("id").eq("player_code", code).maybeSingle();
    if (error) throw new LedgerError(error.message);
    return data ? String(data.id) : null;
  }
  async friendPairs(userId: string): Promise<FriendPairs> {
    type Row = { user_id: string; player_code: string; display_name: string };
    const raw = await this.rpc<{ friends: Row[]; incoming: Row[]; outgoing: Row[] }>("friend_lists", { p_user: userId });
    const entries = (rows: Row[] | null | undefined) => (rows ?? []).map((r) => ({ userId: r.user_id, playerCode: r.player_code, name: r.display_name }));
    return { friends: entries(raw?.friends), incoming: entries(raw?.incoming), outgoing: entries(raw?.outgoing) };
  }
  requestFriend(userId: string, friendId: string) {
    return this.rpc<FriendRequestOutcome>("request_friend", { p_user: userId, p_friend: friendId });
  }
  async answerFriend(userId: string, friendId: string, accept: boolean) {
    await this.rpc<void>("answer_friend", { p_user: userId, p_friend: friendId, p_accept: accept });
  }
  async removeFriend(userId: string, friendId: string) {
    await this.rpc<void>("remove_friend", { p_user: userId, p_friend: friendId });
  }
  areFriends(userId: string, otherId: string) {
    return this.rpc<boolean>("are_friends", { p_user: userId, p_other: otherId }).then(Boolean);
  }
  voiceSecondsToday(userId: string) {
    return this.rpc<number>("voice_seconds_today", { p_user: userId }).then(Number);
  }
  addVoiceSeconds(userId: string, seconds: number) {
    return this.rpc<number>("add_voice_seconds", { p_user: userId, p_seconds: Math.round(seconds) }).then(Number);
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
