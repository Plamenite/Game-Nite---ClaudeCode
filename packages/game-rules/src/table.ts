/**
 * The contract between the phone app and the game server for a "table"
 * (one room where a game is played). Both sides import these names so a
 * typo on one side becomes a compile error, not a silent bug.
 *
 * This is the WALKING SKELETON table: it only passes a turn around and
 * counts taps. Real game state replaces it once the rules are specified.
 */

/** Room names registered on the server. */
export const ROOMS = {
  table: 'table',
  party: 'party',
} as const;

/** Messages the phone can send to a table room. */
export const TABLE_MESSAGES = {
  play: 'play',
} as const;

/** Placeholder seat count for the skeleton. Real games take it from GameInfo. */
export const SKELETON_TABLE_SEATS = 2;

/** Plain data describing one player at the table, safe to render in React. */
export interface TablePlayerSnapshot {
  sessionId: string;
  name: string;
  score: number;
}

/** Plain data describing the whole table, safe to render in React. */
export interface TableSnapshot {
  players: TablePlayerSnapshot[];
  currentTurn: string;
  turnCount: number;
  turnDeadline: number;
}

/**
 * The minimal shape of the server's live state object that we read from.
 * Colyseus gives us a special synced object; this describes just enough of
 * it for `toTableSnapshot` to work, without importing server code.
 */
export interface TableStateLike {
  players: {
    forEach(cb: (player: { name: string; score: number }, sessionId: string) => void): void;
  };
  currentTurn: string;
  turnCount: number;
  turnDeadline: number;
}

/** Copy the live synced state into plain data. Order: by join order (map order). */
export function toTableSnapshot(state: TableStateLike): TableSnapshot {
  const players: TablePlayerSnapshot[] = [];
  state.players.forEach((player, sessionId) => {
    players.push({ sessionId, name: player.name, score: player.score });
  });
  return {
    players,
    currentTurn: state.currentTurn,
    turnCount: state.turnCount,
    turnDeadline: state.turnDeadline,
  };
}

/** Keep display names short and printable. Empty input becomes "Guest". */
export function sanitizeDisplayName(input: unknown, maxLength = 16): string {
  const text = typeof input === 'string' ? input : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : 'Guest';
}
