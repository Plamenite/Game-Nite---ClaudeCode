/**
 * Coin economy rules (FOUNDER, 2026-09-22). Coins are in-app only: never
 * cashed out, never transferred between players, never exchanged for
 * anything of real-world value. This is a casual social game.
 *
 * The arithmetic here is pure and shared, so the server settles tables
 * exactly the way the phone predicts.
 */

export const STARTING_COINS = 1000;
export const DAILY_BONUS_COINS = 200;
export const AD_REWARD_COINS = 100;
export const MAX_AD_REWARDS_PER_DAY = 5;

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
