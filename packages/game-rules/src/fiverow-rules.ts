/**
 * Five Row board rules: what a chip placement or removal does, and when a
 * run of five is complete. Pure functions, no randomness, no turn order.
 * Turn order, hands, and the draw pile live in fiverow-match.ts.
 */
import type { Card } from './cards.js';
import { FIVEROW_BOARD_SIZE, FIVEROW_RUN_LENGTH, isOneEyedJack, isTwoEyedJack } from './fiverow.js';
import { FIVEROW_CELL_COUNT, cellRowCol, cellsForCard, isFreeSpace } from './fiverow-board.js';

/** Teams are numbered 0, 1, 2. */
export type TeamIndex = number;

/** One cell of the board: which team's chip sits there, or nothing. */
export type ChipCell = TeamIndex | null;

export interface Run {
  team: TeamIndex;
  /** The five cell indexes, in line order. */
  cells: number[];
}

export interface BoardState {
  chips: ChipCell[];
  /** Cells that belong to a completed run. Their chips can never be removed. */
  locked: boolean[];
  runs: Run[];
}

export function emptyBoard(): BoardState {
  return {
    chips: new Array<ChipCell>(FIVEROW_CELL_COUNT).fill(null),
    locked: new Array<boolean>(FIVEROW_CELL_COUNT).fill(false),
    runs: [],
  };
}

export type BoardMove =
  /** A normal card on one of its two cells, or a two-eyed Jack anywhere free. */
  | { kind: 'place'; card: Card; cell: number }
  /** A one-eyed Jack removing an opponent's unlocked chip. */
  | { kind: 'remove'; card: Card; cell: number };

/** A cell is open if it shows no chip and is not a free corner. */
export function isOpenCell(board: BoardState, cell: number): boolean {
  return board.chips[cell] === null && !isFreeSpace(cell);
}

/** A non-Jack card is dead when both of its board cells are already taken. */
export function isDeadCard(board: BoardState, card: Card): boolean {
  if (card.rank === 'J') return false;
  return cellsForCard(card).every((cell) => board.chips[cell] !== null);
}

/** Every board move this card allows for this team right now. */
export function movesForCard(board: BoardState, card: Card, team: TeamIndex): BoardMove[] {
  const moves: BoardMove[] = [];
  if (isTwoEyedJack(card)) {
    for (let cell = 0; cell < FIVEROW_CELL_COUNT; cell++) {
      if (isOpenCell(board, cell)) moves.push({ kind: 'place', card, cell });
    }
  } else if (isOneEyedJack(card)) {
    for (let cell = 0; cell < FIVEROW_CELL_COUNT; cell++) {
      const chip = board.chips[cell];
      if (chip !== null && chip !== team && !board.locked[cell]) {
        moves.push({ kind: 'remove', card, cell });
      }
    }
  } else {
    for (const cell of cellsForCard(card)) {
      if (board.chips[cell] === null) moves.push({ kind: 'place', card, cell });
    }
  }
  return moves;
}

export function isLegalBoardMove(board: BoardState, move: BoardMove, team: TeamIndex): boolean {
  return movesForCard(board, move.card, team).some((m) => m.kind === move.kind && m.cell === move.cell);
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // along the row
  [1, 0], // down the column
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
];

/** True if this cell counts for `team`: their chip, or a free corner. */
function countsFor(board: BoardState, cell: number, team: TeamIndex): boolean {
  return isFreeSpace(cell) || board.chips[cell] === team;
}

/**
 * After a chip lands on `cell`, find every NEW run of five through it.
 *
 * Rule: two runs may share at most ONE chip. So a candidate window of five
 * is valid only if at most one of its cells is already locked by an earlier
 * run. Free corners are never locked and may be reused.
 */
export function findNewRuns(board: BoardState, cell: number, team: TeamIndex): Run[] {
  const found: Run[] = [];
  const { row, col } = cellRowCol(cell);

  for (const [dr, dc] of DIRECTIONS) {
    // Collect the maximal line of cells counting for this team through `cell`.
    const line: number[] = [cell];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < FIVEROW_BOARD_SIZE && c >= 0 && c < FIVEROW_BOARD_SIZE) {
        const idx = r * FIVEROW_BOARD_SIZE + c;
        if (!countsFor(board, idx, team)) break;
        if (sign === -1) line.unshift(idx);
        else line.push(idx);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length < FIVEROW_RUN_LENGTH) continue;

    // Pick the window through `cell` with the fewest already-locked cells.
    let best: number[] | null = null;
    let bestLocked = Infinity;
    const position = line.indexOf(cell);
    for (let start = Math.max(0, position - FIVEROW_RUN_LENGTH + 1); start <= position && start + FIVEROW_RUN_LENGTH <= line.length; start++) {
      const window = line.slice(start, start + FIVEROW_RUN_LENGTH);
      const lockedCount = window.filter((c) => board.locked[c]).length;
      if (lockedCount < bestLocked) {
        bestLocked = lockedCount;
        best = window;
      }
    }
    if (best && bestLocked <= 1) {
      found.push({ team, cells: best });
    }
  }
  return found;
}

export interface BoardMoveResult {
  board: BoardState;
  newRuns: Run[];
}

/** Apply a legal board move. Returns a NEW board; the input is untouched. */
export function applyBoardMove(board: BoardState, move: BoardMove, team: TeamIndex): BoardMoveResult {
  if (!isLegalBoardMove(board, move, team)) {
    throw new Error(`illegal move: ${move.kind} ${move.card.rank}-${move.card.suit} at ${move.cell}`);
  }
  const chips = board.chips.slice();
  const locked = board.locked.slice();
  const runs = board.runs.slice();

  if (move.kind === 'remove') {
    chips[move.cell] = null;
    return { board: { chips, locked, runs }, newRuns: [] };
  }

  chips[move.cell] = team;
  const next: BoardState = { chips, locked, runs };
  const newRuns = findNewRuns(next, move.cell, team);
  for (const run of newRuns) {
    runs.push(run);
    for (const c of run.cells) {
      if (!isFreeSpace(c)) locked[c] = true;
    }
  }
  return { board: next, newRuns };
}

export function runsCompleted(board: BoardState, team: TeamIndex): number {
  return board.runs.filter((run) => run.team === team).length;
}
