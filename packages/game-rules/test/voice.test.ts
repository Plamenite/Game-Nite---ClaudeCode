import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VOICE_FREE_MINUTES_PER_DAY, voiceMinutesLeft, voiceUidFor } from '../src/voice.js';

test('a player always gets the same non-zero 32-bit voice uid', () => {
  const a = voiceUidFor('11111111-1111-4111-8111-111111111111');
  assert.equal(a, voiceUidFor('11111111-1111-4111-8111-111111111111'));
  assert.ok(a > 0 && a <= 0xffffffff);
  assert.notEqual(a, voiceUidFor('guest-ABCD'));
  assert.ok(voiceUidFor('') > 0, 'never zero, which would let Agora pick');
});

test('minutes left never go negative and round up', () => {
  assert.equal(voiceMinutesLeft(0), VOICE_FREE_MINUTES_PER_DAY);
  assert.equal(voiceMinutesLeft(30), VOICE_FREE_MINUTES_PER_DAY);
  assert.equal(voiceMinutesLeft(90), VOICE_FREE_MINUTES_PER_DAY - 1);
  assert.equal(voiceMinutesLeft(VOICE_FREE_MINUTES_PER_DAY * 60 + 500), 0);
});
