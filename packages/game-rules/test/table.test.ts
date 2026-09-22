import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROOMS, sanitizeDisplayName } from '../src/table.js';

test('room names are stable strings', () => {
  assert.deepEqual(ROOMS, { party: 'party', fiverow: 'fiverow', courtpiece: 'courtpiece' });
});

test('sanitizeDisplayName strips junk, trims, limits length, and falls back', () => {
  assert.equal(sanitizeDisplayName('  Zain  '), 'Zain');
  assert.equal(sanitizeDisplayName('<script>x</script>'), 'scriptxscript');
  assert.equal(sanitizeDisplayName('a'.repeat(40)).length, 16);
  assert.equal(sanitizeDisplayName(''), 'Guest');
  assert.equal(sanitizeDisplayName(42), 'Guest');
  assert.equal(sanitizeDisplayName('Ali Raza_1'), 'Ali Raza_1');
});
