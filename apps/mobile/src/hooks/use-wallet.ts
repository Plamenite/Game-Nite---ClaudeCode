import { WALLET_ROUTES, dailyBonusForDay, type WalletSnapshot } from '@gamenite/game-rules';
import { useCallback, useState } from 'react';

import { getClient, withServer } from '@/lib/colyseus';

/**
 * My coins, read over HTTP with the same token the tables use. The server
 * is the only one who can change the balance; this hook only asks.
 */
export function useWallet() {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await withServer((signal) => getClient().http.get(WALLET_ROUTES.wallet, { signal }));
      setWallet(response.data as WalletSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const claimDaily = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await withServer((signal) => getClient().http.post(WALLET_ROUTES.daily, { signal }));
      setWallet(response.data as WalletSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // What tomorrow pays if the streak continues, for the "come back" line.
  const tomorrowCoins = dailyBonusForDay((wallet?.streakDay ?? 0) + 1);

  return { wallet, busy, error, refresh, claimDaily, tomorrowCoins };
}
