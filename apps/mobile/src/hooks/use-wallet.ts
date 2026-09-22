import { DAILY_BONUS_COINS, WALLET_ROUTES, type WalletSnapshot } from '@gamenite/game-rules';
import { useCallback, useState } from 'react';

import { getClient } from '@/lib/colyseus';

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
      const response = await getClient().http.get(WALLET_ROUTES.wallet);
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
      const response = await getClient().http.post(WALLET_ROUTES.daily, {});
      setWallet(response.data as WalletSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { wallet, busy, error, refresh, claimDaily, dailyBonusCoins: DAILY_BONUS_COINS };
}
