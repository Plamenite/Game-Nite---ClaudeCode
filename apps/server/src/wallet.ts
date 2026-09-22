import { createEndpoint } from "colyseus";
import { ME_ROUTE, WALLET_ROUTES, type MeSnapshot, type WalletSnapshot } from "@gamenite/game-rules";
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

/** POST /me body: { name: string }. A tiny validator in the router's "standard schema" shape. */
type NameBody = { name: string };
const nameBody = {
  "~standard": {
    version: 1 as const,
    vendor: "gamenite",
    validate: (value: unknown): { value: NameBody } | { issues: { message: string }[] } => {
      const name = (value as { name?: unknown } | null)?.name;
      return typeof name === "string" ? { value: { name } } : { issues: [{ message: "name must be text" }] };
    },
    /** Type-only: what the validator accepts and produces. */
    types: undefined as unknown as { input: unknown; output: NameBody },
  },
};

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
