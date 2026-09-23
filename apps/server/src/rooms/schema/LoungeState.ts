import { schema, t, type SchemaType } from "@colyseus/schema";

/** One friend in the lounge. */
export const LoungeMember = schema({
  name: t.string().default("Guest"),
  ready: t.boolean().default(false),
  /** 0 or 1. Alternates on join; the leader can change it. */
  team: t.uint8().default(0),
  /** Voice: their mic is on. */
  mic: t.boolean().default(false),
  /** Their player code: phones mute people for themselves by it. */
  playerCode: t.string().default(""),
});
export type LoungeMember = SchemaType<typeof LoungeMember>;

/** Someone at the door, waiting for a member to let them in. */
export const LoungeRequest = schema({
  name: t.string().default("Guest"),
});
export type LoungeRequest = SchemaType<typeof LoungeRequest>;

/**
 * Live state of a lounge: the PUBG-style room where friends gather before
 * a game and land back in afterwards. Synced to every phone in it.
 */
export const LoungeState = schema({
  /** The owner's player code, e.g. "K7PM3XAB". Friends knock with it. */
  code: t.string().default(""),

  /** sessionId of the only member allowed to start. */
  leaderSessionId: t.string().default(""),

  /** "open" | "starting" */
  status: t.string().default("open"),

  /** The leader's choice for the next game. */
  game: t.string().default("fiverow"),
  /** Seats at the chosen table: 2, 3 or 4. */
  players: t.uint8().default(2),
  variant: t.string().default("single_siri"),
  bestOf: t.uint8().default(1),
  /** Coins each player pays to sit; 0 = practice. */
  entry: t.uint32().default(0),

  members: t.map(LoungeMember),
  requests: t.map(LoungeRequest),
});
export type LoungeState = SchemaType<typeof LoungeState>;
