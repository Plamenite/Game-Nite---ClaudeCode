/**
 * Coin economy rules (FOUNDER, 2026-09-22). Coins are in-app only: never
 * cashed out, never transferred between players, never exchanged for
 * anything of real-world value. This is a casual social game.
 *
 * The arithmetic here is pure and shared, so the server settles tables
 * exactly the way the phone predicts.
 */

export const STARTING_COINS = 1000;
/** Day 1 of a login streak. */
export const DAILY_BONUS_COINS = 200;
/** Each consecutive day adds this much, up to DAILY_STREAK_MAX_DAY. */
export const DAILY_STREAK_STEP_COINS = 50;
/** From this day on the bonus stays at its maximum (500). */
export const DAILY_STREAK_MAX_DAY = 7;
export const AD_REWARD_COINS = 100;
export const MAX_AD_REWARDS_PER_DAY = 5;

/**
 * What the daily bonus pays on day `day` of a streak: 200, 250, ... 500,
 * then 500 for as long as the streak lasts. Missing a day restarts at day 1.
 */
export function dailyBonusForDay(day: number): number {
  const capped = Math.min(Math.max(Math.floor(day), 1), DAILY_STREAK_MAX_DAY);
  return DAILY_BONUS_COINS + DAILY_STREAK_STEP_COINS * (capped - 1);
}

/** Calendar day in UTC as YYYY-MM-DD. Streaks count UTC days, like the ledger. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC day before a YYYY-MM-DD day. */
export function previousUtcDay(day: string): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - 24 * 60 * 60 * 1000));
}

export interface DailyBonusStatus {
  /** Already claimed today, so the button waits for tomorrow. */
  claimedToday: boolean;
  /** Day number of today's claim: continues yesterday's streak or restarts at 1. */
  streakDay: number;
  /** What today's claim pays (or paid). */
  coins: number;
}

/**
 * Where a player's streak stands today, given their last claim. Pure, so
 * the server, the database rules and the phone all agree.
 */
export function dailyBonusStatus(lastClaimDay: string | null, lastStreakDay: number, today: string = utcDay()): DailyBonusStatus {
  if (lastClaimDay === today) {
    const streakDay = Math.max(lastStreakDay, 1);
    return { claimedToday: true, streakDay, coins: dailyBonusForDay(streakDay) };
  }
  const streakDay = lastClaimDay === previousUtcDay(today) ? Math.max(lastStreakDay, 0) + 1 : 1;
  return { claimedToday: false, streakDay, coins: dailyBonusForDay(streakDay) };
}

/** Table entry tiers. 0 is free practice: nothing is charged or awarded. */
export const TABLE_ENTRY_TIERS = [0, 500, 2000, 10000] as const;
export type TableEntry = (typeof TABLE_ENTRY_TIERS)[number];

/** Share of the losing side's entries kept by the table, out of 100. Keeps coins flowing out. */
export const TABLE_FEE_PERCENT = 10;

export function isTableEntry(value: unknown): value is TableEntry {
  return (TABLE_ENTRY_TIERS as readonly number[]).includes(Number(value));
}

/** Kinds of coin movement. Every one is a row in the ledger. */
export type LedgerKind =
  | 'starting_bonus'
  | 'daily_bonus'
  | 'ad_reward'
  | 'table_entry'
  | 'table_reward'
  | 'table_refund'
  | 'purchase'
  | 'adjustment';

export interface SeatOutcome {
  playerId: string;
  team: number;
}

export interface LedgerMove {
  playerId: string;
  /** Positive credit, negative debit. */
  amount: number;
  kind: Extract<LedgerKind, 'table_reward' | 'table_refund'>;
}

export interface Settlement {
  /** Total taken from the losing side. */
  pot: number;
  /** Coins removed from the economy by the table. */
  fee: number;
  /** What each winner receives on top of their own entry back. */
  sharePerWinner: number;
  moves: LedgerMove[];
}

/**
 * Settle a finished table. Every seat was charged `entry` when it sat
 * down. Winners get their entry back plus an equal share of the losing
 * side's entries minus the table fee; rounding leftovers go to the fee.
 * A draw (no winner) refunds everyone. Free practice moves nothing.
 */
export function settleTable(entry: number, seats: readonly SeatOutcome[], winnerTeam: number | null): Settlement {
  if (!isTableEntry(entry)) throw new RangeError(`not a table entry tier: ${entry}`);
  if (entry === 0 || seats.length === 0) return { pot: 0, fee: 0, sharePerWinner: 0, moves: [] };

  if (winnerTeam === null) {
    return {
      pot: 0,
      fee: 0,
      sharePerWinner: 0,
      moves: seats.map((s) => ({ playerId: s.playerId, amount: entry, kind: 'table_refund' as const })),
    };
  }

  const winners = seats.filter((s) => s.team === winnerTeam);
  const losers = seats.filter((s) => s.team !== winnerTeam);
  if (winners.length === 0) throw new RangeError('winning team has no seats');

  const pot = entry * losers.length;
  let fee = Math.floor((pot * TABLE_FEE_PERCENT) / 100);
  const sharePerWinner = Math.floor((pot - fee) / winners.length);
  fee = pot - sharePerWinner * winners.length; // rounding leftovers leave the economy too

  return {
    pot,
    fee,
    sharePerWinner,
    moves: winners.map((w) => ({ playerId: w.playerId, amount: entry + sharePerWinner, kind: 'table_reward' as const })),
  };
}

/** Net change for one player over a whole table: entry charged, then whatever came back. */
export function netForPlayer(entry: number, settlement: Settlement, playerId: string): number {
  const back = settlement.moves.filter((m) => m.playerId === playerId).reduce((sum, m) => sum + m.amount, 0);
  return back - (entry === 0 ? 0 : entry);
}
