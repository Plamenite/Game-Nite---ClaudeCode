import { Client } from '@colyseus/sdk';

import { guest } from '@/lib/guest';
import { getServerUrl } from '@/lib/server-url';

let client: Client | null = null;

/**
 * One connection helper for the whole app. Party and table share it so a
 * seat reservation handed out by the party can be consumed by the table.
 */
export function getClient(): Client {
  if (!client) {
    client = new Client(getServerUrl());
    client.auth.token = guest.token; // TODO(supabase): real session token
  }
  return client;
}
