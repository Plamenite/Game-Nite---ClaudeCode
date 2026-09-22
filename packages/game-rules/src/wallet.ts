/**
 * The wallet is read over HTTP, not through a room. The SDK sends the
 * player's token as a bearer header on every http call, and the server
 * verifies it the same way rooms do.
 */
export const WALLET_ROUTES = {
  /** GET: the caller's balance and whether today's bonus is still available. */
  wallet: '/wallet',
  /** POST: claim today's daily bonus. */
  daily: '/wallet/daily',
} as const;

export interface WalletSnapshot {
  balance: number;
  dailyBonusAvailable: boolean;
  /** What today's daily bonus pays (or paid), for the button label. */
  dailyBonusCoins: number;
  /** Day number of today's login streak; grows every consecutive day, restarts when one is missed. */
  streakDay: number;
}
