/**
 * A whole Court Piece deal as pure data plus pure functions: seating,
 * dealing, trick play, trump-by-first-cut, trick collection per variant,
 * and the result. The game server wraps this.
 *
 * FOUNDER'S RULES (2026-09-22) are the baseline. Lines marked CONFIRM are
 * details still awaiting an answer in the interview.
 */
import { cardId, createStandardDeck, shuffle, type Card, type RandomSource, type Suit } from './cards.js';
import {
  COURT_PIECE_HAND_SIZE,
  COURT_PIECE_TOTAL_TRICKS,
  COURT_PIECE_TRICKS_TO_WIN,
  OPENING_CARD,
  classifyDeal,
  isAce,
  nextSeat,
  seatTeam,
  type CourtPieceVariant,
  type DealResult,
} from './court-piece.js';
import { canFollowSuit, legalPlays, trickWinner, type TrickCard } from './court-piece-rules.js';

export interface CourtPieceSettings {
  variant: CourtPieceVariant;
  /** Override for tests. Standard: 7. */
  tricksToWin?: number;
}

export type CourtPiecePhase = 'playing' | 'finished';

export interface CompletedTrick {
  number: number; // 1..13
  plays: TrickCard[];
  winner: number;
}

export interface CourtPieceMatch {
  settings: Required<CourtPieceSettings>;
  dealer: number;
  /** Whoever was dealt the two of clubs: leads the first trick with it. */
  leader: number;
  phase: CourtPiecePhase;
  hands: Card[][];
  /** Null until the first player who cannot follow suit plays a card. */
  trump: Suit | null;
  /** Seat that set the trump; their team is the "trump-calling" team. */
  trumpSetter: number | null;
  /** Seat whose turn it is. */
  current: number;
  /** False until the two of clubs has been played to open the deal. */
  opened: boolean;
  /** Cards on the table for the trick in progress. */
  trick: TrickCard[];
  completed: CompletedTrick[];
  /** Tricks each team has collected (team 0 = seats 0 and 2). */
  collected: [number, number];
  /** Double Siri: tricks lying uncollected in the middle. */
  heap: number;
  /** Double Siri: who won the previous trick, for the "two in a row" rule. */
  lastTrickWinner: number | null;
  /** Double Siri: the card that won the previous trick (for the ace rule). */
  lastWinningCard: Card | null;
  /** Double Siri: whether the previous trick was won after the trump existed. */
  lastTrickAfterTrump: boolean;
  /** Known as soon as a team reaches the target; the deal still runs to 13. */
  winner: number | null;
  /** Set when the deal finishes. */
  result: DealResult | null;
}

export class IllegalPlayError extends Error {}

const CARDS_PER_TRICK = 4;

/** Shuffle and deal all 13 cards each. The two of clubs decides who leads. No trump yet. */
export function createCourtPieceMatch(dealer: number, settings: CourtPieceSettings, random: RandomSource): CourtPieceMatch {
  const deck = shuffle(createStandardDeck(), random);
  const hands: Card[][] = [[], [], [], []];
  let seat = nextSeat(dealer);
  for (let i = 0; i < 4; i++) {
    hands[seat] = deck.splice(0, COURT_PIECE_HAND_SIZE);
    seat = nextSeat(seat);
  }
  const leader = hands.findIndex((h) => h.some((c) => cardId(c) === cardId(OPENING_CARD)));

  return {
    settings: { variant: settings.variant, tricksToWin: settings.tricksToWin ?? COURT_PIECE_TRICKS_TO_WIN },
    dealer,
    leader,
    phase: 'playing',
    hands,
    trump: null,
    trumpSetter: null,
    current: leader,
    opened: false,
    trick: [],
    completed: [],
    collected: [0, 0],
    heap: 0,
    lastTrickWinner: null,
    lastWinningCard: null,
    lastTrickAfterTrump: false,
    winner: null,
    result: null,
  };
}

/** Deep-enough copy so callers never see their input change. */
function clone(match: CourtPieceMatch): CourtPieceMatch {
  return {
    ...match,
    hands: match.hands.map((h) => h.slice()),
    trick: match.trick.slice(),
    completed: match.completed.slice(),
    collected: [match.collected[0], match.collected[1]],
  };
}

export function ledSuit(match: CourtPieceMatch): Suit | null {
  return match.trick.length > 0 ? match.trick[0].card.suit : null;
}

/** True before any card has been played in this deal. */
export function isOpeningPlay(match: CourtPieceMatch): boolean {
  return !match.opened;
}

