import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardId, type Card, type Suit } from '../src/cards.js';
import {
  IllegalPlayError,
  chooseTrump,
  createCourtPieceMatch,
  legalPlaysFor,
  playCard,
  viewForSeat,
  type CourtPieceMatch,
} from '../src/court-piece-match.js';
import { legalPlays, trickWinner } from '../src/court-piece-rules.js';
import { COURT_PIECE_VARIANTS, nextSeat, partnerOf, rankValue, seatTeam } from '../src/court-piece.js';

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
  assert.deepEqual(COURT_PIECE_VARIANTS.map((v) => v.id), ['single_siri', 'double_siri', 'blind_rang']);
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

// ---------------------------------------------------------------- deal and trump

test('the caller sees five cards, names trump, then everyone has thirteen', () => {
  const match = createCourtPieceMatch(2, { variant: 'single_siri' }, fixedRandom);
  assert.equal(match.caller, 3, 'player to the dealer\'s right');
  assert.equal(match.phase, 'choosing_trump');
  assert.deepEqual(match.hands.map((h) => h.length), [5, 5, 5, 5]);
  assert.equal(match.undealt.length, 32);
  assert.deepEqual(legalPlaysFor(match, 3), [], 'nobody plays before trump');

  assert.throws(() => chooseTrump(match, 0, 'hearts'), IllegalPlayError, 'only the caller');
  const playing = chooseTrump(match, 3, 'hearts');
  assert.equal(playing.trump, 'hearts');
  assert.equal(playing.phase, 'playing');
  assert.deepEqual(playing.hands.map((h) => h.length), [13, 13, 13, 13]);
  assert.equal(playing.undealt.length, 0);
  assert.equal(playing.current, 3, 'the caller leads');
  assert.equal(match.phase, 'choosing_trump', 'input untouched');

  const view = viewForSeat(playing, 0);
  assert.equal(view.hand.length, 13);
  assert.deepEqual(view.handCounts, [13, 13, 13, 13]);
});

// ---------------------------------------------------------------- playing helpers

/** Deal a rigged hand so tests can script tricks. Seat 0 leads. */
function rigged(variant: CourtPieceMatch['settings']['variant'], hands: Card[][], trump: Suit | null, opts: { tricksToWin?: number } = {}): CourtPieceMatch {
  const base = createCourtPieceMatch(3, { variant, tricksToWin: opts.tricksToWin }, fixedRandom);
  return {
    ...base,
    phase: 'playing',
    hands: hands.map((h) => h.slice()),
    undealt: [],
    trump,
    caller: 0,
    current: 0,
  };
}

/** Play one full trick: each seat plays the given card, in seat order from the leader. */
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

test('turn order, follow-suit enforcement, and refusing out-of-turn plays', () => {
  const hands = [
    [c('A', 'spades'), c('2', 'hearts')],
    [c('K', 'spades'), c('3', 'hearts')],
    [c('4', 'hearts'), c('5', 'hearts')],
    [c('Q', 'spades'), c('6', 'hearts')],
  ];
  const match = rigged('single_siri', hands, 'diamonds');
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
});

test('single siri: the first team to the target wins; taking everything is a kot', () => {
  // Team 0 (seats 0 and 2) holds every spade and leads them; trump is spades.
  const spades: Card['rank'][] = ['A', 'K', 'Q', 'J', '10', '9', '8'];
  const hands: Card[][] = [[], [], [], []];
  spades.forEach((rank, i) => {
    hands[0].push(c(rank, 'spades'));
    hands[1].push(c(['2', '3', '4', '5', '6', '7', '8'][i] as Card['rank'], 'hearts'));
    hands[2].push(c(['2', '3', '4', '5', '6', '7', '8'][i] as Card['rank'], 'diamonds'));
    hands[3].push(c(['2', '3', '4', '5', '6', '7', '8'][i] as Card['rank'], 'clubs'));
  });
  let match = rigged('single_siri', hands, 'spades', { tricksToWin: 7 });
  for (let i = 0; i < 7; i++) {
    const { match: m, result } = playTrick(match, [hands[0][i], hands[1][i], hands[2][i], hands[3][i]]);
    match = m;
    assert.equal(result.trick?.winner, 0);
  }
  assert.equal(match.phase, 'finished');
  assert.equal(match.winner, 0);
  assert.equal(match.kot, true, 'seven straight with nothing for the other side');
  assert.deepEqual(legalPlaysFor(match, 0), [], 'no more play');
});

