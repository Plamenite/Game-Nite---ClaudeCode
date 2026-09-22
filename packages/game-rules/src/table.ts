/**
 * Room names registered on the server. Both the app and the server import
 * these so a typo on one side becomes a compile error, not a silent bug.
 */
export const ROOMS = {
  party: 'party',
  fiverow: 'fiverow',
  courtpiece: 'courtpiece',
} as const;

/** Keep display names short and printable. Empty input becomes "Guest". */
export function sanitizeDisplayName(input: unknown, maxLength = 16): string {
  const text = typeof input === 'string' ? input : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : 'Guest';
}