/** Cards this seat may play right now (empty when it is not their turn). */
export function legalPlaysFor(match: CourtPieceMatch, seat: number): Card[] {
  if (match.phase !== 'playing' || match.current !== seat) return [];
  if (isOpeningPlay(match)) {
    // The deal always opens with the two of clubs.
    return match.hands[seat].filter((c) => cardId(c) === cardId(OPENING_CARD));
  }
  return legalPlays(match.hands[seat], ledSuit(match));
}

export interface PlayResult {
  match: CourtPieceMatch;
  /** Set when this card completed a trick. */
  trick?: CompletedTrick;
  /** Tricks a team just collected, if any. */
  collectedBy?: { team: number; count: number };
  /** This card just set the trump. */
  trumpSetTo?: Suit;
}

export function playCard(match: CourtPieceMatch, seat: number, card: Card): PlayResult {
  const legal = legalPlaysFor(match, seat);
  const index = match.hands[seat].findIndex((c) => cardId(c) === cardId(card));
  if (index < 0 || !legal.some((c) => cardId(c) === cardId(card))) {
    throw new IllegalPlayError(`seat ${seat} may not play ${cardId(card)} now`);
  }

  const next = clone(match);
  next.opened = true;
  next.hands[seat].splice(index, 1);
  next.trick.push({ seat, card });
  const result: PlayResult = { match: next };

  // The first card that cannot follow suit becomes the trump for the deal.
  const led = ledSuit(match);
  if (next.trump === null && led !== null && card.suit !== led && !canFollowSuit(match.hands[seat], led)) {
    next.trump = card.suit;
    next.trumpSetter = seat;
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
  next.lastWinningCard = trick.plays.find((p) => p.seat === winner)!.card;
  next.lastTrickAfterTrump = next.trump !== null;

  // The deal is decided at the target, but always played out to the end.
  for (const team of [0, 1]) {
    if (next.winner === null && next.collected[team] >= next.settings.tricksToWin) next.winner = team;
  }
  if (trick.number === COURT_PIECE_TOTAL_TRICKS) {
    const trumpTeam = next.trumpSetter === null ? null : seatTeam(next.trumpSetter);
    const outcome = classifyDeal(next.collected, trumpTeam);
    next.winner = outcome.winner;
    next.result = outcome.result;
    next.phase = 'finished';
  }
  return result;
}

/**
 * Who gets the trick just won, per variant (FOUNDER, 2026-09-22).
 *
 * single_siri: tricks pile up until the trump exists. The trick in which
 * the trump is created takes the whole pile; every trick after that banks
 * straight away.
 *
 * double_siri: tricks pile in the middle. The same PLAYER winning two
 * tricks in a row banks the pile, provided that:
 *   - it is not the 1st, 2nd or 12th trick (documented rule),
 *   - BOTH tricks were won after the trump was created,
 *   - the two tricks were not both won with an ace (ace-after-ace rule).
 *
 * Both: whoever wins the 13th trick takes whatever is left, no conditions.
 */
function collectTricks(match: CourtPieceMatch, trick: CompletedTrick): { team: number; count: number } | null {
  const team = seatTeam(trick.winner);
  match.heap += 1;
  const n = trick.number;
  if (n === COURT_PIECE_TOTAL_TRICKS) return bankHeap(match, team);

  if (match.settings.variant === 'single_siri') {
    return match.trump === null ? null : bankHeap(match, team);
  }

  if (n < 3 || n > 11) return null;
  const sameWinnerTwice = match.lastTrickWinner === trick.winner;
  const bothAfterTrump = match.trump !== null && match.lastTrickAfterTrump;
  const winningCard = trick.plays.find((p) => p.seat === trick.winner)!.card;
  const aceAfterAce = match.lastWinningCard !== null && isAce(match.lastWinningCard) && isAce(winningCard);

  if (!sameWinnerTwice || !bothAfterTrump || aceAfterAce) return null;
  return bankHeap(match, team);
}

function bankHeap(match: CourtPieceMatch, team: number): { team: number; count: number } {
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
    leader: match.leader,
    trump: match.trump,
    trumpSetter: match.trumpSetter,
    current: match.current,
    hand: match.hands[seat],
    handCounts: match.hands.map((h) => h.length),
    trick: match.trick,
    tricksPlayed: match.completed.length,
    collected: match.collected,
    heap: match.heap,
    winner: match.winner,
    result: match.result,
    myTeam: seatTeam(seat),
  };
}
