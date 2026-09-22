import { createEndpoint } from "colyseus";
import { FRIEND_ROUTES, normalizeLoungeCode, type FriendLists, type FriendSnapshot } from "@gamenite/game-rules";
import type { PlayerAuth } from "./auth.js";
import { bodySchema, playerFromHeader } from "./http-auth.js";
import { LedgerError, getLedger, type FriendEntry } from "./ledger.js";
import { whereIs } from "./presence.js";

/** The lists a phone shows, with each friend's whereabouts filled in. */
async function lists(player: PlayerAuth): Promise<FriendLists> {
  const ledger = getLedger();
  await ledger.ensureProfile(player.userId, player.name ?? "", player.guest);
  const pairs = await ledger.friendPairs(player.userId);
  const where = await whereIs(pairs.friends.map((f) => f.userId));
  const card = (f: FriendEntry) => ({ playerCode: f.playerCode, name: f.name });
  const friends: FriendSnapshot[] = pairs.friends.map((f) => {
    const w = where.get(f.userId);
    return { ...card(f), status: w?.status ?? "offline", ...(w?.status === "lounge" ? { loungeCode: w.loungeCode } : {}) };
  });
  return { friends, incoming: pairs.incoming.map(card), outgoing: pairs.outgoing.map(card) };
}

const codeBody = bodySchema((value) => {
  const code = normalizeLoungeCode((value as { code?: unknown } | null)?.code);
  return code ? { code } : "a player code is 8 letters or digits";
});

const answerBody = bodySchema((value) => {
  const v = value as { code?: unknown; accept?: unknown } | null;
  const code = normalizeLoungeCode(v?.code);
  if (!code) return "a player code is 8 letters or digits";
  if (typeof v?.accept !== "boolean") return "accept must be true or false";
  return { code, accept: v.accept };
});

type Ctx = { getHeader: (k: string) => string | null; error: (status: "UNAUTHORIZED" | "BAD_REQUEST", body: { message: string }) => unknown };

async function requirePlayer(ctx: Ctx): Promise<PlayerAuth> {
  const player = await playerFromHeader(ctx.getHeader("authorization"));
  if (!player) throw ctx.error("UNAUTHORIZED", { message: "sign in first" });
  return player;
}

async function friendByCode(ctx: Ctx, code: string): Promise<string> {
  const userId = await getLedger().userIdByCode(code);
  if (!userId) throw ctx.error("BAD_REQUEST", { message: "No player with that code." });
  return userId;
}

async function attempt<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LedgerError) throw ctx.error("BAD_REQUEST", { message: error.message });
    throw error;
  }
}

/** Friends endpoints on the typed router. Everything returns the fresh lists. */
export const friendEndpoints = {
  friends: createEndpoint(FRIEND_ROUTES.list, { method: "GET" }, async (ctx): Promise<FriendLists> => {
    return lists(await requirePlayer(ctx));
  }),

  addFriend: createEndpoint(FRIEND_ROUTES.add, { method: "POST", body: codeBody }, async (ctx): Promise<FriendLists> => {
    const player = await requirePlayer(ctx);
    const friendId = await friendByCode(ctx, ctx.body.code);
    await attempt(ctx, () => getLedger().requestFriend(player.userId, friendId));
    return lists(player);
  }),

  answerFriend: createEndpoint(FRIEND_ROUTES.answer, { method: "POST", body: answerBody }, async (ctx): Promise<FriendLists> => {
    const player = await requirePlayer(ctx);
    const friendId = await friendByCode(ctx, ctx.body.code);
    await attempt(ctx, () => getLedger().answerFriend(player.userId, friendId, ctx.body.accept));
    return lists(player);
  }),

  removeFriend: createEndpoint(FRIEND_ROUTES.remove, { method: "POST", body: codeBody }, async (ctx): Promise<FriendLists> => {
    const player = await requirePlayer(ctx);
    const friendId = await friendByCode(ctx, ctx.body.code);
    await attempt(ctx, () => getLedger().removeFriend(player.userId, friendId));
    return lists(player);
  }),
};
