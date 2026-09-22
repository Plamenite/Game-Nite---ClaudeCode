/**
 * A whole Court Piece deal as pure data plus pure functions: seating,
 * the 5 + 4 + 4 deal, the trump call, trick play, trick collection per
 * variant, and the win check. The game server wraps this.
 *
 * STANDARD rules follow the documented game. Lines marked CONFIRM are
 * house-rule choices that await the founder's answer in the interview.
 */
import { createStandardDeck, shuffle, type Card, type RandomSource, type Suit } from './cards.js';
import {
  COURT_PIECE_DEAL_BATCHES,
  COURT_PIECE_HAND_SIZE,
  COURT_PIECE_TRICKS_TO_WIN,
  SUITS_FOR_TRUMP,
  nextSeat,
  seatTeam,
  type CourtPieceVariant,
} from './court-piece.js';
import { canFollowSuit, legalPlays, trickWinner, type TrickCard } from './court-piece-rules.js';
import { cardId } from './cards.js';

export interface CourtPieceSettings {
  variant: CourtPieceVariant;
  /** Override for tests. Standard: 7. */
  tricksToWin?: number;
}

export type CourtPiecePhase = 'choosing_trump' | 'playing' | 'finished';

export interface CompletedTrick {
  number: number; // 1..13
  plays: TrickCard[];
  winner: number;
}

export interface CourtPieceMatch {
  settings: Required<CourtPieceSettings>;
  dealer: number;
  /** Player to the dealer's right: calls trump (unless blind) and leads. */
  caller: number;
  phase: CourtPiecePhase;
  hands: Card[][];
  /** Cards not yet dealt while trump is being chosen. */
  undealt: Card[];
  trump: Suit | null;
  /** Seat whose turn it is. */
  current: number;
  /** Cards on the table for the trick in progress. */
  trick: TrickCard[];
  completed: CompletedTrick[];
  /** Tricks each team has collected (team 0 = seats 0 and 2). */
  collected: [number, number];
  /** Double Siri: tricks lying uncollected in the middle. */
  heap: number;
  /** Double Siri: who won the previous trick, for the "two in a row" rule. */
  lastTrickWinner: number | null;
  winner: number | null;
  /** True when the winning team took every trick, or seven straight. CONFIRM scoring. */
  kot: boolean;
}

export class IllegalPlayError extends Error {}

const CARDS_PER_TRICK = 4;
const TRICKS_PER_DEAL = 13;

/**
 * Shuffle and deal the first batch. The caller then sees five cards and
 * names trump (Single and Double Siri). In Blind Rang nobody calls: the
 * whole hand is dealt and the first off-suit card sets the trump.
 */
export function createCourtPieceMatch(dealer: number, settings: CourtPieceSettings, random: RandomSource): CourtPieceMatch {
  const deck = shuffle(createStandardDeck(), random);
  const caller = nextSeat(dealer);
  const hands: Card[][] = [[], [], [], []];

  // Deal starts with the caller and goes round in play order.
  const dealBatch = (count: number) => {
    let seat = caller;
    for (let i = 0; i < 4; i++) {
      hands[seat].push(...deck.splice(0, count));
      seat = nextSeat(seat);
    }
  };

  const [first, ...rest] = COURT_PIECE_DEAL_BATCHES;
  dealBatch(first);

  const blind = settings.variant === 'blind_rang';
  const match: CourtPieceMatch = {
    settings: { variant: settings.variant, tricksToWin: settings.tricksToWin ?? COURT_PIECE_TRICKS_TO_WIN },
    dealer,
    caller,
    phase: blind ? 'playing' : 'choosing_trump',
    hands,
    undealt: deck,
    trump: null,
    current: caller,
    trick: [],
    completed: [],
    collected: [0, 0],
    heap: 0,
    lastTrickWinner: null,
    winner: null,
    kot: false,
  };

  if (blind) {
    for (const count of rest) dealBatch(count);
    match.undealt = [];
  }
  return match;
}

/** Deep-enough copy so callers never see their input change. */
function clone(match: CourtPieceMatch): CourtPieceMatch {
  return {
    ...match,
    hands: match.hands.map((h) => h.slice()),
    undealt: match.undealt.slice(),
    trick: match.trick.slice(),
    completed: match.completed.slice(),
    collected: [match.collected[0], match.collected[1]],
  };
}

/** The caller names trump after seeing five cards; the rest is then dealt. */
export function chooseTrump(match: CourtPieceMatch, seat: number, suit: Suit): CourtPieceMatch {
  if (match.phase !== 'choosing_trump') throw new IllegalPlayError('trump has already been chosen');
  if (seat !== match.caller) throw new IllegalPlayError('only the caller chooses trump');
  if (!SUITS_FOR_TRUMP.includes(suit)) throw new IllegalPlayError(`not a suit: ${String(suit)}`);

  const next = clone(match);
  next.trump = suit;
  const [, ...rest] = COURT_PIECE_DEAL_BATCHES;
  for (const count of rest) {
    let s = next.caller;
    for (let i = 0; i < 4; i++) {
      next.hands[s].push(...next.undealt.splice(0, count));
      s = nextSeat(s);
    }
  }
  next.phase = 'playing';
  next.current = next.caller;
  return next;
}

