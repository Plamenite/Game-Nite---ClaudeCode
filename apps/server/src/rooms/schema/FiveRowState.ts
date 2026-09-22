import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Live, PUBLIC state of one Five Row table, synced to every phone.
 * Hands are never here: each player receives their own cards privately.
 */
export const FiveRowSeat = schema({
  name: t.string().default("Guest"),
  team: t.uint8().default(0),
  handCount: t.uint8().default(0),
  /** Consecutive timeouts; a real move resets it. */
  timeouts: t.uint8().default(0),
  abandoned: t.boolean().default(false),
  connected: t.boolean().default(true),
});
export type FiveRowSeat = SchemaType<typeof FiveRowSeat>;

export const FiveRowRun = schema({
  team: t.uint8().default(0),
  cells: t.array("uint8"),
});
export type FiveRowRun = SchemaType<typeof FiveRowRun>;

export const FiveRowState = schema({
  /** "waiting" | "playing" | "finished" */
  phase: t.string().default("waiting"),
  players: t.uint8().default(2),
  teams: t.uint8().default(2),
  /** Coins each seat paid; 0 for practice. */
  entry: t.uint32().default(0),

  /** 100 cells: team index, or -1 for no chip. */
  chips: t.array("int8"),
  locked: t.array("boolean"),
  runs: t.array(FiveRowRun),

  seats: t.map(FiveRowSeat),

  turnSessionId: t.string().default(""),
  /** Room-clock time (ms) the current turn expires at. */
  turnDeadline: t.number().default(0),
  exchangedThisTurn: t.boolean().default(false),
  winnerTeam: t.int8().default(-1),
  drawPileCount: t.uint8().default(0),
});
export type FiveRowState = SchemaType<typeof FiveRowState>;
