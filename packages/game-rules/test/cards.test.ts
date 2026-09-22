import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardId, createDecks, createStandardDeck, shuffle } from '../src/cards.js';
import { GAMES, getGame } from '../src/games.js';
import { isOneEyedJack, isTwoEyedJack } from '../src/sequence.js';

/** Small deterministic random source so shuffle tests are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a standard deck has 52 unique cards', () => {
  const deck = createStandardDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(cardId)).size, 52);
});

test('createDecks(2) has 104 cards and rejects bad counts', () => {
  assert.equal(createDecks(2).length, 104);
  assert.throws(() => createDecks(0), RangeError);
});

test('shuffle keeps every card, changes order, and does not mutate input', () => {
  const deck = createStandardDeck();
  const before = deck.map(cardId).join(',');
  const shuffled = shuffle(deck, seeded(42));
  assert.equal(deck.map(cardId).join(','), before, 'input must be untouched');
  assert.equal(shuffled.length, 52);
  assert.deepEqual(shuffled.map(cardId).sort(), deck.map(cardId).sort());
  assert.notEqual(shuffled.map(cardId).join(','), before);
});

test('shuffle is deterministic for the same random source', () => {
  const a = shuffle(createStandardDeck(), seeded(7)).map(cardId);
  const b = shuffle(createStandardDeck(), seeded(7)).map(cardId);
  assert.deepEqual(a, b);
});

test('Sequence jack helpers', () => {
  assert.equal(isOneEyedJack({ rank: 'J', suit: 'spades' }), true);
  assert.equal(isOneEyedJack({ rank: 'J', suit: 'hearts' }), true);
  assert.equal(isTwoEyedJack({ rank: 'J', suit: 'diamonds' }), true);
  assert.equal(isTwoEyedJack({ rank: 'J', suit: 'clubs' }), true);
  assert.equal(isOneEyedJack({ rank: 'J', suit: 'clubs' }), false);
  assert.equal(isTwoEyedJack({ rank: 'Q', suit: 'clubs' }), false);
});

test('game catalogue lists both launch games', () => {
  assert.deepEqual(
    GAMES.map((g) => g.id),
    ['sequence', 'court_piece'],
  );
  assert.equal(getGame('court_piece').maxPlayers, 4);
  assert.throws(() => getGame('nope' as never));
});
