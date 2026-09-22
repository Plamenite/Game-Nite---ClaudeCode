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

/** GET: who the server thinks I am, including the code that opens my lounge. */
export const ME_ROUTE = '/me';

export interface MeSnapshot {
  /** 8 letters and digits: friends add you with it, and it opens your lounge. */
  playerCode: string;
  guest: boolean;
  /** What other players see. Imported from the login account; guests get "Player 12345". POST /me { name } changes it. */
  name: string;
}
