import { randomBytes } from "node:crypto";

/**
 * A secret only the server knows. A party launch passes it when it creates
 * a game room, so the room can trust options a phone must never set on its
 * own (for example a best-of-5 series on a public table).
 *
 * Set LAUNCH_SECRET in the hosting environment when the server runs as
 * several processes; otherwise each process makes its own at start-up.
 */
export const LAUNCH_SECRET: string = process.env.LAUNCH_SECRET || randomBytes(16).toString("hex");

export function isTrustedLaunch(options: { launchSecret?: unknown } | undefined): boolean {
  return typeof options?.launchSecret === "string" && options.launchSecret === LAUNCH_SECRET;
}
