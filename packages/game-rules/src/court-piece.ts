/**
 * Court Piece (Rang): facts about the game that are fixed by tradition.
 *
 * Full rules (trump selection, trick resolution, scoring for each
 * variation) are NOT written yet. They will be specified with the founder.
 */

export const COURT_PIECE_PLAYERS = 4;
export const COURT_PIECE_TEAMS = 2;

/** One standard deck, 52 cards, dealt fully: 13 cards each. */
export const COURT_PIECE_DECK_COUNT = 1;
export const COURT_PIECE_HAND_SIZE = 13;

/**
 * Variations the product must support. Names are placeholders until the
 * founder confirms the exact wording players expect to see.
 */
export type CourtPieceVariant = 'classic' | 'double_siri' | 'blind_rang';

export const COURT_PIECE_VARIANTS: readonly CourtPieceVariant[] = [
  'classic',
  'double_siri',
  'blind_rang',
];
