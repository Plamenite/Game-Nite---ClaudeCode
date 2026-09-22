import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Live, PUBLIC state of one Court Piece table, synced to every phone.
 * Hands are never here: each player receives their own cards privately.
 */
export const CourtPieceSeat = schema({
  name: t.string().default("Guest"),
  seat: t.uint8().default(0),
  team: t.uint8().default(0),
  handCount: t.uint8().default(0),
  timeouts: t.uint8().default(0),
  abandoned: t.boolean().default(false),
  connected: t.boolean().default(true),
  wantsRematch: t.boolean().default(false),
});
export type CourtPieceSeat = SchemaType<typeof CourtPieceSeat>;

export const TrickPlay = schema({
  seat: t.uint8().default(0),
  /** "rank-suit" */
  card: t.string().default(""),
});
export type TrickPlay = SchemaType<typeof TrickPlay>;

export const CourtPieceState = schema({
  /** "waiting" | "playing" | "between_deals" | "finished" */
  phase: t.string().default("waiting"),
  variant: t.string().default("single_siri"),
  bestOf: t.uint8().default(1),
  dealNumber: t.uint8().default(0),
  score0: t.uint8().default(0),
  score1: t.uint8().default(0),
  seriesWinner: t.int8().default(-1),

  /** "" until the first cut. */
  trump: t.string().default(""),
  trumpSetterSeat: t.int8().default(-1),
  leaderSeat: t.int8().default(-1),
  currentSeat: t.int8().default(-1),
  trick: t.array(TrickPlay),
  lastTrick: t.array(TrickPlay),
  tricksPlayed: t.uint8().default(0),
  collected0: t.uint8().default(0),
  collected1: t.uint8().default(0),
  heap: t.uint8().default(0),
  dealWinner: t.int8().default(-1),
  /** "" | "win" | "kot" | "goon_kot" | "forfeit" */
  dealResult: t.string().default(""),

  turnSessionId: t.string().default(""),
  turnDeadline: t.number().default(0),
  seats: t.map(CourtPieceSeat),
});
export type CourtPieceState = SchemaType<typeof CourtPieceState>;
