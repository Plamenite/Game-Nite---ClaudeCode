import { matchMaker } from "colyseus";

/**
 * Who is online, and where. Rooms call enter/exit; the friends list asks
 * whereIs. State lives in Colyseus's presence store (memory on one process,
 * Redis when the server runs as several), with a time-to-live so a crashed
 * process never leaves ghosts behind; connected players are refreshed.
 */
export type Whereabouts = { status: "lounge"; loungeCode: string } | { status: "table" } | { status: "online" };

const TTL_SECONDS = 300;
const REFRESH_MS = 120_000;
const key = (userId: string) => `online:${userId}`;

/** Per process: userId -> the connections they hold ("lounge:CODE", "table"). */
const local = new Map<string, Set<string>>();

function summarize(tags: Set<string> | undefined): Whereabouts | null {
  if (!tags || tags.size === 0) return null;
  if (tags.has("table")) return { status: "table" };
  const lounge = [...tags].find((t) => t.startsWith("lounge:"));
  if (lounge) return { status: "lounge", loungeCode: lounge.slice("lounge:".length) };
  return { status: "online" };
}

async function write(userId: string) {
  const store = matchMaker.presence;
  if (!store) return;
  const where = summarize(local.get(userId));
  if (!where) {
    local.delete(userId);
    await store.del(key(userId));
  } else {
    await store.setex(key(userId), JSON.stringify(where), TTL_SECONDS);
  }
}

/** A player took a seat in a lounge ("lounge:CODE") or at a table ("table"). */
export function enter(userId: string, tag: string) {
  if (!userId) return;
  const tags = local.get(userId) ?? new Set<string>();
  tags.add(tag);
  local.set(userId, tags);
  void write(userId).catch(() => {});
}

export function exit(userId: string, tag: string) {
  if (!userId) return;
  local.get(userId)?.delete(tag);
  void write(userId).catch(() => {});
}

/** Where these players are right now; absent means offline. */
export async function whereIs(userIds: readonly string[]): Promise<Map<string, Whereabouts>> {
  const result = new Map<string, Whereabouts>();
  const store = matchMaker.presence;
  if (!store) return result;
  for (const userId of userIds) {
    const raw = await store.get(key(userId));
    if (typeof raw !== "string" || raw.length === 0) continue;
    try {
      result.set(userId, JSON.parse(raw) as Whereabouts);
    } catch {
      /* ignore a bad value */
    }
  }
  return result;
}

const heartbeat = setInterval(() => {
  for (const userId of local.keys()) void write(userId).catch(() => {});
}, REFRESH_MS);
heartbeat.unref?.();
