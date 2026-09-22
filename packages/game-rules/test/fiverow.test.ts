import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RANKS, SUITS, cardId, type Card } from '../src/cards.js';
import { FIVEROW_BOARD, FREE_SPACE, cardFromCellId, cellIndex, cellRowCol, cellsForCard, isFreeSpace } from '../src/fiverow-board.js';
import {
  IllegalMoveError,
  createFiveRowMatch,
  currentPlayer,
  legalMoves,
  playMove,
  viewForPlayer,
  type FiveRowMatch,
} from '../src/fiverow-match.js';
import {
  applyBoardMove,
  emptyBoard,
  isDeadCard,
  movesForCard,
  runsCompleted,
  type BoardState,
} from '../src/fiverow-rules.js';
import { fiverowHandSize, fiverowRunsToWin } from '../src/fiverow.js';

const J_DIAMONDS: Card = { rank: 'J', suit: 'diamonds' }; // two-eyed: wild
const J_SPADES: Card = { rank: 'J', suit: 'spades' }; // one-eyed: remove

/** Deterministic random source: always the same permutation. */
const fixedRandom = () => 0.5;

function boardWithChips(cells: number[], team: number, base: BoardState = emptyBoard()): BoardState {
  const chips = base.chips.slice();
  for (const c of cells) chips[c] = team;
  return { ...base, chips };
}

// ---------------------------------------------------------------- board

test('board: 100 cells, four free corners, every non-Jack card exactly twice, no Jacks', () => {
  assert.equal(FIVEROW_BOARD.length, 100);
  const corners = [0, 9, 90, 99];
  for (const c of corners) assert.equal(FIVEROW_BOARD[c], FREE_SPACE);
  assert.equal(FIVEROW_BOARD.filter((c) => c === FREE_SPACE).length, 4);

  const counts = new Map<string, number>();
  for (const cell of FIVEROW_BOARD) {
    if (cell === FREE_SPACE) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  assert.equal(counts.size, 48);
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const id = cardId({ suit, rank });
      if (rank === 'J') assert.equal(counts.has(id), false, `${id} must not be on the board`);
      else assert.equal(counts.get(id), 2, `${id} must appear twice`);
    }
  }
});

test('board: the two copies of a card sit in different rows and columns, well apart', () => {
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (rank === 'J') continue;
      const [a, b] = cellsForCard({ suit, rank });
      const pa = cellRowCol(a);
      const pb = cellRowCol(b);
      assert.notEqual(pa.row, pb.row);
      assert.notEqual(pa.col, pb.col);
      assert.ok(Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) >= 5);
    }
  }
  assert.deepEqual(cellsForCard(J_DIAMONDS), []);
  assert.deepEqual(cardFromCellId('10-hearts'), { rank: '10', suit: 'hearts' });
  assert.equal(cellIndex(3, 4), 34);
  assert.equal(isFreeSpace(99), true);
});

// ---------------------------------------------------------------- moves

test('a normal card may go on either of its cells until they fill; then it is dead', () => {
  const card: Card = { rank: '7', suit: 'clubs' };
  const [a, b] = cellsForCard(card);
  let board = emptyBoard();
  assert.deepEqual(movesForCard(board, card, 0).map((m) => m.cell).sort(), [a, b].sort());
  assert.equal(isDeadCard(board, card), false);

  board = boardWithChips([a], 1);
  assert.deepEqual(movesForCard(board, card, 0).map((m) => m.cell), [b]);

  board = boardWithChips([a, b], 1);
  assert.deepEqual(movesForCard(board, card, 0), []);
  assert.equal(isDeadCard(board, card), true);
});

