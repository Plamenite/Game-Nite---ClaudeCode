import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitizeDisplayName, toTableSnapshot } from '../src/table.js';

test('toTableSnapshot copies live state into plain data in join order', () => {
  const players = new Map([
    ['s1', { name: 'Zain', score: 2 }],
    ['s2', { name: 'Guest', score: 0 }],
  ]);
  const snapshot = toTableSnapshot({ players, currentTurn: 's2', turnCount: 3, turnDeadline: 99 });
  assert.deepEqual(snapshot, {
    players: [
      { sessionId: 's1', name: 'Zain', score: 2 },
      { sessionId: 's2', name: 'Guest', score: 0 },
    ],
    currentTurn: 's2',
    turnCount: 3,
    turnDeadline: 99,
  });
});

test('sanitizeDisplayName strips junk, trims, limits length, and falls back', () => {
  assert.equal(sanitizeDisplayName('  Zain  '), 'Zain');
  assert.equal(sanitizeDisplayName('<script>x</script>'), 'scriptxscript');
  assert.equal(sanitizeDisplayName('a'.repeat(40)).length, 16);
  assert.equal(sanitizeDisplayName(''), 'Guest');
  assert.equal(sanitizeDisplayName(42), 'Guest');
  assert.equal(sanitizeDisplayName('Ali Raza_1'), 'Ali Raza_1');
});
