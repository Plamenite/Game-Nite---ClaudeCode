import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardId, type Card, type Suit } from '../src/cards.js';
import {
  IllegalPlayError,
  createCourtPieceMatch,
  isOpeningPlay,
  legalPlaysFor,
  playCard,
  viewForSeat,
  type CourtPieceMatch,
} from '../src/court-piece-match.js';
import { createSeries, recordDeal, rematch } from '../src/court-piece-series.js';
import { legalPlays, trickWinner } from '../src/court-piece-rules.js';
import {
  COURT_PIECE_PRIVATE_BEST_OF,
  COURT_PIECE_PUBLIC_BEST_OF,
  COURT_PIECE_VARIANTS,
  OPENING_CARD,
  classifyDeal,
  dealsNeededToWin,
  nextSeat,
  partnerOf,
  rankValue,
  seatTeam,
} from '../src/court-piece.js';

const c = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });
const fixedRandom = () => 0.5;

// ---------------------------------------------------------------- facts

test('ranking is ace high; partners sit opposite; play goes round in order', () => {
  assert.ok(rankValue(c('A', 'spades')) > rankValue(c('K', 'spades')));
  assert.ok(rankValue(c('10', 'hearts')) > rankValue(c('9', 'hearts')));
  assert.ok(rankValue(c('2', 'clubs')) < rankValue(c('3', 'clubs')));
  assert.deepEqual([0, 1, 2, 3].map(seatTeam), [0, 1, 0, 1]);
  assert.equal(partnerOf(1), 3);
  assert.equal(nextSeat(3), 0);
  assert.deepEqual(COURT_PIECE_VARIANTS.map((v) => v.id), ['single_siri', 'double_siri']);
  assert.deepEqual(COURT_PIECE_PRIVATE_BEST_OF, [1, 3, 5]);
  assert.equal(COURT_PIECE_PUBLIC_BEST_OF, 1);
});

test('deal results: win, kot by the trump-setting team, goon kot by the other team', () => {
  assert.deepEqual(classifyDeal([7, 6], 1), { winner: 0, result: 'win' });
  assert.deepEqual(classifyDeal([13, 0], 0), { winner: 0, result: 'kot' });
  assert.deepEqual(classifyDeal([13, 0], 1), { winner: 0, result: 'goon_kot' });
  assert.deepEqual(classifyDeal([0, 13], 1), { winner: 1, result: 'kot' });
  assert.deepEqual(classifyDeal([13, 0], null), { winner: 0, result: 'kot' }, 'nobody ever cut');
});

// ---------------------------------------------------------------- trick rules

test('you must follow suit when you can', () => {
  const hand = [c('A', 'spades'), c('4', 'hearts'), c('9', 'spades')];
  assert.deepEqual(legalPlays(hand, 'spades').map(cardId), ['A-spades', '9-spades']);
  assert.deepEqual(legalPlays(hand, 'clubs').map(cardId), hand.map(cardId), 'cannot follow: anything goes');
  assert.deepEqual(legalPlays(hand, null).map(cardId), hand.map(cardId), 'leading: anything goes');
});

test('trick winner: highest of led suit, unless trumped; highest trump wins', () => {
  const plays = [
    { seat: 0, card: c('9', 'hearts') },
    { seat: 1, card: c('K', 'hearts') },
    { seat: 2, card: c('A', 'clubs') }, // off-suit, not trump: worthless
    { seat: 3, card: c('10', 'hearts') },
  ];
  assert.equal(trickWinner(plays, 'spades'), 1);
  assert.equal(trickWinner(plays, null), 1, 'no trump yet: led suit decides');

  const trumped = [
    { seat: 0, card: c('A', 'hearts') },
    { seat: 1, card: c('2', 'spades') },
    { seat: 2, card: c('K', 'hearts') },
    { seat: 3, card: c('5', 'spades') },
  ];
  assert.equal(trickWinner(trumped, 'spades'), 3, 'highest trump beats the ace of the led suit');
});

// ---------------------------------------------------------------- deal

