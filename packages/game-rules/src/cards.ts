/**
 * Playing-card primitives shared by every Gamenite game.
 *
 * Nothing in this file decides how a game is played. It only describes
 * what a card is and how to build and shuffle a deck.
 */

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** Stable text id such as "J♠" is nice for humans; "J-spades" is safer in code and JSON. */
export function cardId(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

/** One standard 52-card deck, no jokers, in a fixed order (unshuffled). */
export function createStandardDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** Several standard decks combined. Five Row, for example, plays with two. */
export function createDecks(count: number): Card[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`createDecks: count must be a positive integer, got ${count}`);
  }
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    cards.push(...createStandardDeck());
  }
  return cards;
}

/** A function returning a number in [0, 1). Math.random has this shape. */
export type RandomSource = () => number;

/**
 * Fisher-Yates shuffle. Returns a NEW array; the input is not changed.
 *
 * SECURITY NOTE: the game server must pass a cryptographically secure
 * random source when dealing real hands. Math.random is fine for tests
 * and for purely visual effects on the phone.
 */
export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
