/**
 * A whole Five Row match as pure data plus pure functions: seating, dealing,
 * turn order, dead-card exchange, drawing, and the win check. The game
 * server wraps this; the phone can use it to highlight legal moves.
 *
 * SETTINGS marked "standard" are the classic defaults, kept until the
 * founder decides otherwise in the rules interview.
 */
import { cardId, createDecks, shuffle, type Card, type RandomSource } from './cards.js';
import { FIVEROW_DECK_COUNT, fiverowHandSize, fiverowRunsToWin } from './fiverow.js';
import {
  applyBoardMove,
  emptyBoard,
  isDeadCard,
  movesForCard,
  runsCompleted,
  type BoardMove,
  type BoardState,
  type Run,
  type TeamIndex,
} from './fiverow-rules.js';

export interface FiveRowSettings {
  /** 2 or 3 teams. Players are seated so teammates alternate. */
  teams: number;
  /** Override the standard hand size (mainly for tests). */
  handSize?: number;
  /** Override the standard runs-to-win (mainly for tests). */
  runsToWin?: number;
}

export interface FiveRowPlayer {
  id: string;
  team: TeamIndex;
  hand: Card[];
}

export type FiveRowMove =
  | BoardMove
  /** Swap a dead card for a new one. Allowed once per turn, before playing. */
  | { kind: 'exchangeDead'; card: Card };

export interface FiveRowMatch {
  settings: Required<FiveRowSettings>;
  players: FiveRowPlayer[];
  /** Index into `players` of whoever must act now. */
  turn: number;
  drawPile: Card[];
  discardPile: Card[];
  board: BoardState;
  exchangedThisTurn: boolean;
  winner: TeamIndex | null;
  /** True when the draw pile AND discards are empty and nobody has won. */
  stalemate: boolean;
}

export class IllegalMoveError extends Error {}

/** Seat players, shuffle two decks, deal. `random` must be crypto-secure on the server. */
export function createFiveRowMatch(playerIds: string[], settings: FiveRowSettings, random: RandomSource): FiveRowMatch {
  if (playerIds.length % settings.teams !== 0) {
    throw new RangeError(`${playerIds.length} players cannot form ${settings.teams} equal teams`);
  }
  const handSize = settings.handSize ?? fiverowHandSize(playerIds.length);
  const runsToWin = settings.runsToWin ?? fiverowRunsToWin(settings.teams);

  const drawPile = shuffle(createDecks(FIVEROW_DECK_COUNT), random);
  const players: FiveRowPlayer[] = playerIds.map((id, seat) => ({
    id,
    team: seat % settings.teams, // teammates alternate around the table
    hand: drawPile.splice(0, handSize),
  }));

  return {
    settings: { teams: settings.teams, handSize, runsToWin },
    players,
    turn: 0,
    drawPile,
    discardPile: [],
    board: emptyBoard(),
    exchangedThisTurn: false,
    winner: null,
    stalemate: false,
  };
}

export function currentPlayer(match: FiveRowMatch): FiveRowPlayer {
  return match.players[match.turn];
}

function findInHand(player: FiveRowPlayer, card: Card): number {
  return player.hand.findIndex((c) => cardId(c) === cardId(card));
}

/** Every move the given player may make right now (empty if not their turn). */
export function legalMoves(match: FiveRowMatch, playerId: string): FiveRowMove[] {
  if (match.winner !== null || match.stalemate) return [];
  const player = currentPlayer(match);
  if (player.id !== playerId) return [];

  const moves: FiveRowMove[] = [];
  const seen = new Set<string>();
  for (const card of player.hand) {
    // Two identical cards in hand give identical options; list them once.
    const key = cardId(card);
    if (seen.has(key)) continue;
    seen.add(key);

    moves.push(...movesForCard(match.board, card, player.team));
    if (!match.exchangedThisTurn && isDeadCard(match.board, card)) {
      moves.push({ kind: 'exchangeDead', card });
    }
  }
  return moves;
}

function drawOne(match: FiveRowMatch, random: RandomSource): Card | null {
  if (match.drawPile.length === 0 && match.discardPile.length > 0) {
    // ASSUMPTION (standard-ish, confirm with founder): reshuffle the discards.
    match.drawPile = shuffle(match.discardPile, random);
    match.discardPile = [];
  }
  return match.drawPile.shift() ?? null;
}

/**
 * Apply a move for `playerId`. Returns a NEW match; throws IllegalMoveError
 * for anything the rules forbid, including acting out of turn.
 */
export function playMove(match: FiveRowMatch, playerId: string, move: FiveRowMove, random: RandomSource): { match: FiveRowMatch; newRuns: Run[] } {
  const allowed = legalMoves(match, playerId).some((m) => sameMove(m, move));
  if (!allowed) {
    throw new IllegalMoveError(`${playerId} may not ${move.kind} ${cardId(move.card)} now`);
  }

  // Shallow copies of everything we change; board changes are copied by applyBoardMove.
  const next: FiveRowMatch = {
    ...match,
    players: match.players.map((p) => ({ ...p, hand: p.hand.slice() })),
    drawPile: match.drawPile.slice(),
    discardPile: match.discardPile.slice(),
  };
  const player = next.players[next.turn];
  const handIndex = findInHand(player, move.card);
  player.hand.splice(handIndex, 1);
  next.discardPile.push(move.card);

  if (move.kind === 'exchangeDead') {
    const replacement = drawOne(next, random);
    if (replacement) player.hand.push(replacement);
    next.exchangedThisTurn = true;
    return { match: next, newRuns: [] }; // same player still has to play a card
  }

  const result = applyBoardMove(next.board, move, player.team);
  next.board = result.board;

  const replacement = drawOne(next, random);
  if (replacement) player.hand.push(replacement);

  if (runsCompleted(next.board, player.team) >= next.settings.runsToWin) {
    next.winner = player.team;
  } else if (next.players.every((p) => p.hand.length === 0)) {
    next.stalemate = true;
  } else {
    next.turn = (next.turn + 1) % next.players.length;
    next.exchangedThisTurn = false;
  }
  return { match: next, newRuns: result.newRuns };
}

function sameMove(a: FiveRowMove, b: FiveRowMove): boolean {
  if (a.kind !== b.kind || cardId(a.card) !== cardId(b.card)) return false;
  if (a.kind === 'exchangeDead' || b.kind === 'exchangeDead') return true;
  return a.cell === b.cell;
}

/** What a player is allowed to see: their own hand, everyone else's counts. */
export function viewForPlayer(match: FiveRowMatch, playerId: string) {
  return {
    settings: match.settings,
    board: match.board,
    turn: match.turn,
    currentPlayerId: currentPlayer(match).id,
    winner: match.winner,
    stalemate: match.stalemate,
    drawPileCount: match.drawPile.length,
    players: match.players.map((p) => ({
      id: p.id,
      team: p.team,
      handCount: p.hand.length,
      hand: p.id === playerId ? p.hand : undefined,
    })),
  };
}