test('everyone gets thirteen cards, nobody calls trump, and the two of clubs opens', () => {
  const match = createCourtPieceMatch(2, { variant: 'single_siri' }, fixedRandom);
  assert.equal(match.phase, 'playing');
  assert.equal(match.trump, null);
  assert.equal(match.trumpSetter, null);
  assert.deepEqual(match.hands.map((h) => h.length), [13, 13, 13, 13]);
  const all = new Set(match.hands.flat().map(cardId));
  assert.equal(all.size, 52, 'every card dealt exactly once');

  const holder = match.hands.findIndex((h) => h.some((x) => cardId(x) === cardId(OPENING_CARD)));
  assert.equal(match.leader, holder, 'whoever holds the two of clubs leads');
  assert.equal(match.current, holder);
  assert.ok(isOpeningPlay(match));
  assert.deepEqual(legalPlaysFor(match, holder).map(cardId), ['2-clubs'], 'and must open with it');
  assert.deepEqual(legalPlaysFor(match, nextSeat(holder)), [], 'not the leader');

  const opened = playCard(match, holder, OPENING_CARD).match;
  assert.equal(isOpeningPlay(opened), false);
  assert.equal(legalPlaysFor(opened, nextSeat(holder)).length > 0, true);

  const view = viewForSeat(match, 0);
  assert.equal(view.hand.length, 13);
  assert.deepEqual(view.handCounts, [13, 13, 13, 13]);
});

// ---------------------------------------------------------------- helpers

/** A match with scripted hands. Seat 0 leads. Trump may be preset for late-deal tests. */
function rigged(
  variant: CourtPieceMatch['settings']['variant'],
  hands: Card[][],
  trump: Suit | null = null,
  trumpSetter: number | null = null,
): CourtPieceMatch {
  const base = createCourtPieceMatch(3, { variant }, fixedRandom);
  // Scripted deals skip the two-of-clubs opening rule.
  return { ...base, hands: hands.map((h) => h.slice()), trump, trumpSetter, lastTrickAfterTrump: trump !== null, leader: 0, current: 0, opened: true };
}

/** Play one full trick: each seat in turn plays the given card, starting from whoever leads. */
function playTrick(match: CourtPieceMatch, cards: Card[]) {
  let m = match;
  let last;
  let seat = m.current;
  for (const card of cards) {
    last = playCard(m, seat, card);
    m = last.match;
    seat = nextSeat(seat);
  }
  return { match: m, result: last! };
}

