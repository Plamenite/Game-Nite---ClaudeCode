import { sanitizeDisplayName } from "@gamenite/game-rules";
import type { PlayerAuth } from "../auth.js";
import { getLedger } from "../ledger.js";

/**
 * The name a player wears at a table or in a lounge.
 *
 * First sight of a player creates their profile: the name comes from the
 * phone if it sent one, else from the login account (token claims), else
 * the server invents "Player 12345". After that, a phone may send the name
 * it shows (it is the player's own, changeable in the You tab); when it
 * sends none, the profile's name is used.
 */
export async function resolveName(auth: PlayerAuth, sent: unknown): Promise<string> {
  const fromPhone = typeof sent === "string" && sent.trim().length > 0 ? sanitizeDisplayName(sent) : "";
  await getLedger().ensureProfile(auth.userId, fromPhone || auth.name || "", auth.guest);
  return fromPhone || getLedger().displayName(auth.userId);
}
