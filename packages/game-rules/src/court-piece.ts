/**
 * Court Piece (Rang): facts fixed by tradition, plus the variant settings
 * the founder's tables use. Full rules live in court-piece-rules.ts and
 * court-piece-match.ts.
 */
import type { Card, Rank, Suit } from './cards.js';

export const COURT_PIECE_PLAYERS = 4;
export const COURT_PIECE_TEAMS = 2;

/** One standard deck, 52 cards, dealt fully: 13 cards each. */
export const COURT_PIECE_DECK_COUNT = 1;
export const COURT_PIECE_HAND_SIZE = 13;

/** Tricks a team must collect to win a deal. The deal still runs to 13. */
export const COURT_PIECE_TRICKS_TO_WIN = 7;
export const COURT_PIECE_TOTAL_TRICKS = 13;

/**
 * FOUNDER'S RULES (2026-09-22): nobody calls trump. All 13 cards are dealt
 * and the deal starts with no trump. The first time any player cannot
 * follow suit, the card they play sets the trump for the rest of the deal,
 * and their team becomes the "trump-calling" team for kot purposes.
 */
export type DealResult =
  /** A team collected 7 or more, but not all 13. */
  | 'win'
  /** All 13 tricks by the team that set the trump. */
  | 'kot'
  /** All 13 tricks by the team that did NOT set the trump. */
  | 'goon_kot';

export function classifyDeal(collected: readonly [number, number], trumpSetterTeam: number | null): { winner: number; result: DealResult } {
  const winner = collected[0] > collected[1] ? 0 : 1;
  if (collected[winner] < COURT_PIECE_TOTAL_TRICKS) return { winner, result: 'win' };
  // CONFIRM: a deal where nobody ever cut (no trump) and one team took all 13 counts as a kot.
  if (trumpSetterTeam === null || trumpSetterTeam === winner) return { winner, result: 'kot' };
  return { winner, result: 'goon_kot' };
}

/**
 * Match length (DECIDED): private tables pick best of 1, 3 or 5 deals;
 * public tables play one deal, then offer a rematch.
 */
export const COURT_PIECE_PRIVATE_BEST_OF: readonly number[] = [1, 3, 5];
export const COURT_PIECE_PUBLIC_BEST_OF = 1;

/** Ace high, two low. */
export const COURT_PIECE_RANK_ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function rankValue(card: Card): number {
  return COURT_PIECE_RANK_ORDER.indexOf(card.rank);
}

/**
 * The two games (FOUNDER, 2026-09-22). They differ only in how tricks are
 * banked: Single Siri banks every trick as it is won; Double Siri banks
 * the pile only when the same player wins two tricks in a row. The
 * "blind" first-cut trump rule above applies to BOTH; it is not a
 * separate variant.
 */
export type CourtPieceVariant = 'single_siri' | 'double_siri';

export interface CourtPieceVariantInfo {
  id: CourtPieceVariant;
  name: string;
  summary: string;
}

export const COURT_PIECE_VARIANTS: readonly CourtPieceVariantInfo[] = [
  { id: 'single_siri', name: 'Single Siri', summary: 'Every trick goes straight to the team that won it.' },
  { id: 'double_siri', name: 'Double Siri', summary: 'Tricks pile up in the middle until one player wins two in a row.' },
];

export function isAce(card: Card): boolean {
  return card.rank === 'A';
}

/** Seats 0..3 in play order (to the right). Partners sit opposite. */
export type Seat = 0 | 1 | 2 | 3;

export function seatTeam(seat: number): number {
  return seat % 2;
}

export function partnerOf(seat: number): number {
  return (seat + 2) % 4;
}

/** The player who acts after this seat. */
export function nextSeat(seat: number): number {
  return (seat + 1) % 4;
}

export const SUITS_FOR_TRUMP: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
