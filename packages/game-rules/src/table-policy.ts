/**
 * Table policy shared by every game (FOUNDER, 2026-09-22).
 */

/** Seconds a player gets per turn. */
export const TURN_SECONDS = 30;

/**
 * When the timer runs out the server plays a random legal move for the
 * player. After this many timeouts IN A ROW the seat counts as abandoned:
 * it is auto-played instantly from then on.
 */
export const TIMEOUTS_TO_ABANDON = 3;

/** Small pause before an abandoned seat's automatic move, so others can follow. */
export const ABANDONED_MOVE_DELAY_MS = 700;

/** Pause between deals of a series so everyone can read the result. */
export const BETWEEN_DEALS_MS = 5000;
