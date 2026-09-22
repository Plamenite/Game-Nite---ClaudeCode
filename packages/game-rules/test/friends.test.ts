import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FRIEND_ROUTES, canKnockOn, describeStatus, sortFriends } from '../src/friends.js';

test('friend routes are stable strings', () => {
  assert.deepEqual(FRIEND_ROUTES, { list: '/friends', add: '/friends/add', answer: '/friends/answer', remove: '/friends/remove' });
});

test('a friend can be knocked on only when they are in a lounge other than mine', () => {
  assert.equal(canKnockOn({ status: 'lounge', loungeCode: 'K7PM3XAB' }, 'MYCODE12'), true);
  assert.equal(canKnockOn({ status: 'lounge', loungeCode: 'K7PM3XAB' }, 'K7PM3XAB'), false, 'already together');
  assert.equal(canKnockOn({ status: 'table' }, 'MYCODE12'), false);
  assert.equal(canKnockOn({ status: 'online' }, undefined), false);
  assert.equal(canKnockOn({ status: 'offline' }, undefined), false);
});

test('status lines read naturally', () => {
  assert.equal(describeStatus({ status: 'lounge', loungeCode: 'K7PM3XAB' }, 'MYCODE12'), 'In their lounge');
  assert.equal(describeStatus({ status: 'lounge', loungeCode: 'K7PM3XAB' }, 'K7PM3XAB'), 'In your lounge');
  assert.equal(describeStatus({ status: 'table' }), 'At a table');
  assert.equal(describeStatus({ status: 'online' }), 'Online');
  assert.equal(describeStatus({ status: 'offline' }), 'Offline');
});

test('friends sort by presence, then name', () => {
  const sorted = sortFriends([
    { playerCode: 'A', name: 'Zed', status: 'offline' },
    { playerCode: 'B', name: 'Ali', status: 'table' },
    { playerCode: 'C', name: 'Sara', status: 'lounge', loungeCode: 'X' },
    { playerCode: 'D', name: 'Bilal', status: 'online' },
    { playerCode: 'E', name: 'Aaron', status: 'offline' },
  ]);
  assert.deepEqual(sorted.map((f) => f.name), ['Sara', 'Bilal', 'Ali', 'Aaron', 'Zed']);
});
