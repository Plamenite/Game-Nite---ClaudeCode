/**
 * A Court Piece MATCH is a series of deals: best of 1, 3 or 5. Pure data
 * and pure functions; the room wraps this around court-piece-match.ts.
 */
import { dealsNeededToWin, nextSeat, type CourtPieceBestOf, type DealResult } from './court-piece.js';

export interface DealRecord {
  number: number;
  winner: number;
  result: DealResult;
  collected: [number, number];
}

export interface CourtPieceSeries {
  bestOf: CourtPieceBestOf;
  deals: DealRecord[];
  /** Deals won per team. A kot counts as one win. */
  score: [number, number];
  /** Dealer for the next deal; rotates one seat to the right each deal. */
  nextDealer: number;
  winner: number | null;
}

export function createSeries(bestOf: CourtPieceBestOf, firstDealer: number): CourtPieceSeries {
  return { bestOf, deals: [], score: [0, 0], nextDealer: firstDealer, winner: null };
}

/** Record a finished deal. Returns a NEW series. */
export function recordDeal(series: CourtPieceSeries, deal: Omit<DealRecord, 'number'>): CourtPieceSeries {
  if (series.winner !== null) throw new Error('the series is already decided');
  const score: [number, number] = [series.score[0], series.score[1]];
  score[deal.winner] += 1;
  const needed = dealsNeededToWin(series.bestOf);
  return {
    ...series,
    deals: [...series.deals, { ...deal, number: series.deals.length + 1 }],
    score,
    nextDealer: nextSeat(series.nextDealer),
    winner: score[deal.winner] >= needed ? deal.winner : null,
  };
}

/** Public tables: a rematch is a fresh series with the same seats and teams. */
export function rematch(series: CourtPieceSeries): CourtPieceSeries {
  return createSeries(series.bestOf, series.nextDealer);
}