export function ledSuit(match: CourtPieceMatch): Suit | null {
  return match.trick.length > 0 ? match.trick[0].card.suit : null;
}

/** Cards this seat may play right now (empty when it is not their turn). */
export function legalPlaysFor(match: CourtPieceMatch, seat: number): Card[] {
  if (match.phase !== 'playing' || match.winner !== null || match.current !== seat) return [];
  return legalPlays(match.hands[seat], ledSuit(match));
}

export interface PlayResult {
  match: CourtPieceMatch;
  /** Set when this card completed a trick. */
  trick?: CompletedTrick;
  /** Tricks a team just collected, if any. */
  collectedBy?: { team: number; count: number };
  /** Blind Rang: this card just set the trump. */
  trumpSetTo?: Suit;
}

export function playCard(match: CourtPieceMatch, seat: number, card: Card): PlayResult {
  const legal = legalPlaysFor(match, seat);
  const index = match.hands[seat].findIndex((c) => cardId(c) === cardId(card));
  if (index < 0 || !legal.some((c) => cardId(c) === cardId(card))) {
    throw new IllegalPlayError(`seat ${seat} may not play ${cardId(card)} now`);
  }

  const next = clone(match);
  next.hands[seat].splice(index, 1);
  next.trick.push({ seat, card });
  const result: PlayResult = { match: next };

  // Blind Rang: the first card that fails to follow suit becomes trump.
  const led = ledSuit(match);
  if (next.trump === null && led !== null && card.suit !== led && !canFollowSuit(match.hands[seat], led)) {
    next.trump = card.suit;
    result.trumpSetTo = card.suit;
  }

  if (next.trick.length < CARDS_PER_TRICK) {
    next.current = nextSeat(seat);
    return result;
  }

  // Trick complete.
  const winner = trickWinner(next.trick, next.trump);
  const trick: CompletedTrick = { number: next.completed.length + 1, plays: next.trick, winner };
  next.completed.push(trick);
  next.trick = [];
  next.current = winner;
  result.trick = trick;

  const collected = collectTricks(next, trick);
  if (collected) result.collectedBy = collected;
  next.lastTrickWinner = winner;

  const team = seatTeam(winner);
  if (next.collected[team] >= next.settings.tricksToWin || trick.number === TRICKS_PER_DEAL) {
    const winningTeam = next.collected[0] >= next.settings.tricksToWin ? 0 : next.collected[1] >= next.settings.tricksToWin ? 1 : null;
    next.winner = winningTeam;
    next.phase = 'finished';
    if (winningTeam !== null) {
      // CONFIRM: kot = the losers collected nothing when the deal was decided.
      next.kot = next.collected[1 - winningTeam] === 0;
    }
  }
  return result;
}

/**
 * Who gets the trick just won, per variant.
 *
 * single_siri and blind_rang: straight to the winner's team. CONFIRM for
 * blind_rang: some tables use Double Siri collection with blind trump.
 *
 * double_siri (standard, documented): tricks pile in the middle. The same
 * PLAYER winning two tricks in a row collects the pile, except that no
 * collection happens after tricks 1, 2 or 12; the winner of trick 13 takes
 * whatever is left.
 */
function collectTricks(match: CourtPieceMatch, trick: CompletedTrick): { team: number; count: number } | null {
  const team = seatTeam(trick.winner);

  if (match.settings.variant !== 'double_siri') {
    match.collected[team] += 1;
    return { team, count: 1 };
  }

  match.heap += 1;
  const n = trick.number;
  const sameWinnerTwice = match.lastTrickWinner === trick.winner;
  const collectable = (n >= 3 && n <= 11 && sameWinnerTwice) || n === TRICKS_PER_DEAL;
  if (!collectable) return null;

  const count = match.heap;
  match.collected[team] += count;
  match.heap = 0;
  return { team, count };
}

/** What one seat may see: own hand, others' counts, the table, and the score. */
export function viewForSeat(match: CourtPieceMatch, seat: number) {
  return {
    variant: match.settings.variant,
    phase: match.phase,
    dealer: match.dealer,
    caller: match.caller,
    trump: match.trump,
    current: match.current,
    hand: match.hands[seat],
    handCounts: match.hands.map((h) => h.length),
    trick: match.trick,
    tricksPlayed: match.completed.length,
    collected: match.collected,
    heap: match.heap,
    winner: match.winner,
    kot: match.kot,
    myTeam: seatTeam(seat),
  };
}

export const COURT_PIECE_TOTAL_TRICKS = TRICKS_PER_DEAL;
export { COURT_PIECE_HAND_SIZE };
