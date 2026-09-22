/**
 * Five Row: facts about the five-in-a-row card-and-chip game that are fixed
 * by the physical game itself, plus the standard settings we start from.
 *
 * NAMING: the classic board game this resembles has a trademarked name.
 * That name must not appear anywhere in code, UI, or store copy. The
 * internal id is `fiverow`; the player-facing name lives in games.ts.
 */
import type { Card } from './cards.js';

export const FIVEROW_BOARD_SIZE = 10;

/** Chips in a straight line needed to complete one run. */
export const FIVEROW_RUN_LENGTH = 5;

/** Played with two standard decks and no jokers. */
export const FIVEROW_DECK_COUNT = 2;

/**
 * On standard card designs the Jack of Spades and Jack of Hearts show one
 * eye (profile view). Here they are "anti-wild": they remove an opponent's
 * chip that is not yet part of a completed run.
 */
export function isOneEyedJack(card: Card): boolean {
  return card.rank === 'J' && (card.suit === 'spades' || card.suit === 'hearts');
}

/**
 * The Jack of Diamonds and Jack of Clubs show two eyes. They are wild: they
 * place a chip on any free space.
 */
export function isTwoEyedJack(card: Card): boolean {
  return card.rank === 'J' && (card.suit === 'diamonds' || card.suit === 'clubs');
}

export function isJack(card: Card): boolean {
  return card.rank === 'J';
}

/**
 * STANDARD settings, used until the founder decides otherwise.
 * Hand size depends on how many people are at the table.
 */
export const FIVEROW_HAND_SIZE_BY_PLAYERS: Readonly<Record<number, number>> = {
  2: 7,
  3: 6,
  4: 6,
  6: 5,
  8: 4,
  9: 4,
  10: 3,
  12: 3,
};

export function fiverowHandSize(playerCount: number): number {
  const size = FIVEROW_HAND_SIZE_BY_PLAYERS[playerCount];
  if (size === undefined) {
    throw new RangeError(`Five Row is not played with ${playerCount} players`);
  }
  return size;
}

/** Standard: two teams race to two runs; three teams race to one. */
export function fiverowRunsToWin(teams: number): number {
  if (teams === 2) return 2;
  if (teams === 3) return 1;
  throw new RangeError(`Five Row is played with 2 or 3 teams, not ${teams}`);
}
