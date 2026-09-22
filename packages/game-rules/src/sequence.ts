/**
 * Sequence: facts about the game that are fixed by the physical game itself.
 *
 * Full rules (board layout, legal moves, dead cards, win detection) are
 * NOT written yet. They will be specified with the founder first.
 */
import type { Card } from './cards.js';

export const SEQUENCE_BOARD_SIZE = 10;

/** Number of chips in a row needed to complete one sequence. */
export const SEQUENCE_LENGTH = 5;

/** Sequence is played with two standard decks and no jokers. */
export const SEQUENCE_DECK_COUNT = 2;

/**
 * On standard card designs the Jack of Spades and Jack of Hearts show one
 * eye (profile view). In Sequence these are "anti-wild": they remove an
 * opponent's chip.
 */
export function isOneEyedJack(card: Card): boolean {
  return card.rank === 'J' && (card.suit === 'spades' || card.suit === 'hearts');
}

/**
 * The Jack of Diamonds and Jack of Clubs show two eyes. In Sequence these
 * are wild: they place a chip on any free space.
 */
export function isTwoEyedJack(card: Card): boolean {
  return card.rank === 'J' && (card.suit === 'diamonds' || card.suit === 'clubs');
}
