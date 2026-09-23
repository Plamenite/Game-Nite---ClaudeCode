import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GAMES } from '../src/games.js';
import { HOW_TO_PLAY, howToPlay } from '../src/how-to-play.js';

const NEVER = /\b(bet|wager|stake|pot|gamble|casino|cash out|jackpot|odds)\b/i;

test('every game in the catalogue has how-to-play text, with a goal and time limits', () => {
  assert.deepEqual(HOW_TO_PLAY.map((h) => h.name).sort(), GAMES.map((g) => g.name).sort());
  for (const h of HOW_TO_PLAY) {
    assert.ok(h.sections.length >= 3, `${h.name} has sections`);
    assert.ok(h.sections.some((s) => s.heading === 'The goal'));
    assert.ok(h.sections.some((s) => s.heading === 'Time limits'));
    for (const s of h.sections) for (const line of s.lines) assert.ok(line.trim().length > 10, `${h.name}: "${line}"`);
  }
  assert.equal(howToPlay('courtpiece').players, '4 players, 2 vs 2');
  assert.throws(() => howToPlay('nope' as never), /no rules/);
});

test('the rules text never uses the trademarked name or gambling words', () => {
  const text = JSON.stringify(HOW_TO_PLAY);
  assert.doesNotMatch(text, /sequence/i);
  assert.doesNotMatch(text, NEVER);
});

test("Court Piece text carries the founder's exact rules", () => {
  const text = JSON.stringify(howToPlay('courtpiece'));
  for (const must of ['2 of Clubs', 'cannot follow suit', 'kot', 'goon kot', 'two in a row', 'tricks 1, 2 or 12', 'Ace right after', '13th trick', 'best of 1, 3 or 5']) {
    assert.ok(text.includes(must), `missing: ${must}`);
  }
});
