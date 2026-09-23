import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The iPhone runs JavaScript on Hermes, which lacks some features Node has.
 * These tests load the game-connection libraries in a Node process with
 * those features removed, the way the phone would, so a library update
 * that needs something Hermes lacks fails here instead of on a phone.
 */
const polyfills = fileURLToPath(new URL('../src/lib/polyfills.ts', import.meta.url));

// Features Hermes (React Native's engine) does not provide. On the phone,
// React Native supplies fetch and WebSocket, and metro.config.js swaps the
// Node-only "ws" package for a stub. Node's versions of those need Buffer,
// so load them first, then take away what the phone lacks.
const REMOVE_HERMES_GAPS = `
  void globalThis.fetch; void globalThis.WebSocket; void globalThis.Headers;
  await import('ws');
  delete globalThis.FinalizationRegistry;
  delete globalThis.structuredClone;
  delete globalThis.TextDecoder;
  delete globalThis.Buffer;
`;

function runLikeThePhone(body: string, withPolyfills: boolean) {
  const script = `
    ${REMOVE_HERMES_GAPS}
    ${withPolyfills ? `await import(${JSON.stringify(polyfills)});` : ''}
    ${body}
  `;
  // Plain Node, no TypeScript loader: loaders use Node-only features we remove.
  // Node reads the stand-in file's TypeScript by itself (type stripping).
  return spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 60_000,
  });
}

const LOAD_AND_DECODE = `
  const { Client } = await import('@colyseus/sdk');
  const { Schema, defineTypes, MapSchema, Encoder, Decoder } = await import('@colyseus/schema');
  new Client('ws://localhost:2567');

  // A tiny state, encoded the way the server does and decoded the way the phone does.
  class Seat extends Schema {}
  defineTypes(Seat, { name: 'string', ready: 'boolean' });
  class State extends Schema {}
  defineTypes(State, { code: 'string', seats: { map: Seat } });
  const server = new State();
  server.code = 'K7PM3XAB';
  server.seats = new MapSchema();
  const seat = new Seat(); seat.name = 'Zain'; seat.ready = true;
  server.seats.set('a', seat);
  const bytes = new Encoder(server).encodeAll();
  const phone = new State();
  new Decoder(phone).decode(bytes);
  if (phone.code !== 'K7PM3XAB' || phone.seats.get('a').name !== 'Zain') throw new Error('decode mismatch');
  console.log('PHONE_OK');
`;

test('without the stand-ins, the libraries crash on the phone engine (the bug we hit)', () => {
  const result = runLikeThePhone(`await import('@colyseus/schema');`, false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FinalizationRegistry is not defined/);
});

test('with the stand-ins, the libraries load, a client is made, and state decodes', () => {
  const result = runLikeThePhone(LOAD_AND_DECODE, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PHONE_OK/);
});
