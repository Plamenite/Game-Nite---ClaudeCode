import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  canLaunchParty,
  generatePartyCode,
  normalizePartyCode,
  toPartySnapshot,
} from '../src/party.js';

test('generatePartyCode uses only the safe alphabet and the fixed length', () => {
  for (let i = 0; i < 200; i++) {
    const code = generatePartyCode();
    assert.equal(code.length, PARTY_CODE_LENGTH);
    for (const ch of code) {
      assert.ok(PARTY_CODE_ALPHABET.includes(ch), `bad char ${ch}`);
    }
  }
  assert.equal(generatePartyCode(() => 0), 'AAAAAA');
});

test('normalizePartyCode accepts sloppy input and rejects junk', () => {
  assert.equal(normalizePartyCode(' k7p m3x '), 'K7PM3X');
  assert.equal(normalizePartyCode('K7P-M3X'), 'K7PM3X');
  assert.equal(normalizePartyCode('K7PM3'), null, 'too short');
  assert.equal(normalizePartyCode('K7PM30'), null, 'zero is not in the alphabet');
  assert.equal(normalizePartyCode(123456), null);
});

test('canLaunchParty needs an open party, enough members, and everyone ready', () => {
  assert.equal(canLaunchParty([{ ready: true }], 'open'), false, 'alone');
  assert.equal(canLaunchParty([{ ready: true }, { ready: false }], 'open'), false, 'not all ready');
  assert.equal(canLaunchParty([{ ready: true }, { ready: true }], 'launched'), false, 'already launched');
  assert.equal(canLaunchParty([{ ready: true }, { ready: true }], 'open'), true);
});

test('toPartySnapshot marks the leader and computes canLaunch', () => {
  const members = new Map([
    ['L', { name: 'Zain', ready: true }],
    ['M', { name: 'Friend', ready: true }],
  ]);
  const snap = toPartySnapshot({ code: 'K7PM3X', leaderSessionId: 'L', status: 'open', members });
  assert.deepEqual(snap.members, [
    { sessionId: 'L', name: 'Zain', ready: true, isLeader: true },
    { sessionId: 'M', name: 'Friend', ready: true, isLeader: false },
  ]);
  assert.equal(snap.canLaunch, true);
});
