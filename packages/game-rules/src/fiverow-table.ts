/**
 * The contract between the phone app and the Five Row room on the server.
 * Both sides import these names so a typo becomes a compile error.
 */
import type { Card } from './cards.js';
import type { FiveRowMove } from './fiverow-match.js';
import type { BoardState, ChipCell, Run } from './fiverow-rules.js';

/** Messages the phone can send to a Five Row room. */
export const FIVEROW_MESSAGES = {
  /** payload: FiveRowMove */
  move: 'move',
  /** payload: none. Only accepted when the player has no legal move. */
  pass: 'pass',
  /** payload: none. Asks the room to resend the clock and my hand. */
  sync: 'sync',
} as const;

/** Messages the room sends to ONE phone (never in shared state). */
export const FIVEROW_EVENTS = {
  /** payload: { cards: Card[] } — the receiving player's own hand. */
  hand: 'hand',
  /** payload: { reason: string } — a move was refused. */
  refused: 'refused',
  /** payload: { now: number } — the room clock, so phones can show timers. */
  clock: 'clock',
} as const;

export type FiveRowPhase = 'waiting' | 'playing' | 'finished';

/** "No chip" in the synced board array. Teams are 0, 1, 2. */
export const NO_CHIP = -1;

export interface FiveRowSeatSnapshot {
  sessionId: string;
  name: string;
  team: number;
  handCount: number;
  /** Consecutive timeouts; reset by a real move. */
  timeouts: number;
  abandoned: boolean;
  connected: boolean;
}

export interface FiveRowTableSnapshot {
  phase: FiveRowPhase;
  players: number;
  teams: number;
  chips: number[];
  locked: boolean[];
  runs: Run[];
  seats: FiveRowSeatSnapshot[];
  turnSessionId: string;
  /** Room-clock time (ms) the current turn expires at. */
  turnDeadline: number;
  exchangedThisTurn: boolean;
  winnerTeam: number;
  drawPileCount: number;
}

/** Minimal shape of the room's synced state that the phone reads from. */
export interface FiveRowStateLike {
  phase: string;
  players: number;
  teams: number;
  chips: { forEach(cb: (v: number, i: number) => void): void; length: number };
  locked: { forEach(cb: (v: boolean, i: number) => void): void; length: number };
  runs: { forEach(cb: (r: { team: number; cells: { forEach(cb: (c: number) => void): void } }) => void): void };
  seats: {
    forEach(
      cb: (
        seat: { name: string; team: number; handCount: number; timeouts: number; abandoned: boolean; connected: boolean },
        sessionId: string,
      ) => void,
    ): void;
  };
  turnSessionId: string;
  turnDeadline: number;
  exchangedThisTurn: boolean;
  winnerTeam: number;
  drawPileCount: number;
}

export function toFiveRowSnapshot(state: FiveRowStateLike): FiveRowTableSnapshot {
  const chips: number[] = [];
  state.chips.forEach((v) => chips.push(v));
  const locked: boolean[] = [];
  state.locked.forEach((v) => locked.push(v));
  const runs: Run[] = [];
  state.runs.forEach((r) => {
    const cells: number[] = [];
    r.cells.forEach((c) => cells.push(c));
    runs.push({ team: r.team, cells });
  });
  const seats: FiveRowSeatSnapshot[] = [];
  state.seats.forEach((seat, sessionId) => {
    seats.push({
      sessionId,
      name: seat.name,
      team: seat.team,
      handCount: seat.handCount,
      timeouts: seat.timeouts,
      abandoned: seat.abandoned,
      connected: seat.connected,
    });
  });
  return {
    phase: state.phase as FiveRowPhase,
    players: state.players,
    teams: state.teams,
    chips,
    locked,
    runs,
    seats,
    turnSessionId: state.turnSessionId,
    turnDeadline: state.turnDeadline,
    exchangedThisTurn: state.exchangedThisTurn,
    winnerTeam: state.winnerTeam,
    drawPileCount: state.drawPileCount,
  };
}

/** Rebuild a rules BoardState from a snapshot so the phone can highlight legal cells. */
export function boardFromSnapshot(snapshot: FiveRowTableSnapshot): BoardState {
  const chips: ChipCell[] = snapshot.chips.map((v) => (v === NO_CHIP ? null : v));
  return { chips, locked: snapshot.locked.slice(), runs: snapshot.runs };
}

export type { Card, FiveRowMove };
