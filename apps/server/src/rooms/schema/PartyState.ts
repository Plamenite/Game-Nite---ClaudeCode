import { schema, t, type SchemaType } from "@colyseus/schema";

/** One friend in the party. */
export const PartyMember = schema({
  name: t.string().default("Guest"),
  ready: t.boolean().default(false),
  /** 0 or 1. Alternates on join; the leader can change it. */
  team: t.uint8().default(0),
});
export type PartyMember = SchemaType<typeof PartyMember>;

/**
 * Live state of a party: the PUBG-style room where friends gather before
 * a game. Synced to every member's phone.
 */
export const PartyState = schema({
  /** Short code friends type to join, e.g. "K7PM3X". */
  code: t.string().default(""),

  /** sessionId of the only member allowed to launch. */
  leaderSessionId: t.string().default(""),

  /** "open" | "launching" | "launched" */
  status: t.string().default("open"),

  /** The leader's choice for the next game. */
  game: t.string().default("fiverow"),
  variant: t.string().default("single_siri"),
  bestOf: t.uint8().default(1),
  /** Coins each player pays to sit; 0 = practice. */
  entry: t.uint32().default(0),

  members: t.map(PartyMember),
});
export type PartyState = SchemaType<typeof PartyState>;
