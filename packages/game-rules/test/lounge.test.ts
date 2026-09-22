import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOUNGE_CODE_ALPHABET,
  LOUNGE_CODE_LENGTH,
  LOUNGE_LEAVE_CODES,
  LOUNGE_SIZE,
  canStartLounge,
  formatsForLounge,
  generateLoungeCode,
  isLoungeFormat,
  isTeamGame,
  loungeLeaveReason,
  normalizeLoungeCode,
  seatsForLounge,
  toLoungeSnapshot,
} from '../src/lounge.js';

test('a lounge code is a player code: the safe alphabet, eight characters', () => {
  assert.equal(LOUNGE_SIZE, 4);
  for (let i = 0; i < 200; i++) {
    const code = generateLoungeCode();
    assert.equal(code.length, LOUNGE_CODE_LENGTH);
    for (const ch of code) {
      assert.ok(LOUNGE_CODE_ALPHABET.includes(ch), `bad char ${ch}`);
    }
  }
  assert.equal(generateLoungeCode(() => 0), 'AAAAAAAA');
});

test('normalizeLoungeCode accepts sloppy input and rejects junk', () => {
  assert.equal(normalizeLoungeCode(' k7pm 3xab '), 'K7PM3XAB');
  assert.equal(normalizeLoungeCode('K7PM-3XAB'), 'K7PM3XAB');
  assert.equal(normalizeLoungeCode('K7PM3X'), null, 'too short');
  assert.equal(normalizeLoungeCode('K7PM30AB'), null, 'zero is not in the alphabet');
  assert.equal(normalizeLoungeCode(12345678), null);
});

test('the picker only offers formats that seat everyone in the lounge', () => {
  assert.deepEqual(formatsForLounge(1).map((f) => `${f.game}:${f.players}`), ['fiverow:2', 'fiverow:3', 'fiverow:4', 'courtpiece:4']);
  assert.deepEqual(formatsForLounge(3).map((f) => `${f.game}:${f.players}`), ['fiverow:3', 'fiverow:4', 'courtpiece:4']);
  assert.deepEqual(formatsForLounge(4).map((f) => `${f.game}:${f.players}`), ['fiverow:4', 'courtpiece:4']);
  assert.equal(isLoungeFormat('courtpiece', 3), false);
  assert.equal(isLoungeFormat('fiverow', 3), true);
});

test('canStartLounge needs an open lounge, a full format, and everyone ready', () => {
  assert.equal(canStartLounge([{ ready: true }], 'open', 'fiverow', 2), false, 'a seat is still empty');
  assert.equal(canStartLounge([{ ready: true }, { ready: false }], 'open', 'fiverow', 2), false, 'not all ready');
  assert.equal(canStartLounge([{ ready: true }, { ready: true }], 'starting', 'fiverow', 2), false, 'already starting');
  assert.equal(canStartLounge([{ ready: true }, { ready: true }], 'open', 'fiverow', 2), true);
  const three = [{ ready: true, team: 0 }, { ready: true, team: 1 }, { ready: true, team: 0 }];
  assert.equal(canStartLounge(three, 'open', 'courtpiece', 4), false, 'Court Piece needs four');
  assert.equal(canStartLounge(three, 'open', 'fiverow', 3), true, 'three players: solo game, teams ignored');
});

test('team games need two on each side, and partners are seated opposite', () => {
  const lopsided = [{ ready: true, team: 0 }, { ready: true, team: 0 }, { ready: true, team: 0 }, { ready: true, team: 1 }];
  const balanced = [{ ready: true, team: 0 }, { ready: true, team: 1 }, { ready: true, team: 1 }, { ready: true, team: 0 }];
  assert.equal(canStartLounge(lopsided, 'open', 'courtpiece', 4), false);
  assert.equal(canStartLounge(balanced, 'open', 'courtpiece', 4), true);
  assert.equal(canStartLounge(lopsided, 'open', 'fiverow', 4), false, 'four in Five Row is 2 vs 2');
  assert.equal(isTeamGame('fiverow', 2), false);

  const members = [
    { sessionId: 'a', team: 0 },
    { sessionId: 'b', team: 1 },
    { sessionId: 'c', team: 1 },
    { sessionId: 'd', team: 0 },
  ];
  const seats = seatsForLounge(members, 'courtpiece', 4);
  assert.deepEqual([...seats.entries()], [['a', 0], ['b', 1], ['c', 3], ['d', 2]], 'team 0 at 0 and 2, team 1 at 1 and 3');
  const solo = seatsForLounge(members.slice(0, 3), 'fiverow', 3);
  assert.deepEqual([...solo.values()], [0, 1, 2], 'solo games seat in join order');
});

test('toLoungeSnapshot marks the leader, lists who is at the door, and counts empty seats', () => {
  const members = new Map([
    ['L', { name: 'Zain', ready: true, team: 0 }],
    ['M', { name: 'Friend', ready: true, team: 1 }],
  ]);
  const requests = new Map([['R', { name: 'Ali' }]]);
  const snap = toLoungeSnapshot({ code: 'K7PM3XAB', leaderSessionId: 'L', status: 'open', game: 'fiverow', players: 2, variant: 'single_siri', bestOf: 1, entry: 500, members, requests });
  assert.deepEqual(snap.members, [
    { sessionId: 'L', name: 'Zain', ready: true, isLeader: true, team: 0 },
    { sessionId: 'M', name: 'Friend', ready: true, isLeader: false, team: 1 },
  ]);
  assert.deepEqual(snap.requests, [{ sessionId: 'R', name: 'Ali' }]);
  assert.equal(snap.canStart, true);
  assert.equal(snap.seatsToFill, 0);
  const bigger = toLoungeSnapshot({ code: 'K7PM3XAB', leaderSessionId: 'L', status: 'open', game: 'courtpiece', players: 4, variant: 'single_siri', bestOf: 1, entry: 0, members, requests });
  assert.equal(bigger.canStart, false);
  assert.equal(bigger.seatsToFill, 2);
});

test('the lounge explains why it closed the door', () => {
  assert.match(loungeLeaveReason(LOUNGE_LEAVE_CODES.kicked) ?? '', /removed/);
  assert.match(loungeLeaveReason(LOUNGE_LEAVE_CODES.declined) ?? '', /let you in/);
  assert.match(loungeLeaveReason(LOUNGE_LEAVE_CODES.timedOut) ?? '', /in time/);
  assert.equal(loungeLeaveReason(1000), null);
});
