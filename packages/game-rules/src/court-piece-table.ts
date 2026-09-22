/**
 * The contract between the phone app and the Court Piece room on the
 * server. Both sides import these names so a typo becomes a compile error.
 */
import { parseCardId, type Card, type Suit } from './cards.js';
import type { CourtPieceBestOf, CourtPieceVariant, DealResult } from './court-piece.js';
import type { TrickCard } from './court-piece-rules.js';

/** Messages the phone can send to a Court Piece room. */
export const COURTPIECE_MESSAGES = {
  /** payload: { card: Card } */
  play: 'play',
  /** payload: none. Asks the room to resend the clock and my hand. */
  sync: 'sync',
  /** payload: none. After a best-of-1 match: vote to play again. */
  rematch: 'rematch',
} as const;

/** Messages the room sends to ONE phone (never in shared state). */
export const COURTPIECE_EVENTS = {
  /** payload: { cards: Card[] } — the receiving player's own hand. */
  hand: 'hand',
  /** payload: { reason: string } */
  refused: 'refused',
  /** payload: { now: number } — the room clock, so phones can show timers. */
  clock: 'clock',
} as const;

export type CourtPieceTablePhase = 'waiting' | 'playing' | 'between_deals' | 'finished';

/** A deal can also end by forfeit when a whole team has left. */
export type CourtPieceDealOutcome = DealResult | 'forfeit';

export const NO_SEAT = -1;

export interface CourtPieceSeatSnapshot {
  sessionId: string;
  name: string;
  seat: number;
  team: number;
  handCount: number;
  timeouts: number;
  abandoned: boolean;
  connected: boolean;
  wantsRematch: boolean;
}

export interface CourtPieceTableSnapshot {
  phase: CourtPieceTablePhase;
  variant: CourtPieceVariant;
  bestOf: CourtPieceBestOf;
  dealNumber: number;
  score: [number, number];
  seriesWinner: number;
  trump: Suit | null;
  trumpSetterSeat: number;
  leaderSeat: number;
  currentSeat: number;
  trick: TrickCard[];
  lastTrick: TrickCard[];
  tricksPlayed: number;
  collected: [number, number];
  heap: number;
  dealWinner: number;
  dealResult: CourtPieceDealOutcome | null;
  turnSessionId: string;
  turnDeadline: number;
  seats: CourtPieceSeatSnapshot[];
}

interface TrickPlayLike {
  seat: number;
  card: string;
}

/** Minimal shape of the room's synced state that the phone reads from. */
export interface CourtPieceStateLike {
  phase: string;
  variant: string;
  bestOf: number;
  dealNumber: number;
  score0: number;
  score1: number;
  seriesWinner: number;
  trump: string;
  trumpSetterSeat: number;
  leaderSeat: number;
  currentSeat: number;
  trick: { forEach(cb: (p: TrickPlayLike) => void): void };
  lastTrick: { forEach(cb: (p: TrickPlayLike) => void): void };
  tricksPlayed: number;
  collected0: number;
  collected1: number;
  heap: number;
  dealWinner: number;
  dealResult: string;
  turnSessionId: string;
  turnDeadline: number;
  seats: {
    forEach(
      cb: (
        seat: {
          name: string;
          seat: number;
          team: number;
          handCount: number;
          timeouts: number;
          abandoned: boolean;
          connected: boolean;
          wantsRematch: boolean;
        },
        sessionId: string,
      ) => void,
    ): void;
  };
}

function plays(list: { forEach(cb: (p: TrickPlayLike) => void): void }): TrickCard[] {
  const out: TrickCard[] = [];
  list.forEach((p) => out.push({ seat: p.seat, card: parseCardId(p.card) }));
  return out;
}

export function toCourtPieceSnapshot(state: CourtPieceStateLike): CourtPieceTableSnapshot {
  const seats: CourtPieceSeatSnapshot[] = [];
  state.seats.forEach((s, sessionId) => {
    seats.push({
      sessionId,
      name: s.name,
      seat: s.seat,
      team: s.team,
      handCount: s.handCount,
      timeouts: s.timeouts,
      abandoned: s.abandoned,
      connected: s.connected,
      wantsRematch: s.wantsRematch,
    });
  });
  seats.sort((a, b) => a.seat - b.seat);
  return {
    phase: state.phase as CourtPieceTablePhase,
    variant: state.variant as CourtPieceVariant,
    bestOf: state.bestOf as CourtPieceBestOf,
    dealNumber: state.dealNumber,
    score: [state.score0, state.score1],
    seriesWinner: state.seriesWinner,
    trump: state.trump ? (state.trump as Suit) : null,
    trumpSetterSeat: state.trumpSetterSeat,
    leaderSeat: state.leaderSeat,
    currentSeat: state.currentSeat,
    trick: plays(state.trick),
    lastTrick: plays(state.lastTrick),
    tricksPlayed: state.tricksPlayed,
    collected: [state.collected0, state.collected1],
    heap: state.heap,
    dealWinner: state.dealWinner,
    dealResult: state.dealResult ? (state.dealResult as CourtPieceDealOutcome) : null,
    turnSessionId: state.turnSessionId,
    turnDeadline: state.turnDeadline,
    seats,
  };
}

export type { Card };
