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
    ['L', { name: 'Zain', ready: true, team: 0 }],
    ['M', { name: 'Friend', ready: true, team: 1 }],
  ]);
  const snap = toPartySnapshot({ code: 'K7PM3X', leaderSessionId: 'L', status: 'open', game: 'fiverow', variant: 'single_siri', bestOf: 1, members });
  assert.deepEqual(snap.members, [
    { sessionId: 'L', name: 'Zain', ready: true, isLeader: true, team: 0 },
    { sessionId: 'M', name: 'Friend', ready: true, isLeader: false, team: 1 },
  ]);
  assert.equal(snap.canLaunch, true);
});

test('a party must have exactly four members to launch Court Piece', async () => {
  const { canLaunchParty, partySizeAllowed } = await import('../src/party.js');
  assert.equal(partySizeAllowed('courtpiece', 3), false);
  assert.equal(partySizeAllowed('courtpiece', 4), true);
  assert.equal(partySizeAllowed('fiverow', 5), false);
  const three = [{ ready: true, team: 0 }, { ready: true, team: 1 }, { ready: true, team: 0 }];
  assert.equal(canLaunchParty(three, 'open', 'courtpiece'), false);
  assert.equal(canLaunchParty(three, 'open', 'fiverow'), true, 'three players: solo game, teams ignored');
});

test('team games need two on each side, and partners are seated opposite', async () => {
  const { canLaunchParty, seatsForParty, isTeamGame } = await import('../src/party.js');
  const lopsided = [{ ready: true, team: 0 }, { ready: true, team: 0 }, { ready: true, team: 0 }, { ready: true, team: 1 }];
  const balanced = [{ ready: true, team: 0 }, { ready: true, team: 1 }, { ready: true, team: 1 }, { ready: true, team: 0 }];
  assert.equal(canLaunchParty(lopsided, 'open', 'courtpiece'), false);
  assert.equal(canLaunchParty(balanced, 'open', 'courtpiece'), true);
  assert.equal(canLaunchParty(lopsided, 'open', 'fiverow'), false, 'four in Five Row is 2 vs 2');
  assert.equal(isTeamGame('fiverow', 2), false);

  const members = [
    { sessionId: 'a', team: 0 },
    { sessionId: 'b', team: 1 },
    { sessionId: 'c', team: 1 },
    { sessionId: 'd', team: 0 },
  ];
  const seats = seatsForParty(members, 'courtpiece');
  assert.deepEqual([...seats.entries()], [['a', 0], ['b', 1], ['c', 3], ['d', 2]], 'team 0 at 0 and 2, team 1 at 1 and 3');
  const solo = seatsForParty(members.slice(0, 3), 'fiverow');
  assert.deepEqual([...solo.values()], [0, 1, 2], 'solo games seat in join order');
});
