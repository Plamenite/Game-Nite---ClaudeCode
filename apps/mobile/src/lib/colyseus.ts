import '@/lib/polyfills';
import { Client } from '@colyseus/sdk';

import { callWithTimeout } from '@/lib/server-call';
import { getServerUrl } from '@/lib/server-url';

let client: Client | null = null;

/**
 * One connection helper for the whole app. Lounge and table share it so a
 * seat reservation handed out by the lounge can be consumed by the table.
 * The session (src/lib/auth.ts) sets the token after sign-in.
 */
export function getClient(): Client {
  if (!client) {
    client = new Client(getServerUrl());
  }
  return client;
}

/** The bearer token sent on every room join and http call. */
export function setAuthToken(token: string | null) {
  getClient().auth.token = token ?? '';
}

/** How long any call to the game server may take before the app says so. */
export const SERVER_TIMEOUT_MS = 10_000;

/** The PC's address and port, e.g. "192.168.1.20:2567". */
export function serverAddress(): string {
  return getServerUrl().replace(/^wss?:\/\//, '');
}

export function unreachableMessage(): string {
  return `Can't reach the game server at ${serverAddress()}. On your PC, check that the "npm run server" window is still running, and that the phone is on the same Wi-Fi.`;
}

/**
 * Every game-server call goes through here: it never waits more than ten
 * seconds, and a server that cannot be reached gets a message saying what
 * to check. Pass `signal` on to http calls so they are cancelled too.
 */
export function withServer<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return callWithTimeout(work, { timeoutMs: SERVER_TIMEOUT_MS, unreachable: unreachableMessage() });
}
