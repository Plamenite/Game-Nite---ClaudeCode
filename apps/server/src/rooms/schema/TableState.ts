import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Live state of one table, synced to every phone at the table.
 *
 * WALKING SKELETON: this only tracks who is seated, whose turn it is, and
 * a tap counter. Real game state (board, hands, tricks) replaces it once
 * the rules are specified with the founder. Anything secret (a player's
 * hand) must NEVER live in this shared state; it goes in per-client views.
 */
export const Player = schema({
  name: t.string().default("Guest"),
  score: t.uint16().default(0),
});
export type Player = SchemaType<typeof Player>;

export const TableState = schema({
  players: t.map(Player),

  /** sessionId of whoever may act right now; empty before the match starts. */
  currentTurn: t.string().default(""),

  /** Room-clock time (ms) the current turn expires at. */
  turnDeadline: t.number().default(0),

  turnCount: t.uint16().default(0),
});
export type TableState = SchemaType<typeof TableState>;
