import { FRIEND_ROUTES, type FriendLists } from '@gamenite/game-rules';
import { useCallback, useState } from 'react';

import { getClient, withServer } from '@/lib/colyseus';

/**
 * My friends, requests in and out, and who is online. Read over HTTP with
 * the session token; every change returns the fresh lists.
 */
export function useFriends() {
  const [lists, setLists] = useState<FriendLists | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (work: (signal: AbortSignal) => Promise<{ data: unknown }>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await withServer(work);
      setLists(response.data as FriendLists);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(() => run((signal) => getClient().http.get(FRIEND_ROUTES.list, { signal })), [run]);
  const add = useCallback((code: string) => run((signal) => getClient().http.post(FRIEND_ROUTES.add, { body: { code }, signal })), [run]);
  const answer = useCallback((code: string, accept: boolean) => run((signal) => getClient().http.post(FRIEND_ROUTES.answer, { body: { code, accept }, signal })), [run]);
  const remove = useCallback((code: string) => run((signal) => getClient().http.post(FRIEND_ROUTES.remove, { body: { code }, signal })), [run]);

  return { lists, busy, error, refresh, add, answer, remove };
}
