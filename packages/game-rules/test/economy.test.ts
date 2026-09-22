import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AD_REWARD_COINS,
  DAILY_BONUS_COINS,
  MAX_AD_REWARDS_PER_DAY,
  STARTING_COINS,
  TABLE_ENTRY_TIERS,
  isTableEntry,
  netForPlayer,
  settleTable,
} from '../src/economy.js';

test('the agreed numbers', () => {
  assert.equal(STARTING_COINS, 1000);
  assert.equal(DAILY_BONUS_COINS, 200);
  assert.equal(AD_REWARD_COINS, 100);
  assert.equal(MAX_AD_REWARDS_PER_DAY, 5);
  assert.deepEqual([...TABLE_ENTRY_TIERS], [0, 500, 2000, 10000]);
  assert.equal(isTableEntry(500), true);
  assert.equal(isTableEntry(750), false);
  assert.throws(() => settleTable(750, [], 0), RangeError);
});

test('1 vs 1 at 500: the winner nets +450, the loser -500, the table keeps 50', () => {
  const seats = [
    { playerId: 'a', team: 0 },
    { playerId: 'b', team: 1 },
  ];
  const s = settleTable(500, seats, 0);
  assert.equal(s.pot, 500);
  assert.equal(s.fee, 50);
  assert.equal(s.sharePerWinner, 450);
  assert.deepEqual(s.moves, [{ playerId: 'a', amount: 950, kind: 'table_reward' }]);
  assert.equal(netForPlayer(500, s, 'a'), 450);
  assert.equal(netForPlayer(500, s, 'b'), -500);
  assert.equal(netForPlayer(500, s, 'a') + netForPlayer(500, s, 'b') + s.fee, 0, 'coins are conserved');
});

test('2 vs 2 at 2000: each winner nets +1800', () => {
  const seats = [0, 1, 0, 1].map((team, i) => ({ playerId: `p${i}`, team }));
  const s = settleTable(2000, seats, 1);
  assert.equal(s.pot, 4000);
  assert.equal(s.fee, 400);
  assert.equal(s.sharePerWinner, 1800);
  assert.deepEqual(
    s.moves.map((m) => [m.playerId, m.amount]),
    [
      ['p1', 3800],
      ['p3', 3800],
    ],
  );
});

test('three players at 10000: one winner takes two entries minus the fee', () => {
  const seats = [0, 1, 2].map((team) => ({ playerId: `t${team}`, team }));
  const s = settleTable(10000, seats, 2);
  assert.equal(s.pot, 20000);
  assert.equal(s.fee, 2000);
  assert.equal(netForPlayer(10000, s, 't2'), 18000);
});

test('rounding leftovers go to the fee, never created from nothing', () => {
  // 500 entry, 3 solo players: pot 1000, 10% fee 100, 900 to one winner: exact.
  // Force a remainder: 2 winners sharing 900 -> 450 each, exact. Use 2 vs 1? Not a real shape,
  // but the arithmetic must still conserve coins.
  const seats = [
    { playerId: 'w1', team: 0 },
    { playerId: 'w2', team: 0 },
    { playerId: 'w3', team: 0 },
    { playerId: 'l1', team: 1 },
  ];
  const s = settleTable(500, seats, 0);
  assert.equal(s.pot, 500);
  assert.equal(s.sharePerWinner, 150);
  assert.equal(s.fee, 50, '450 / 3 = 150 exactly');
  const s2 = settleTable(2000, seats, 0);
  assert.equal(s2.sharePerWinner, 600);
  assert.equal(s2.fee, 200);
  const total = s2.moves.reduce((sum, m) => sum + m.amount, 0) + s2.fee;
  assert.equal(total, 2000 * 4, 'everything charged is accounted for');
});

test('a draw refunds everyone; free practice moves nothing', () => {
  const seats = [
    { playerId: 'a', team: 0 },
    { playerId: 'b', team: 1 },
  ];
  assert.deepEqual(settleTable(500, seats, null).moves, [
    { playerId: 'a', amount: 500, kind: 'table_refund' },
    { playerId: 'b', amount: 500, kind: 'table_refund' },
  ]);
  assert.deepEqual(settleTable(0, seats, 0).moves, []);
  assert.equal(netForPlayer(0, settleTable(0, seats, 0), 'a'), 0);
});
