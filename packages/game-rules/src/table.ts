/**
 * Room names registered on the server. Both the app and the server import
 * these so a typo on one side becomes a compile error, not a silent bug.
 */
export const ROOMS = {
  lounge: 'lounge',
  fiverow: 'fiverow',
  courtpiece: 'courtpiece',
} as const;

/** Keep display names short and printable. Empty input becomes the fallback ("Guest"). */
export function sanitizeDisplayName(input: unknown, maxLength = 16, fallback = 'Guest'): string {
  const text = typeof input === 'string' ? input : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** DECIDED: a guest (or an account with no name) starts as "Player 12345". */
export function randomPlayerName(random: () => number = Math.random): string {
  return `Player ${String(Math.floor(random() * 100000)).padStart(5, '0')}`;
}
