import { createEndpoint } from "colyseus";
import { DAILY_BONUS_COINS, WALLET_ROUTES, type WalletSnapshot } from "@gamenite/game-rules";
import { authenticate, type PlayerAuth } from "./auth.js";
import { LedgerError, getLedger } from "./ledger.js";

/** Verify the bearer token the SDK attaches to every http call. */
async function playerFromHeader(header: string | null): Promise<PlayerAuth | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return await authenticate(token, {}, {} as never);
  } catch {
    return null;
  }
}

async function snapshot(player: PlayerAuth): Promise<WalletSnapshot> {
  const ledger = getLedger();
  const balance = await ledger.ensureProfile(player.userId, "", player.guest);
  return { balance, dailyBonusAvailable: !(await ledger.dailyBonusClaimed(player.userId)), dailyBonusCoins: DAILY_BONUS_COINS };
}

/**
 * Wallet endpoints, registered on the typed router so the SDK knows the paths.
 * Only the server ever moves coins; the phone just asks.
 */
export const walletEndpoints = {
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
