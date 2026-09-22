import { Client } from '@colyseus/sdk';

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