test('a two-eyed Jack goes anywhere open; a one-eyed Jack removes only unlocked opponent chips', () => {
  const board = boardWithChips([11, 12], 1, boardWithChips([13], 0));
  const wild = movesForCard(board, J_DIAMONDS, 0);
  assert.equal(wild.length, 96 - 3, 'all open cells minus corners and chips');
  assert.ok(wild.every((m) => m.kind === 'place'));

  const remove = movesForCard(board, J_SPADES, 0);
  assert.deepEqual(remove.map((m) => m.cell).sort(), [11, 12], 'not my own chip at 13');

  const locked = { ...board, locked: board.locked.slice() };
  locked.locked[11] = true;
  assert.deepEqual(movesForCard(locked, J_SPADES, 0).map((m) => m.cell), [12]);
});

test('applyBoardMove rejects illegal moves and never mutates its input', () => {
  const board = emptyBoard();
  assert.throws(() => applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 0 }, 0), /illegal/);
  const result = applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 55 }, 0);
  assert.equal(board.chips[55], null, 'input untouched');
  assert.equal(result.board.chips[55], 0);
});

// ---------------------------------------------------------------- runs

test('five in a row completes a run and locks its chips; corners count for everyone', () => {
  // Row 1, columns 1..4 are ours; the fifth chip lands on column 5.
  let board = boardWithChips([11, 12, 13, 14], 0);
  let result = applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 15 }, 0);
  assert.equal(result.newRuns.length, 1);
  assert.deepEqual(result.newRuns[0].cells, [11, 12, 13, 14, 15]);
  assert.ok([11, 12, 13, 14, 15].every((c) => result.board.locked[c]));
  assert.equal(runsCompleted(result.board, 0), 1);

  // Top row: corner 0 plus cells 1..4 make five.
  board = boardWithChips([1, 2, 3], 1);
  result = applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 4 }, 1);
  assert.equal(result.newRuns.length, 1);
  assert.deepEqual(result.newRuns[0].cells, [0, 1, 2, 3, 4]);
  assert.equal(result.board.locked[0], false, 'corners are never locked');
});

test('two runs may share exactly one chip, never two', () => {
  // First run across row 1: 11..15.
  let { board } = applyBoardMove(boardWithChips([11, 12, 13, 14], 0), { kind: 'place', card: J_DIAMONDS, cell: 15 }, 0);

  // Extending the same line to 8 chips (16, 17, then 18) gives no second run:
  // every window through 18 overlaps the first run by two or more chips.
  board = boardWithChips([16, 17], 0, board);
  let result = applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 18 }, 0);
  assert.equal(result.newRuns.length, 0);

  // A ninth chip makes 15..19: it shares only cell 15. Allowed.
  result = applyBoardMove(result.board, { kind: 'place', card: J_DIAMONDS, cell: 19 }, 0);
  assert.equal(result.newRuns.length, 1);
  assert.deepEqual(result.newRuns[0].cells, [15, 16, 17, 18, 19]);
  assert.equal(runsCompleted(result.board, 0), 2);

  // A column down from 15 (25, 35, 45, then 55) shares only cell 15 too.
  board = boardWithChips([25, 35, 45], 0, result.board);
  result = applyBoardMove(board, { kind: 'place', card: J_DIAMONDS, cell: 55 }, 0);
  assert.equal(result.newRuns.length, 1);
  assert.deepEqual(result.newRuns[0].cells, [15, 25, 35, 45, 55]);
});

test('a one-eyed Jack cannot break a completed run', () => {
  const { board } = applyBoardMove(boardWithChips([11, 12, 13, 14], 0), { kind: 'place', card: J_DIAMONDS, cell: 15 }, 0);
  assert.deepEqual(movesForCard(board, J_SPADES, 1), []);
});

// ---------------------------------------------------------------- match

test('standard settings: hand sizes and runs to win', () => {
  assert.equal(fiverowHandSize(2), 7);
  assert.equal(fiverowHandSize(4), 6);
  assert.equal(fiverowHandSize(12), 3);
  assert.throws(() => fiverowHandSize(5), RangeError);
  assert.equal(fiverowRunsToWin(2), 2);
  assert.equal(fiverowRunsToWin(3), 1);
});

