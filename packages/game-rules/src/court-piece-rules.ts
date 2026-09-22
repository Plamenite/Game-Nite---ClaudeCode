/**
 * Court Piece trick rules that every variant shares: which cards may be
 * played, and who wins a trick. Pure functions, no turn order.
 */
import type { Card, Suit } from './cards.js';
import { rankValue } from './court-piece.js';

export interface TrickCard {
  seat: number;
  card: Card;
}

/** Follow suit when you can; otherwise anything goes. */
export function legalPlays(hand: readonly Card[], ledSuit: Suit | null): Card[] {
  if (ledSuit === null) return hand.slice();
  const following = hand.filter((c) => c.suit === ledSuit);
  return following.length > 0 ? following : hand.slice();
}

export function canFollowSuit(hand: readonly Card[], ledSuit: Suit): boolean {
  return hand.some((c) => c.suit === ledSuit);
}

/**
 * The seat that wins a completed trick: highest trump if any trump was
 * played, otherwise the highest card of the suit that was led.
 */
export function trickWinner(plays: readonly TrickCard[], trump: Suit | null): number {
  if (plays.length === 0) throw new Error('trickWinner: empty trick');
  const ledSuit = plays[0].card.suit;
  const beats = (a: Card, b: Card | null): boolean => {
    if (b === null) return true;
    const aTrump = trump !== null && a.suit === trump;
    const bTrump = trump !== null && b.suit === trump;
    if (aTrump !== bTrump) return aTrump;
    if (a.suit !== b.suit) return a.suit === ledSuit; // only led suit or trump can win
    return rankValue(a) > rankValue(b);
  };
  let best: TrickCard | null = null;
  for (const play of plays) {
    if (beats(play.card, best?.card ?? null)) best = play;
  }
  return best!.seat;
}
