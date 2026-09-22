import { createEndpoint } from "colyseus";
import { ME_ROUTE, WALLET_ROUTES, type MeSnapshot, type WalletSnapshot } from "@gamenite/game-rules";
import type { PlayerAuth } from "./auth.js";
import { bodySchema, playerFromHeader } from "./http-auth.js";
import { LedgerError, getLedger } from "./ledger.js";

async function snapshot(player: PlayerAuth): Promise<WalletSnapshot> {
  const ledger = getLedger();
  const balance = await ledger.ensureProfile(player.userId, "", player.guest);
  const daily = await ledger.dailyBonus(player.userId);
  return { balance, dailyBonusAvailable: !daily.claimedToday, dailyBonusCoins: daily.coins, streakDay: daily.streakDay };
}

/**
 * Wallet endpoints, registered on the typed router so the SDK knows the paths.
 * Only the server ever moves coins; the phone just asks.
 */
async function me(player: PlayerAuth): Promise<MeSnapshot> {
  const ledger = getLedger();
  // First sight: the name comes from the login account, or becomes "Player 12345".
  await ledger.ensureProfile(player.userId, player.name ?? "", player.guest);
  return { playerCode: await ledger.playerCode(player.userId), guest: player.guest, name: await ledger.displayName(player.userId) };
}

/** POST /me body: { name: string }. */
const nameBody = bodySchema((value) => {
  const name = (value as { name?: unknown } | null)?.name;
  return typeof name === "string" ? { name } : "name must be text";
});

export const walletEndpoints = {
  /** GET /me: my player code (which opens my lounge), whether I am a guest, and my name. */
  me: createEndpoint(ME_ROUTE, { method: "GET" }, async (ctx): Promise<MeSnapshot> => {
    const player = await playerFromHeader(ctx.getHeader("authorization"));
    if (!player) throw ctx.error("UNAUTHORIZED", { message: "sign in first" });
    return me(player);
  }),

  /** POST /me { name }: change my display name (2 to 16 printable characters). */
  setName: createEndpoint(ME_ROUTE, { method: "POST", body: nameBody }, async (ctx): Promise<MeSnapshot> => {
    const player = await playerFromHeader(ctx.getHeader("authorization"));
    if (!player) throw ctx.error("UNAUTHORIZED", { message: "sign in first" });
    await me(player);
    try {
      await getLedger().setDisplayName(player.userId, ctx.body.name);
    } catch (error) {
      if (error instanceof LedgerError) throw ctx.error("BAD_REQUEST", { message: error.message });
      throw error;
    }
    return me(player);
  }),

  /** GET /wallet: balance and whether today's bonus is still available. */
  wallet: createEndpoint(WALLET_ROUTES.wallet, { method: "GET" }, async (ctx) => {
    const player = await playerFromHeader(ctx.getHeader("authorization"));
    if (!player) throw ctx.error("UNAUTHORIZED", { message: "sign in first" });
    return snapshot(player);
  }),

  /** POST /wallet/daily: claim today's bonus; 409 with the wallet if already claimed. */
  daily: createEndpoint(WALLET_ROUTES.daily, { method: "POST" }, async (ctx) => {
    const player = await playerFromHeader(ctx.getHeader("authorization"));
    if (!player) throw ctx.error("UNAUTHORIZED", { message: "sign in first" });
    try {
      await getLedger().ensureProfile(player.userId, "", player.guest);
      await getLedger().claimDailyBonus(player.userId);
    } catch (error) {
      if (error instanceof LedgerError) throw ctx.error("CONFLICT", { message: error.message, ...(await snapshot(player)) });
      throw error;
    }
    return snapshot(player);
  }),
};