test('createFiveRowMatch seats teammates alternately and deals from two decks', () => {
  const m2 = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  assert.deepEqual(m2.players.map((p) => p.team), [0, 1]);
  assert.ok(m2.players.every((p) => p.hand.length === 7));
  assert.equal(m2.drawPile.length, 104 - 14);
  assert.equal(m2.settings.runsToWin, 2);

  const m4 = createFiveRowMatch(['a', 'b', 'c', 'd'], { teams: 2 }, fixedRandom);
  assert.deepEqual(m4.players.map((p) => p.team), [0, 1, 0, 1]);
  assert.ok(m4.players.every((p) => p.hand.length === 6));

  const m3 = createFiveRowMatch(['a', 'b', 'c'], { teams: 3 }, fixedRandom);
  assert.deepEqual(m3.players.map((p) => p.team), [0, 1, 2]);
  assert.equal(m3.settings.runsToWin, 1);

  assert.throws(() => createFiveRowMatch(['a', 'b', 'c'], { teams: 2 }, fixedRandom), RangeError);
});

test('only the current player has moves, and illegal moves are refused', () => {
  const match = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  assert.equal(currentPlayer(match).id, 'a');
  assert.deepEqual(legalMoves(match, 'b'), []);
  const moves = legalMoves(match, 'a');
  assert.ok(moves.length > 0);

  const first = moves.find((m) => m.kind === 'place')!;
  assert.throws(() => playMove(match, 'b', first, fixedRandom), IllegalMoveError, 'out of turn');
  assert.throws(
    () => playMove(match, 'a', { kind: 'place', card: first.card, cell: 0 }, fixedRandom),
    IllegalMoveError,
    'a corner is not a legal cell',
  );
});

test('playing a card passes the turn, refills the hand, and keeps the input untouched', () => {
  const match = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  const move = legalMoves(match, 'a').find((m) => m.kind === 'place')!;
  const { match: next } = playMove(match, 'a', move, fixedRandom);

  assert.equal(currentPlayer(next).id, 'b');
  assert.equal(next.players[0].hand.length, 7, 'drew a replacement');
  assert.equal(next.drawPile.length, match.drawPile.length - 1);
  assert.equal(next.discardPile.length, 1);
  assert.equal(match.discardPile.length, 0, 'input untouched');
  assert.equal(next.board.chips[(move as { cell: number }).cell], 0);
});

test('a dead card can be exchanged once per turn, then the player still plays', () => {
  let match: FiveRowMatch = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  const dead: Card = { rank: '9', suit: 'hearts' };
  // Rig the table: both cells of 9♥ are taken, and 'a' holds it.
  match = { ...match, board: boardWithChips([...cellsForCard(dead)], 1) };
  match.players[0].hand[0] = dead;

  const exchange = legalMoves(match, 'a').find((m) => m.kind === 'exchangeDead');
  assert.ok(exchange, 'exchange offered');
  const { match: afterExchange } = playMove(match, 'a', exchange!, fixedRandom);
  assert.equal(currentPlayer(afterExchange).id, 'a', 'still my turn');
  assert.equal(afterExchange.players[0].hand.length, 7);
  assert.equal(afterExchange.exchangedThisTurn, true);
  assert.equal(legalMoves(afterExchange, 'a').some((m) => m.kind === 'exchangeDead'), false, 'once per turn');

  const place = legalMoves(afterExchange, 'a').find((m) => m.kind === 'place')!;
  const { match: afterPlay } = playMove(afterExchange, 'a', place, fixedRandom);
  assert.equal(currentPlayer(afterPlay).id, 'b');
  assert.equal(afterPlay.exchangedThisTurn, false);
});

test('completing enough runs wins, and the match then accepts no more moves', () => {
  let match: FiveRowMatch = createFiveRowMatch(['a', 'b'], { teams: 2, runsToWin: 1 }, fixedRandom);
  match = { ...match, board: boardWithChips([11, 12, 13, 14], 0) };
  match.players[0].hand[0] = J_DIAMONDS;

  const { match: won, newRuns } = playMove(match, 'a', { kind: 'place', card: J_DIAMONDS, cell: 15 }, fixedRandom);
  assert.equal(newRuns.length, 1);
  assert.equal(won.winner, 0);
  assert.equal(currentPlayer(won).id, 'a', 'turn does not advance after a win');
  assert.deepEqual(legalMoves(won, 'a'), []);
  assert.deepEqual(legalMoves(won, 'b'), []);
});