const OFF = (i: number): Card['rank'] => (['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const)[i];

// ---------------------------------------------------------------- play

test('turn order, follow-suit enforcement, and refusing out-of-turn plays', () => {
  const hands = [
    [c('A', 'spades'), c('2', 'hearts')],
    [c('K', 'spades'), c('3', 'hearts')],
    [c('4', 'hearts'), c('5', 'hearts')],
    [c('Q', 'spades'), c('6', 'hearts')],
  ];
  const match = rigged('single_siri', hands, 'diamonds', 1);
  assert.throws(() => playCard(match, 1, c('K', 'spades')), IllegalPlayError, 'not your turn');

  const after0 = playCard(match, 0, c('A', 'spades')).match;
  assert.equal(after0.current, 1);
  assert.throws(() => playCard(after0, 1, c('3', 'hearts')), IllegalPlayError, 'must follow spades');
  const after1 = playCard(after0, 1, c('K', 'spades')).match;
  const after2 = playCard(after1, 2, c('4', 'hearts')).match; // no spades: free
  const result = playCard(after2, 3, c('Q', 'spades'));
  const done = result.match;
  assert.equal(result.trick?.winner, 0);
  assert.equal(done.current, 0, 'winner leads next');
  assert.deepEqual(done.collected, [1, 0], 'single siri: straight to the team');
  assert.equal(done.trick.length, 0);
  assert.equal(match.trick.length, 0, 'input untouched');
});

test('the first card that cannot follow suit sets the trump and wins that trick', () => {
  const hands: Card[][] = [
    [c('9', 'hearts'), c('2', 'clubs')],
    [c('K', 'hearts'), c('3', 'clubs')],
    [c('4', 'diamonds'), c('5', 'clubs')], // no hearts: the diamond will set trump
    [c('10', 'hearts'), c('6', 'clubs')],
  ];
  let m = rigged('single_siri', hands);
  m = playCard(m, 0, c('9', 'hearts')).match;
  m = playCard(m, 1, c('K', 'hearts')).match;
  assert.equal(m.trump, null, 'following suit never sets trump');
  const cut = playCard(m, 2, c('4', 'diamonds'));
  assert.equal(cut.trumpSetTo, 'diamonds');
  assert.equal(cut.match.trump, 'diamonds');
  assert.equal(cut.match.trumpSetter, 2);
  const done = playCard(cut.match, 3, c('10', 'hearts'));
  assert.equal(done.trick?.winner, 2, 'the fresh trump takes the trick');
});

/**
 * Team 0 holds every spade (trump) and every diamond; team 1 holds only
 * hearts and clubs. Team 0 leads and wins all thirteen tricks.
 */
function allSpadesDeal(variant: CourtPieceMatch['settings']['variant'], trumpSetter: number) {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 13; i++) {
    hands[i < 7 ? 0 : 2].push(c(OFF(i), 'spades'));
    hands[i < 6 ? 0 : 2].push(c(OFF(i), 'diamonds'));
    hands[1].push(c(OFF(i), 'hearts'));
    hands[3].push(c(OFF(i), 'clubs'));
  }
  assert.deepEqual(hands.map((h) => h.length), [13, 13, 13, 13]);
  return rigged(variant, hands, 'spades', trumpSetter);
}

/** Play out a deal card by card, always choosing the first legal card (a spade when allowed). */
function playOut(match: CourtPieceMatch) {
  let m = match;
  const results = [];
  while (m.phase === 'playing') {
    const legal = legalPlaysFor(m, m.current);
    const card = legal.find((x) => x.suit === 'spades') ?? legal[0];
    const r = playCard(m, m.current, card);
    m = r.match;
    if (r.trick) results.push(r);
  }
  return { match: m, results };
}

test('a deal runs all thirteen tricks; the winner is known at seven; all thirteen is a kot or a goon kot', () => {
  let { match, results } = playOut(allSpadesDeal('single_siri', 0));
  assert.equal(results[6].match.winner, 0, 'decided at the seventh trick');
  assert.equal(results[6].match.phase, 'playing', 'but the deal continues');
  assert.equal(match.phase, 'finished');
  assert.deepEqual(match.collected, [13, 0]);
  assert.equal(match.result, 'kot', 'the trump-setting team took everything');

  ({ match } = playOut(allSpadesDeal('single_siri', 1)));
  assert.equal(match.result, 'goon_kot', 'the other team took everything');
  assert.deepEqual(legalPlaysFor(match, 0), [], 'no more play');
});

test('double siri: tricks pile up; the same player twice in a row collects (not after tricks 1 or 2)', () => {
  const hands: Card[][] = [
    [c('A', 'spades'), c('K', 'spades'), c('2', 'hearts'), c('Q', 'spades'), c('J', 'spades')],
    [c('3', 'clubs'), c('4', 'clubs'), c('A', 'hearts'), c('5', 'clubs'), c('6', 'clubs')],
    [c('3', 'diamonds'), c('4', 'diamonds'), c('5', 'hearts'), c('5', 'diamonds'), c('6', 'diamonds')],
    [c('7', 'clubs'), c('8', 'clubs'), c('6', 'hearts'), c('9', 'clubs'), c('10', 'clubs')],
  ];
  let match = rigged('double_siri', hands, 'spades', 0);

  let r = playTrick(match, [c('A', 'spades'), c('3', 'clubs'), c('3', 'diamonds'), c('7', 'clubs')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.equal(match.heap, 1);
  assert.deepEqual(match.collected, [0, 0]);

  r = playTrick(match, [c('K', 'spades'), c('4', 'clubs'), c('4', 'diamonds'), c('8', 'clubs')]);
  match = r.match;
  assert.equal(match.heap, 2, 'two in a row, but never after trick 2');
  assert.deepEqual(match.collected, [0, 0]);

  r = playTrick(match, [c('2', 'hearts'), c('A', 'hearts'), c('5', 'hearts'), c('6', 'hearts')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 1);
  assert.equal(match.heap, 3);

  r = playTrick(match, [c('5', 'clubs'), c('5', 'diamonds'), c('9', 'clubs'), c('Q', 'spades')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.equal(match.heap, 4);
  r = playTrick(match, [c('J', 'spades'), c('6', 'clubs'), c('6', 'diamonds'), c('10', 'clubs')]);
  match = r.match;
  assert.deepEqual(r.result.collectedBy, { team: 0, count: 5 });
  assert.equal(match.heap, 0);
  assert.deepEqual(match.collected, [5, 0]);
});

test('double siri: the winner of the thirteenth trick takes whatever is left', () => {
  const { match } = playOut(allSpadesDeal('double_siri', 0));
  assert.equal(match.phase, 'finished');
  assert.equal(match.heap, 0);
  assert.deepEqual(match.collected, [13, 0], 'every trick ends up with somebody');
  assert.equal(match.result, 'kot');
});

test('double siri: nothing banks before the trump exists; afterwards two in a row banks', () => {
  // Tricks 1-3: seat 0 wins with hearts and everyone follows suit, so no trump exists.
  // Trick 4: seat 0 leads a club; seat 1 cannot follow and cuts with a diamond, setting the trump.
  // Trick 5: seat 1 leads a diamond and wins again: two in a row after trump, banks the pile of 5.
  const hands: Card[][] = [
    [c('A', 'hearts'), c('K', 'hearts'), c('Q', 'hearts'), c('2', 'clubs'), c('3', 'diamonds')],
    [c('2', 'hearts'), c('3', 'hearts'), c('4', 'hearts'), c('A', 'diamonds'), c('K', 'diamonds')],
    [c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts'), c('3', 'clubs'), c('4', 'diamonds')],
    [c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts'), c('4', 'clubs'), c('5', 'diamonds')],
  ];
  let match = rigged('double_siri', hands);

  let r = playTrick(match, [c('A', 'hearts'), c('2', 'hearts'), c('5', 'hearts'), c('8', 'hearts')]);
  match = r.match;
  r = playTrick(match, [c('K', 'hearts'), c('3', 'hearts'), c('6', 'hearts'), c('9', 'hearts')]);
  match = r.match;
  r = playTrick(match, [c('Q', 'hearts'), c('4', 'hearts'), c('7', 'hearts'), c('10', 'hearts')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0, 'seat 0 has won three in a row');
  assert.equal(match.trump, null);
  assert.equal(r.result.collectedBy, undefined, 'no trump yet: nothing banks');
  assert.equal(match.heap, 3);

  r = playTrick(match, [c('2', 'clubs'), c('A', 'diamonds'), c('3', 'clubs'), c('4', 'clubs')]);
  match = r.match;
  assert.equal(match.trump, 'diamonds', 'seat 1 cut and set the trump');
  assert.equal(match.trumpSetter, 1);
  assert.equal(r.result.trick?.winner, 1);
  assert.equal(match.heap, 4, 'first win after trump: not two in a row yet');

  r = playTrick(match, [c('K', 'diamonds'), c('4', 'diamonds'), c('5', 'diamonds'), c('3', 'diamonds')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 1);
  assert.deepEqual(r.result.collectedBy, { team: 1, count: 5 });
  assert.deepEqual(match.collected, [0, 5]);
  assert.equal(match.heap, 0);
});

test('double siri: two consecutive tricks both won with an ace do not bank', () => {
  // Trump preset to spades (set by seat 0 earlier). Seat 0 wins tricks 1-4 in a row:
  // K♥ (trick 1), A♦ (trick 2), A♣ (trick 3: ace after ace, no bank), K♠ trump (trick 4: banks).
  const hands: Card[][] = [
    [c('K', 'hearts'), c('A', 'diamonds'), c('A', 'clubs'), c('K', 'spades')],
    [c('2', 'hearts'), c('2', 'diamonds'), c('2', 'clubs'), c('3', 'hearts')],
    [c('4', 'hearts'), c('4', 'diamonds'), c('4', 'clubs'), c('5', 'hearts')],
    [c('6', 'hearts'), c('6', 'diamonds'), c('6', 'clubs'), c('7', 'hearts')],
  ];
  let match = rigged('double_siri', hands, 'spades', 0);

  let r = playTrick(match, [c('K', 'hearts'), c('2', 'hearts'), c('4', 'hearts'), c('6', 'hearts')]);
  match = r.match;
  r = playTrick(match, [c('A', 'diamonds'), c('2', 'diamonds'), c('4', 'diamonds'), c('6', 'diamonds')]);
  match = r.match;
  assert.equal(match.heap, 2);

  r = playTrick(match, [c('A', 'clubs'), c('2', 'clubs'), c('4', 'clubs'), c('6', 'clubs')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.equal(r.result.collectedBy, undefined, 'ace after ace: the pile stays');
  assert.equal(match.heap, 3);

  r = playTrick(match, [c('K', 'spades'), c('3', 'hearts'), c('5', 'hearts'), c('7', 'hearts')]);
  match = r.match;
  assert.deepEqual(r.result.collectedBy, { team: 0, count: 4 }, 'a non-ace win after an ace win banks');
  assert.deepEqual(match.collected, [4, 0]);
});

// ---------------------------------------------------------------- series

test('series: best of 1, 3 or 5; a kot is one win; the dealer rotates; rematch resets', () => {
  assert.equal(dealsNeededToWin(1), 1);
  assert.equal(dealsNeededToWin(3), 2);
  assert.equal(dealsNeededToWin(5), 3);

  let series = createSeries(3, 0);
  series = recordDeal(series, { winner: 1, result: 'kot', collected: [0, 13] });
  assert.deepEqual(series.score, [0, 1], 'a kot counts once');
  assert.equal(series.nextDealer, 1, 'one seat to the right');
  assert.equal(series.winner, null);
  series = recordDeal(series, { winner: 0, result: 'win', collected: [8, 5] });
  series = recordDeal(series, { winner: 0, result: 'goon_kot', collected: [13, 0] });
  assert.equal(series.winner, 0);
  assert.equal(series.deals.length, 3);
  assert.throws(() => recordDeal(series, { winner: 1, result: 'win', collected: [6, 7] }), /already decided/);

  const again = rematch(series);
  assert.deepEqual(again.score, [0, 0]);
  assert.equal(again.deals.length, 0);
  assert.equal(again.nextDealer, series.nextDealer, 'seats and rotation carry on');
});

test('single siri: tricks wait for the trump; the trick that creates it takes the pile, then every trick banks', () => {
  const hands: Card[][] = [
    [c('A', 'hearts'), c('K', 'hearts'), c('2', 'clubs'), c('3', 'diamonds')],
    [c('2', 'hearts'), c('3', 'hearts'), c('A', 'diamonds'), c('K', 'diamonds')],
    [c('5', 'hearts'), c('6', 'hearts'), c('3', 'clubs'), c('4', 'diamonds')],
    [c('8', 'hearts'), c('9', 'hearts'), c('4', 'clubs'), c('5', 'diamonds')],
  ];
  let match = rigged('single_siri', hands);

  let r = playTrick(match, [c('A', 'hearts'), c('2', 'hearts'), c('5', 'hearts'), c('8', 'hearts')]);
  match = r.match;
  assert.equal(r.result.collectedBy, undefined, 'no trump yet: waits');
  r = playTrick(match, [c('K', 'hearts'), c('3', 'hearts'), c('6', 'hearts'), c('9', 'hearts')]);
  match = r.match;
  assert.equal(match.heap, 2);
  assert.deepEqual(match.collected, [0, 0]);

  // Seat 0 leads a club; seat 1 cuts with a diamond and wins: takes the pile of 3.
  r = playTrick(match, [c('2', 'clubs'), c('A', 'diamonds'), c('3', 'clubs'), c('4', 'clubs')]);
  match = r.match;
  assert.equal(match.trump, 'diamonds');
  assert.deepEqual(r.result.collectedBy, { team: 1, count: 3 });
  assert.deepEqual(match.collected, [0, 3]);

  // From now on every trick banks immediately.
  r = playTrick(match, [c('K', 'diamonds'), c('4', 'diamonds'), c('5', 'diamonds'), c('3', 'diamonds')]);
  match = r.match;
  assert.deepEqual(r.result.collectedBy, { team: 1, count: 1 });
  assert.deepEqual(match.collected, [0, 4]);
});