test('double siri: tricks pile up; the same player twice in a row collects the pile (not after tricks 1 or 2)', () => {
  // Seat 0 wins trick 1 and 2 with top spades (no collection yet), seat 1 wins 3, seat 0 wins 4 and 5 (collects on 5).
  const hands: Card[][] = [
    [c('A', 'spades'), c('K', 'spades'), c('2', 'hearts'), c('Q', 'spades'), c('J', 'spades')],
    [c('3', 'clubs'), c('4', 'clubs'), c('A', 'hearts'), c('5', 'clubs'), c('6', 'clubs')],
    [c('3', 'diamonds'), c('4', 'diamonds'), c('5', 'hearts'), c('5', 'diamonds'), c('6', 'diamonds')],
    [c('7', 'clubs'), c('8', 'clubs'), c('6', 'hearts'), c('9', 'clubs'), c('10', 'clubs')],
  ];
  let match = rigged('double_siri', hands, 'spades');

  let r = playTrick(match, [c('A', 'spades'), c('3', 'clubs'), c('3', 'diamonds'), c('7', 'clubs')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.equal(match.heap, 1);
  assert.deepEqual(match.collected, [0, 0]);

  r = playTrick(match, [c('K', 'spades'), c('4', 'clubs'), c('4', 'diamonds'), c('8', 'clubs')]);
  match = r.match;
  assert.equal(match.heap, 2, 'two in a row, but never after trick 2');
  assert.deepEqual(match.collected, [0, 0]);

  // Seat 0 leads a low heart; seat 1 takes it with the ace.
  r = playTrick(match, [c('2', 'hearts'), c('A', 'hearts'), c('5', 'hearts'), c('6', 'hearts')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 1);
  assert.equal(match.heap, 3);
  assert.equal(match.current, 1);

  // Seat 1 leads clubs; seat 0 trumps and wins trick 4, then trick 5: collects all five.
  r = playTrick(match, [c('5', 'clubs'), c('5', 'diamonds'), c('9', 'clubs'), c('Q', 'spades')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.equal(match.heap, 4);
  r = playTrick(match, [c('J', 'spades'), c('6', 'clubs'), c('6', 'diamonds'), c('10', 'clubs')]);
  match = r.match;
  assert.equal(r.result.trick?.winner, 0);
  assert.deepEqual(r.result.collectedBy, { team: 0, count: 5 });
  assert.equal(match.heap, 0);
  assert.deepEqual(match.collected, [5, 0]);
});

test('blind rang: no trump until someone cannot follow suit; that card sets it', () => {
  const match = createCourtPieceMatch(0, { variant: 'blind_rang' }, fixedRandom);
  assert.equal(match.phase, 'playing', 'no calling phase');
  assert.equal(match.trump, null);
  assert.deepEqual(match.hands.map((h) => h.length), [13, 13, 13, 13]);

  const hands: Card[][] = [
    [c('9', 'hearts'), c('2', 'clubs')],
    [c('K', 'hearts'), c('3', 'clubs')],
    [c('4', 'diamonds'), c('5', 'clubs')], // no hearts: the diamond will set trump
    [c('10', 'hearts'), c('6', 'clubs')],
  ];
  let m = rigged('blind_rang', hands, null);
  m = playCard(m, 0, c('9', 'hearts')).match;
  m = playCard(m, 1, c('K', 'hearts')).match;
  const cut = playCard(m, 2, c('4', 'diamonds'));
  assert.equal(cut.trumpSetTo, 'diamonds');
  assert.equal(cut.match.trump, 'diamonds');
  const done = playCard(cut.match, 3, c('10', 'hearts'));
  assert.equal(done.trick?.winner, 2, 'the fresh trump takes the trick');
});
