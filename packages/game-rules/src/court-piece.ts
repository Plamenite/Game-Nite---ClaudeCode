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

/** Dealt as 5 first (trump is called on those), then 4 and 4. */
export const COURT_PIECE_DEAL_BATCHES: readonly number[] = [5, 4, 4];

/** Tricks a team must collect to win a deal. */
export const COURT_PIECE_TRICKS_TO_WIN = 7;

/** Ace high, two low. */
export const COURT_PIECE_RANK_ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function rankValue(card: Card): number {
  return COURT_PIECE_RANK_ORDER.indexOf(card.rank);
}

/**
 * Variants the product supports. Ids are internal; display names are the
 * founder's. Rules for each are in court-piece-match.ts, marked with what
 * is standard and what still awaits the founder's confirmation.
 */
export type CourtPieceVariant = 'single_siri' | 'double_siri' | 'blind_rang';

export interface CourtPieceVariantInfo {
  id: CourtPieceVariant;
  name: string;
  summary: string;
}

export const COURT_PIECE_VARIANTS: readonly CourtPieceVariantInfo[] = [
  { id: 'single_siri', name: 'Single Siri', summary: 'Classic Rang. Every trick goes straight to the team that won it.' },
  { id: 'double_siri', name: 'Double Siri', summary: 'Tricks pile up in the middle until one player wins two in a row.' },
  { id: 'blind_rang', name: 'Blind Rang', summary: 'No trump is called. The first card played off-suit sets the trump.' },
];

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
