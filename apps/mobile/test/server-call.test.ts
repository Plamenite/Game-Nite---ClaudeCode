import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callWithTimeout, isNetworkFailure } from '../src/lib/server-call';

const options = { timeoutMs: 60, unreachable: "Can't reach the game server at 192.168.1.20:2567." };
const never = () => new Promise<never>(() => {});

test('a server that never answers gives a clear message instead of spinning forever', async () => {
  let aborted = false;
  await assert.rejects(
    callWithTimeout((signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return never();
    }, options),
    /Can't reach the game server at 192\.168\.1\.20:2567/,
  );
  assert.equal(aborted, true, 'the request itself is cancelled');
});

test('a refused connection gets the same helpful message; real server errors pass through', async () => {
  await assert.rejects(callWithTimeout(() => Promise.reject(new TypeError('Network request failed')), options), /Can't reach the game server/);
  await assert.rejects(callWithTimeout(() => Promise.reject(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })), options), /Can't reach the game server/);
  await assert.rejects(callWithTimeout(() => Promise.reject(new Error('You need 500 coins for this table. You have 300.')), options), /need 500 coins/);
  assert.equal(isNetworkFailure(new Error('daily bonus already claimed today')), false);
});

test('an answer in time passes straight through', async () => {
  assert.deepEqual(await callWithTimeout(async () => ({ data: { balance: 1000 } }), options), { data: { balance: 1000 } });
});

test('a room that connects after we gave up is left at once, never half-joined', async () => {
  let left = false;
  const lateRoom = new Promise<{ leave: () => Promise<void> }>((resolve) =>
    setTimeout(() => resolve({ leave: async () => { left = true; } }), 120),
  );
  await assert.rejects(callWithTimeout(() => lateRoom, options), /Can't reach/);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(left, true);
});
