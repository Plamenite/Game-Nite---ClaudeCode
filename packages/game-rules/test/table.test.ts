import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROOMS, sanitizeDisplayName } from '../src/table.js';

test('room names are stable strings', () => {
  assert.deepEqual(ROOMS, { lounge: 'lounge', fiverow: 'fiverow', courtpiece: 'courtpiece' });
});

test('sanitizeDisplayName strips junk, trims, limits length, and falls back', () => {
  assert.equal(sanitizeDisplayName('  Zain  '), 'Zain');
  assert.equal(sanitizeDisplayName('<script>x</script>'), 'scriptxscript');
  assert.equal(sanitizeDisplayName('a'.repeat(40)).length, 16);
  assert.equal(sanitizeDisplayName(''), 'Guest');
  assert.equal(sanitizeDisplayName(42), 'Guest');
  assert.equal(sanitizeDisplayName('Ali Raza_1'), 'Ali Raza_1');
});

test('empty names fall back, and a guest gets a random player number', async () => {
  const { randomPlayerName, sanitizeDisplayName } = await import('../src/table.js');
  assert.equal(sanitizeDisplayName('', 16, ''), '');
  assert.equal(sanitizeDisplayName('  Zain   Ahmed  '), 'Zain Ahmed');
  assert.equal(sanitizeDisplayName('x'.repeat(40)).length, 16);
  assert.match(randomPlayerName(), /^Player \d{5}$/);
  assert.equal(randomPlayerName(() => 0), 'Player 00000');
  assert.equal(randomPlayerName(() => 0.999999), 'Player 99999');
});