test('viewForPlayer shows my hand and only counts for others', () => {
  const match = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  const view = viewForPlayer(match, 'b');
  assert.equal(view.players[0].hand, undefined);
  assert.equal(view.players[0].handCount, 7);
  assert.equal(view.players[1].hand?.length, 7);
  assert.equal(view.currentPlayerId, 'a');
});

// ---------------------------------------------------------------- interview decisions

test('table configs: 2 players, 3 players, and 2 vs 2 only', async () => {
  const { FIVEROW_TABLE_CONFIGS, fiverowConfigForPlayers } = await import('../src/fiverow.js');
  assert.deepEqual(FIVEROW_TABLE_CONFIGS.map((c) => [c.players, c.teams]), [[2, 2], [3, 3], [4, 2]]);
  assert.equal(fiverowConfigForPlayers(3)?.id, '3p');
  assert.equal(fiverowConfigForPlayers(5), null);
  assert.equal(fiverowConfigForPlayers(6), null);
});

test('a player with no legal move must pass; otherwise passing is refused', async () => {
  const { mustPass, passTurn, randomLegalMove } = await import('../src/fiverow-match.js');
  let match: FiveRowMatch = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  assert.equal(mustPass(match, 'a'), false);
  assert.throws(() => passTurn(match, 'a'), IllegalMoveError);

  // Rig: 'a' holds nothing at all.
  match.players[0].hand = [];
  assert.equal(mustPass(match, 'a'), true);
  assert.equal(mustPass(match, 'b'), false, 'not their turn');
  assert.equal(randomLegalMove(match, 'a', fixedRandom), null);
  const passed = passTurn(match, 'a');
  assert.equal(currentPlayer(passed).id, 'b');
});

test('randomLegalMove prefers a board move over a dead-card exchange', async () => {
  const { randomLegalMove } = await import('../src/fiverow-match.js');
  let match: FiveRowMatch = createFiveRowMatch(['a', 'b'], { teams: 2 }, fixedRandom);
  const dead: Card = { rank: '9', suit: 'hearts' };
  match = { ...match, board: boardWithChips([...cellsForCard(dead)], 1) };
  match.players[0].hand = [dead, J_DIAMONDS];
  const move = randomLegalMove(match, 'a', fixedRandom)!;
  assert.equal(move.kind, 'place');

  match.players[0].hand = [dead];
  assert.equal(randomLegalMove(match, 'a', fixedRandom)!.kind, 'exchangeDead');
});

test('toFiveRowSnapshot and boardFromSnapshot round-trip a board', async () => {
  const { toFiveRowSnapshot, boardFromSnapshot, NO_CHIP } = await import('../src/fiverow-table.js');
  const chips = new Array(100).fill(NO_CHIP);
  chips[11] = 0;
  const state = {
    phase: 'playing',
    players: 2,
    teams: 2,
    chips,
    locked: new Array(100).fill(false),
    runs: [{ team: 0, cells: [11, 12, 13, 14, 15] }],
    seats: new Map([['s1', { name: 'Zain', team: 0, handCount: 7, timeouts: 0, abandoned: false, connected: true }]]),
    turnSessionId: 's1',
    turnDeadline: 123,
    exchangedThisTurn: false,
    winnerTeam: NO_CHIP,
    drawPileCount: 90,
  };
  const snap = toFiveRowSnapshot(state);
  assert.equal(snap.seats[0].sessionId, 's1');
  assert.deepEqual(snap.runs[0].cells, [11, 12, 13, 14, 15]);
  const board = boardFromSnapshot(snap);
  assert.equal(board.chips[11], 0);
  assert.equal(board.chips[12], null);
});
