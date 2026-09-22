import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import {
  NO_CHIP,
  OPENING_CARD,
  boardFromSnapshot,
  cardId,
  legalPlays,
  movesForCard,
  LOUNGE_LEAVE_CODES,
  loungeJoinOptions,
  toCourtPieceSnapshot,
  toFiveRowSnapshot,
  toLoungeSnapshot,
  type Card,
  type FiveRowMove,
} from "@gamenite/game-rules";

import appConfig from "../src/app.config.js";
import { configureAuth } from "../src/auth.js";
import { MemoryLedger, getLedger, setLedger } from "../src/ledger.js";
import { CourtPieceState } from "../src/rooms/schema/CourtPieceState.js";
import { FiveRowState } from "../src/rooms/schema/FiveRowState.js";
import { LoungeState } from "../src/rooms/schema/LoungeState.js";

/**
 * All room tests share ONE booted test server. Booting a second server in
 * the same process (one per test file) breaks matchmaking, so every room's
 * tests live in this file until we move to mocha root hooks.
 */
let colyseus: ColyseusTestServer<typeof appConfig>;

before(async () => {
  // Rooms are tested with the app's pre-login guest tokens and a memory ledger.
  configureAuth({ allowGuestTokens: true, verifier: null });
  setLedger(new MemoryLedger());
  colyseus = await boot(appConfig);
});
after(async () => colyseus.shutdown());

beforeEach(async () => {
  await colyseus.cleanup();
  // cleanup() signs the SDK out, so the token is set per test, not once.
  colyseus.sdk.auth.token = "guest-TEST";
});

/** Connect as a distinct guest (the token is the guest's identity). */
async function connectAs(room: any, token: string, name: string) {
  colyseus.sdk.auth.token = token;
  const client = await colyseus.connectTo(room, { name });
  colyseus.sdk.auth.token = "guest-TEST";
  return client;
}
const coins = (token: string) => getLedger().getBalance(token);

/** Resolve with the next message of this type, or fail the test after a while. */
function nextMessage<T = any>(room: { onMessage: any }, type: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), timeoutMs);
    room.onMessage(type, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}

/** Poll until a condition holds, or fail. */
async function waitFor(check: () => boolean, timeoutMs = 5000, label = "condition") {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Ask the room for my hand the way the phone does after registering handlers. */
async function fetchHand(client: { onMessage: any; send: any }): Promise<Card[]> {
  const hand = nextMessage<{ cards: Card[] }>(client, "hand");
  client.send("sync", {});
  return (await hand).cards;
}

// ---------------------------------------------------------------- lounge helpers

/** Open a lounge as its owner: the code is the owner's player code. */
async function openLounge(ownerToken: string, ownerName: string) {
  await getLedger().ensureProfile(ownerToken, ownerName, true);
  const code = await getLedger().playerCode(ownerToken);
  const lounge = await colyseus.createRoom<LoungeState>("lounge", { code });
  colyseus.sdk.auth.token = ownerToken;
  const owner = await colyseus.connectTo(lounge, loungeJoinOptions(ownerName, code));
  colyseus.sdk.auth.token = "guest-TEST";
  await lounge.waitForNextPatch();
  return { lounge, code, owner };
}

/** Two guests become friends (a request each way is a yes). */
async function befriend(tokenA: string, tokenB: string) {
  await getLedger().requestFriend(tokenA, tokenB);
  await getLedger().requestFriend(tokenB, tokenA);
}

/** Knock on a lounge the way a phone does: by room name + code. */
async function knock(code: string, token: string, name: string) {
  colyseus.sdk.auth.token = token;
  try {
    return await colyseus.sdk.join<LoungeState>("lounge", loungeJoinOptions(name, code));
  } finally {
    colyseus.sdk.auth.token = "guest-TEST";
  }
}

/** Befriend the host, knock, and have someone inside open the door. */
async function admit(lounge: any, host: any, code: string, token: string, name: string, hostToken = "guest-zain") {
  await befriend(hostToken, token);
  const guest = await knock(code, token, name);
  await lounge.waitForNextPatch();
  host.send("accept", { sessionId: guest.sessionId });
  await lounge.waitForMessage("accept");
  await lounge.waitForNextPatch();
  assert.ok(lounge.state.members.has(guest.sessionId), `${name} was let in`);
  return guest;
}

/** A lounge of the owner plus these friends, all seated. */
async function gather(ownerName: string, friends: string[]) {
  const { lounge, code, owner } = await openLounge(`guest-${ownerName.toLowerCase()}`, ownerName);
  const others = [];
  for (const name of friends) others.push(await admit(lounge, owner, code, `guest-${name.toLowerCase()}`, name, `guest-${ownerName.toLowerCase()}`));
  return { lounge, code, leader: owner, others };
}

/** Resolves with the close code when the server shuts the door on this client. */
const closedWith = (client: any) => new Promise<number>((resolve) => client.onLeave((code: number) => resolve(code)));

describe("FiveRowRoom (a live game)", () => {
  it("quick play seats two guests, deals seven private cards each, and starts the first turn", async () => {
    const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2 });
    assert.strictEqual(room.maxClients, 2);

    const c1 = await colyseus.connectTo(room, { name: "Zain" });
    assert.strictEqual(room.state.phase, "waiting");
    const c2 = await colyseus.connectTo(room, { name: "Friend" });
    await waitFor(() => room.state.phase === "playing", 3000, "match start");
    await room.waitForNextPatch();

    const snap = toFiveRowSnapshot(c2.state);
    assert.strictEqual(snap.chips.length, 100);
    assert.ok(snap.chips.every((c) => c === NO_CHIP));
    assert.deepStrictEqual(snap.seats.map((s) => [s.name, s.team, s.handCount]), [["Zain", 0, 7], ["Friend", 1, 7]]);
    assert.strictEqual(snap.turnSessionId, c1.sessionId);
    assert.strictEqual(snap.drawPileCount, 104 - 14);
    assert.ok(snap.turnDeadline > 0);

    const hand1 = await fetchHand(c1);
    const hand2 = await fetchHand(c2);
    assert.strictEqual(hand1.length, 7);
    assert.strictEqual(hand2.length, 7);
    assert.ok(hand1.every((c) => typeof c.rank === "string" && typeof c.suit === "string"));
  });

  it("a legal move places a chip and passes the turn; illegal and out-of-turn moves are refused", async () => {
    const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2 });
    const c1 = await colyseus.connectTo(room, { name: "Zain" });
    const c2 = await colyseus.connectTo(room, { name: "Friend" });
    await waitFor(() => room.state.phase === "playing", 3000, "match start");
    await room.waitForNextPatch();

    // Out of turn: refused.
    const refused = nextMessage<{ reason: string }>(c2, "refused");
    c2.send("move", { kind: "place", card: { rank: "A", suit: "spades" }, cell: 11 });
    assert.match((await refused).reason, /not allowed/i);

    // Nonsense payload: refused, not crashed.
    const refusedJunk = nextMessage<{ reason: string }>(c1, "refused");
    c1.send("move", { kind: "place" });
    assert.match((await refusedJunk).reason, /not valid/i);

    // A real legal move from the current player, found the way the phone finds it.
    const hand = await fetchHand(c1);
    const board = boardFromSnapshot(toFiveRowSnapshot(c1.state));
    let move: FiveRowMove | undefined;
    for (const card of hand) {
      const [first] = movesForCard(board, card, 0);
      if (first) { move = first; break; }
    }
    assert.ok(move, "a fresh hand always has a placeable card");
    const newHand = nextMessage<{ cards: Card[] }>(c1, "hand");
    c1.send("move", move);
    await room.waitForMessage("move");
    await room.waitForNextPatch();

    const snap = toFiveRowSnapshot(c2.state);
    assert.strictEqual(snap.chips[(move as { cell: number }).cell], 0, "team 0 chip placed");
    assert.strictEqual(snap.turnSessionId, c2.sessionId, "turn passed");
    assert.strictEqual(snap.seats[0].handCount, 7, "drew a replacement");
    assert.strictEqual(snap.drawPileCount, 104 - 14 - 1);
    assert.strictEqual((await newHand).cards.length, 7);
  });

  it("a slow player is auto-played; three timeouts in a row abandon the seat and the opponent wins", async () => {
    process.env.FIVEROW_TURN_SECONDS = "0.25";
    try {
      const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2 });
      await colyseus.connectTo(room, { name: "Zain" });
      const c2 = await colyseus.connectTo(room, { name: "Friend" });
      await waitFor(() => room.state.phase === "playing", 3000, "match start");

      // Nobody moves. Turns alternate by auto-play: Zain times out at 0.25s, Friend at 0.5s, ...
      await waitFor(() => room.state.chips.some((c) => c !== NO_CHIP), 3000, "an automatic move");
      await waitFor(() => room.state.phase === "finished", 6000, "abandonment");

      const snap = toFiveRowSnapshot(c2.state);
      assert.strictEqual(snap.phase, "finished");
      const zain = snap.seats.find((s) => s.name === "Zain")!;
      assert.strictEqual(zain.timeouts, 3);
      assert.strictEqual(zain.abandoned, true);
      assert.strictEqual(snap.winnerTeam, 1, "the friend's team wins");
    } finally {
      delete process.env.FIVEROW_TURN_SECONDS;
    }
  });

  it("leaving mid-game hands the win to the remaining team", async () => {
    const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2 });
    const c1 = await colyseus.connectTo(room, { name: "Zain" });
    const c2 = await colyseus.connectTo(room, { name: "Friend" });
    await waitFor(() => room.state.phase === "playing", 3000, "match start");

    await c1.leave(true);
    await waitFor(() => room.state.phase === "finished", 3000, "forfeit");
    await room.waitForNextPatch().catch(() => {});
    assert.strictEqual(room.state.winnerTeam, 1);
    assert.strictEqual(toFiveRowSnapshot(c2.state).seats.find((s) => s.name === "Zain")?.abandoned, true);
  });

  it("quick play never seats a 1v1 seeker at a 2v2 table", async () => {
    const big = await colyseus.createRoom<FiveRowState>("fiverow", { players: 4 });
    const seeker = await colyseus.sdk.joinOrCreate<FiveRowState>("fiverow", { players: 2, name: "Solo" });
    assert.notStrictEqual(seeker.roomId, big.roomId);
    assert.strictEqual(colyseus.getRoomById(seeker.roomId).maxClients, 2);
  });
});

describe("LoungeRoom (where friends gather)", () => {
  it("the owner opens a lounge with their player code and leads; a friend knocks and a member lets them in", async () => {
    const { lounge, code, owner } = await openLounge("guest-zain", "Zain");
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.strictEqual(lounge.state.code, code);
    assert.strictEqual(lounge.state.leaderSessionId, owner.sessionId);

    // Another lounge is open at the same time (a real evening has many).
    const other = await openLounge("guest-someone", "Someone");

    // Only friends of someone inside may knock.
    await assert.rejects(knock(code, "guest-stranger", "Stranger"), /friend first/i);
    await befriend("guest-zain", "guest-friend");
    const friend = await knock(code, "guest-friend", "Friend");
    await lounge.waitForNextPatch();
    assert.strictEqual(friend.roomId, lounge.roomId, "knocked on the lounge with that code");
    assert.strictEqual(lounge.state.members.size, 1, "still at the door");
    assert.strictEqual(lounge.state.requests.get(friend.sessionId).name, "Friend");
    let view = toLoungeSnapshot(friend.state);
    assert.deepStrictEqual(view.requests, [{ sessionId: friend.sessionId, name: "Friend" }]);

    owner.send("accept", { sessionId: friend.sessionId });
    await lounge.waitForMessage("accept");
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.members.size, 2);
    assert.strictEqual(lounge.state.requests.size, 0);
    assert.strictEqual(other.lounge.state.members.size, 1, "the other lounge is untouched");

    view = toLoungeSnapshot(friend.state);
    assert.deepStrictEqual(view.members.map((m) => [m.name, m.isLeader, m.ready]), [["Zain", true, false], ["Friend", false, false]]);
    assert.strictEqual(view.canStart, false, "nobody is ready yet");

    await assert.rejects(knock("ZZZZZZZZ", "guest-stranger", "Stranger"), /no rooms found|not found/i, "an unknown code finds no lounge");
    await assert.rejects(colyseus.sdk.joinById(lounge.roomId, loungeJoinOptions("Sneaky", "ZZZZZZZZ")), /wrong lounge code/i);
  });

  it("only the owner can open an empty lounge, and the owner always walks straight in", async () => {
    await getLedger().ensureProfile("guest-zain", "Zain", true);
    const code = await getLedger().playerCode("guest-zain");
    const squat = await colyseus.createRoom<LoungeState>("lounge", { code });
    colyseus.sdk.auth.token = "guest-squatter";
    await assert.rejects(colyseus.connectTo(squat, loungeJoinOptions("Squatter", code)), /only the owner/i);
    colyseus.sdk.auth.token = "guest-TEST";
    await squat.disconnect();

    const { lounge, owner } = await openLounge("guest-zain", "Zain");
    const ali = await admit(lounge, owner, code, "guest-ali", "Ali");
    await owner.leave(true);
    await waitFor(() => lounge.state.members.size === 1, 3000, "owner gone");
    assert.strictEqual(lounge.state.leaderSessionId, ali.sessionId, "the next member leads");

    // Zain comes back to his own lounge: no knocking.
    colyseus.sdk.auth.token = "guest-zain";
    const back = await colyseus.sdk.joinOrCreate<LoungeState>("lounge", loungeJoinOptions("Zain", code));
    colyseus.sdk.auth.token = "guest-TEST";
    await lounge.waitForNextPatch();
    assert.strictEqual(back.roomId, lounge.roomId);
    assert.ok(lounge.state.members.has(back.sessionId), "seated at once");
    assert.strictEqual(lounge.state.leaderSessionId, ali.sessionId, "Ali keeps the lead");
  });

  it("the door: a member can turn someone away, an unanswered knock times out, and a full lounge refuses", async () => {
    process.env.LOUNGE_KNOCK_SECONDS = "0.3";
    try {
      const { lounge, code, owner } = await openLounge("guest-zain", "Zain");
      for (const t of ["guest-turned", "guest-ignored", "guest-fifth"]) await befriend("guest-zain", t);
      const turned = await knock(code, "guest-turned", "Turned");
      await lounge.waitForNextPatch();
      const turnedClosed = closedWith(turned);
      owner.send("decline", { sessionId: turned.sessionId });
      assert.strictEqual(await turnedClosed, LOUNGE_LEAVE_CODES.declined);
      await lounge.waitForNextPatch();
      assert.strictEqual(lounge.state.requests.size, 0);

      const ignored = await knock(code, "guest-ignored", "Ignored");
      assert.strictEqual(await closedWith(ignored), LOUNGE_LEAVE_CODES.timedOut);

      for (const name of ["Ali", "Sara", "Bilal"]) await admit(lounge, owner, code, `guest-${name.toLowerCase()}`, name);
      assert.strictEqual(lounge.state.members.size, 4);
      await assert.rejects(knock(code, "guest-fifth", "Fifth"), /full/i);
    } finally {
      delete process.env.LOUNGE_KNOCK_SECONDS;
    }
  });

  it("the leader can remove a member and hand over the lead", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali", "Sara"]);
    const [ali, sara] = others;

    const refused = nextMessage<{ reason: string }>(ali, "refused");
    ali.send("kick", { sessionId: sara.sessionId });
    assert.match((await refused).reason, /leader/i);

    leader.send("make_leader", { sessionId: ali.sessionId });
    await lounge.waitForMessage("make_leader");
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.leaderSessionId, ali.sessionId);

    const saraClosed = closedWith(sara);
    ali.send("kick", { sessionId: sara.sessionId });
    assert.strictEqual(await saraClosed, LOUNGE_LEAVE_CODES.kicked);
    await waitFor(() => lounge.state.members.size === 2, 3000, "Sara gone");
    await lounge.waitForNextPatch();
    assert.deepStrictEqual(toLoungeSnapshot(leader.state).members.map((m) => m.name), ["Zain", "Ali"]);
  });

  it("only the leader picks the game and starts; the picker refuses tables too small for the lounge", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali", "Sara"]);
    const [ali] = others;

    let refused = nextMessage<{ reason: string }>(ali, "refused");
    ali.send("start", {});
    assert.match((await refused).reason, /leader/i);

    refused = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("set_game", { game: "fiverow", players: 2 });
    assert.match((await refused).reason, /seat for everyone/i);

    refused = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("set_game", { game: "courtpiece", players: 3 });
    assert.match((await refused).reason, /that size/i);

    leader.send("set_game", { game: "courtpiece" });
    await lounge.waitForMessage("set_game");
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.players, 4, "Court Piece is always four seats");
    assert.strictEqual(toLoungeSnapshot(leader.state).seatsToFill, 1);

    leader.send("set_game", { game: "fiverow", players: 3 });
    await lounge.waitForMessage("set_game");
    await lounge.waitForNextPatch();
    assert.ok([...lounge.state.members.values()].every((m) => !m.ready), "a new pick clears Ready");
    refused = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("start", {});
    assert.match((await refused).reason, /ready/i);
    assert.strictEqual(lounge.state.status, "open");
  });

  it("start opens a Five Row table sized to the lounge, seats every member, and the lounge stays open with Ready cleared", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Friend"]);
    const [friend] = others;

    leader.send("set_ready", { ready: true });
    await lounge.waitForMessage("set_ready");
    friend.send("set_ready", { ready: true });
    await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();
    assert.strictEqual(toLoungeSnapshot(leader.state).canStart, true);

    const leaderSeat = nextMessage<any>(leader, "table_ready");
    const friendSeat = nextMessage<any>(friend, "table_ready");
    leader.send("start", {});
    const [seatA, seatB] = await Promise.all([leaderSeat, friendSeat]);
    assert.strictEqual(seatA.roomId, seatB.roomId, "same table for both");
    await waitFor(() => lounge.state.status === "open" && ![...lounge.state.members.values()].some((m) => m.ready), 3000, "lounge open again");
    assert.strictEqual(lounge.state.members.size, 2, "everyone is still in the lounge, under the game");

    const tableA = await colyseus.sdk.consumeSeatReservation<FiveRowState>(seatA);
    const tableB = await colyseus.sdk.consumeSeatReservation<FiveRowState>(seatB);
    const table = colyseus.getRoomById<FiveRowState>(seatA.roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "match start");
    await table.waitForNextPatch();

    assert.strictEqual(table.maxClients, 2, "table sized to the lounge");
    const view = toFiveRowSnapshot(tableA.state);
    assert.deepStrictEqual(view.seats.map((s) => s.name).sort(), ["Friend", "Zain"]);
    assert.ok(view.turnSessionId, "the first turn has started");
    assert.deepStrictEqual(toFiveRowSnapshot(tableB.state).seats, view.seats);
    assert.strictEqual((await fetchHand(tableA)).length, 7);
  });

  it("two friends start Court Piece as partners; two other players fill the other side; it is one deal", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali"]);
    const [ali] = others;
    leader.send("set_game", { game: "courtpiece", bestOf: 3 });
    await lounge.waitForMessage("set_game");
    // Their badges say opposite sides; two friends are partners regardless.
    assert.deepStrictEqual([leader, ali].map((c) => lounge.state.members.get(c.sessionId).team), [0, 1]);
    for (const c of [leader, ali]) c.send("set_ready", { ready: true });
    for (let i = 0; i < 2; i++) await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();
    assert.strictEqual(toLoungeSnapshot(leader.state).canStart, true);
    assert.strictEqual(toLoungeSnapshot(leader.state).bestOfAtTable, 1);

    const seats = [leader, ali].map((c) => nextMessage<any>(c, "table_ready"));
    leader.send("start", {});
    const [seatA, seatB] = await Promise.all(seats);
    const zainTable = await colyseus.sdk.consumeSeatReservation<CourtPieceState>(seatA);
    await colyseus.sdk.consumeSeatReservation<CourtPieceState>(seatB);
    const table = colyseus.getRoomById<CourtPieceState>(seatA.roomId);
    assert.strictEqual(table.state.phase, "waiting", "two seats are still empty");

    // Two strangers on quick play land at the same table, on the other side.
    colyseus.sdk.auth.token = "guest-s1";
    const s1 = await colyseus.sdk.joinOrCreate<CourtPieceState>("courtpiece", { variant: "single_siri", entry: 0, name: "Stranger1" });
    colyseus.sdk.auth.token = "guest-s2";
    const s2 = await colyseus.sdk.joinOrCreate<CourtPieceState>("courtpiece", { variant: "single_siri", entry: 0, name: "Stranger2" });
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(s1.roomId, seatA.roomId);
    assert.strictEqual(s2.roomId, seatA.roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "deal start");
    await table.waitForNextPatch();

    const snap = toCourtPieceSnapshot(zainTable.state);
    assert.deepStrictEqual(snap.seats.map((s) => s.name), ["Zain", "Stranger1", "Ali", "Stranger2"], "friends at 0 and 2, strangers at 1 and 3");
    assert.deepStrictEqual(snap.seats.map((s) => s.team), [0, 1, 0, 1]);
    assert.strictEqual(table.state.bestOf, 1, "with other players it is one deal, not the leader's best of three");
  });

  it("three friends start 2 vs 2: the pair keeps its side, the single sits opposite, one other player completes it", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali", "Sara"]);
    const [ali, sara] = others;
    leader.send("set_game", { game: "fiverow", players: 4 });
    await lounge.waitForMessage("set_game");
    // All three on one side leaves nobody opposite: refused.
    leader.send("set_team", { sessionId: ali.sessionId, team: 0 });
    await lounge.waitForMessage("set_team");
    for (const c of [leader, ali, sara]) c.send("set_ready", { ready: true });
    for (let i = 0; i < 3; i++) await lounge.waitForMessage("set_ready");
    const refused = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("start", {});
    assert.match((await refused).reason, /two and one/i);

    // Zain + Sara together, Ali alone.
    leader.send("set_team", { sessionId: ali.sessionId, team: 1 });
    await lounge.waitForMessage("set_team");
    for (const c of [leader, ali, sara]) c.send("set_ready", { ready: true });
    for (let i = 0; i < 3; i++) await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();
    const seats = [leader, ali, sara].map((c) => nextMessage<any>(c, "table_ready"));
    leader.send("start", {});
    const reservations = await Promise.all(seats);
    const tables: any[] = [];
    for (const r of reservations) tables.push(await colyseus.sdk.consumeSeatReservation<FiveRowState>(r));
    const table = colyseus.getRoomById<FiveRowState>(reservations[0].roomId);

    colyseus.sdk.auth.token = "guest-s4";
    const stranger = await colyseus.sdk.joinOrCreate<FiveRowState>("fiverow", { players: 4, entry: 0, name: "Stranger" });
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(stranger.roomId, table.roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "match start");
    await table.waitForNextPatch();
    const teamOf = (name: string) => toFiveRowSnapshot(tables[0].state).seats.find((s) => s.name === name)?.team;
    assert.strictEqual(teamOf("Zain"), 0);
    assert.strictEqual(teamOf("Sara"), 0, "the pair stays together");
    assert.strictEqual(teamOf("Ali"), 1);
    assert.strictEqual(teamOf("Stranger"), 1, "the other player partners the single");
  });

  it("an early stranger cannot take a seat the lounge is holding, and a phone cannot pick a seat", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali"]);
    const [ali] = others;
    leader.send("set_game", { game: "courtpiece" });
    await lounge.waitForMessage("set_game");
    for (const c of [leader, ali]) c.send("set_ready", { ready: true });
    for (let i = 0; i < 2; i++) await lounge.waitForMessage("set_ready");
    const seats = [leader, ali].map((c) => nextMessage<any>(c, "table_ready"));
    leader.send("start", {});
    const [seatA, seatB] = await Promise.all(seats);

    // The stranger arrives before either friend has sat down, and even asks for seat 0.
    colyseus.sdk.auth.token = "guest-early";
    const early = await colyseus.sdk.joinOrCreate<CourtPieceState>("courtpiece", { variant: "single_siri", entry: 0, name: "Early", seat: 0 } as any);
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(early.roomId, seatA.roomId);
    const table = colyseus.getRoomById<CourtPieceState>(seatA.roomId);
    await table.waitForNextPatch();
    assert.strictEqual(table.state.seats.get(early.sessionId).seat, 1, "seats 0 and 2 are held for the friends");

    const zainTable = await colyseus.sdk.consumeSeatReservation<CourtPieceState>(seatA);
    await colyseus.sdk.consumeSeatReservation<CourtPieceState>(seatB);
    await table.waitForNextPatch();
    assert.strictEqual(table.state.seats.get(zainTable.sessionId).seat, 0);
    assert.deepStrictEqual([...table.state.seats.values()].map((s) => s.seat).sort(), [0, 1, 2]);
  });

  it("friends: add by code, the other side accepts, the list shows where each friend is", async () => {
    const http = colyseus.sdk.http;
    const as = (token: string) => { colyseus.sdk.auth.token = token; };
    const meOf = async (token: string) => { as(token); return (await http.get("/me")).data as { playerCode: string }; };
    const fa = await meOf("guest-fa");
    const fb = await meOf("guest-fb");
    await getLedger().setDisplayName("guest-fb", "Bilal");

    as("guest-fa");
    await assert.rejects(http.post("/friends/add", { body: { code: "ZZZZZZZZ" } }), /no player with that code/i);
    await assert.rejects(http.post("/friends/add", { body: { code: fa.playerCode } }), /own code/i);
    let lists = (await http.post("/friends/add", { body: { code: fb.playerCode } })).data as any;
    assert.deepStrictEqual(lists.outgoing.map((r: any) => r.playerCode), [fb.playerCode]);
    assert.deepStrictEqual(lists.friends, []);

    as("guest-fb");
    lists = (await http.get("/friends")).data as any;
    assert.deepStrictEqual(lists.incoming.map((r: any) => r.playerCode), [fa.playerCode]);
    lists = (await http.post("/friends/answer", { body: { code: fa.playerCode, accept: true } })).data as any;
    assert.deepStrictEqual(lists.friends.map((f: any) => [f.playerCode, f.status]), [[fa.playerCode, "offline"]]);

    as("guest-fa");
    lists = (await http.get("/friends")).data as any;
    assert.deepStrictEqual(lists.friends.map((f: any) => [f.playerCode, f.name, f.status]), [[fb.playerCode, "Bilal", "offline"]]);

    // Bilal opens his lounge: Zain sees it and could knock from the list.
    const { lounge } = await openLounge("guest-fb", "Bilal");
    await waitFor(() => true, 30);
    as("guest-fa");
    lists = (await http.get("/friends")).data as any;
    assert.deepStrictEqual(lists.friends.map((f: any) => [f.status, f.loungeCode]), [["lounge", fb.playerCode]]);

    // Bilal sits at a table: "at a table" wins over the lounge underneath.
    const table = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2, entry: 0 });
    const seat = await connectAs(table, "guest-fb", "Bilal");
    await waitFor(() => true, 30);
    as("guest-fa");
    lists = (await http.get("/friends")).data as any;
    assert.strictEqual(lists.friends[0].status, "table");
    await seat.leave(true);
    await waitFor(() => true, 30);
    lists = (await http.get("/friends")).data as any;
    assert.strictEqual(lists.friends[0].status, "lounge", "back in the lounge");
    await lounge.disconnect();
    await waitFor(() => true, 30);
    lists = (await http.get("/friends")).data as any;
    assert.strictEqual(lists.friends[0].status, "offline");

    lists = (await http.post("/friends/remove", { body: { code: fb.playerCode } })).data as any;
    assert.deepStrictEqual(lists, { friends: [], incoming: [], outgoing: [] });
    as("guest-TEST");
  });

  it("/me tells a phone its player code (its lounge code) and its name, which it can change", async () => {
    colyseus.sdk.auth.token = "guest-me";
    const me = (await colyseus.sdk.http.get("/me")).data as { playerCode: string; guest: boolean; name: string };
    assert.match(me.playerCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.strictEqual(me.guest, true);
    assert.strictEqual(me.playerCode, await getLedger().playerCode("guest-me"));
    assert.match(me.name, /^Player \d{5}$/, "a guest starts as a random player number");

    const renamed = (await colyseus.sdk.http.post("/me", { body: { name: "  Zain  " } })).data as { name: string };
    assert.strictEqual(renamed.name, "Zain");
    await assert.rejects(colyseus.sdk.http.post("/me", { body: { name: "x" } }), /at least 2/);
    await assert.rejects(colyseus.sdk.http.post("/me", { body: {} as any }), /name must be text|400/i);
    assert.strictEqual(((await colyseus.sdk.http.get("/me")).data as { name: string }).name, "Zain");

    // A phone that sends no name wears the profile's name in the lounge.
    const code = me.playerCode;
    const lounge = await colyseus.createRoom<LoungeState>("lounge", { code });
    const owner = await colyseus.connectTo(lounge, { code } as any);
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.members.get(owner.sessionId).name, "Zain");
    colyseus.sdk.auth.token = "guest-TEST";
  });
});

describe("CourtPieceRoom (a live game)", () => {
  /** Seat four distinct guests and return their SDK rooms in seat order, plus their private hands. */
  async function seatFour(room: any, prefix = "guest-cp") {
    const clients = [];
    const hands: Card[][] = [];
    for (const name of ["Zain", "Ali", "Sara", "Bilal"]) {
      clients.push(await connectAs(room, `${prefix}-${name}`, name));
    }
    await waitFor(() => room.state.phase === "playing", 3000, "deal start");
    await room.waitForNextPatch();
    for (const c of clients) hands.push(await fetchHand(c));
    return { clients, hands };
  }

  /** What the phone considers legal: the two of clubs first, then follow suit. */
  function legalFor(snapshot: ReturnType<typeof toCourtPieceSnapshot>, hand: Card[]): Card[] {
    if (snapshot.tricksPlayed === 0 && snapshot.trick.length === 0) {
      return hand.filter((c) => cardId(c) === cardId(OPENING_CARD));
    }
    const led = snapshot.trick.length > 0 ? snapshot.trick[0].card.suit : null;
    return legalPlays(hand, led);
  }

  it("seats four, deals thirteen private cards each, and the two of clubs must open", async () => {
    const room = await colyseus.createRoom<CourtPieceState>("courtpiece", { variant: "double_siri", bestOf: 5 });
    assert.strictEqual(room.state.bestOf, 1, "quick play cannot request a series");
    assert.strictEqual(room.state.variant, "double_siri");

    const { clients, hands } = await seatFour(room);
    const snap = toCourtPieceSnapshot(clients[0].state);
    assert.deepStrictEqual(snap.seats.map((s) => [s.name, s.seat, s.team]), [["Zain", 0, 0], ["Ali", 1, 1], ["Sara", 2, 0], ["Bilal", 3, 1]]);
    assert.ok(hands.every((h) => h.length === 13));
    assert.strictEqual(snap.trump, null);
    assert.strictEqual(snap.dealNumber, 1);

    const holder = hands.findIndex((h) => h.some((c) => cardId(c) === cardId(OPENING_CARD)));
    assert.strictEqual(snap.currentSeat, holder, "the two of clubs holder starts");
    assert.strictEqual(snap.turnSessionId, clients[holder].sessionId);

    // Any other card from the holder is refused; the two of clubs is accepted.
    const other = hands[holder].find((c) => cardId(c) !== cardId(OPENING_CARD))!;
    const refused = nextMessage<{ reason: string }>(clients[holder], "refused");
    clients[holder].send("play", { card: other });
    assert.match((await refused).reason, /cannot be played/i);

    clients[holder].send("play", { card: OPENING_CARD });
    await room.waitForMessage("play");
    await room.waitForNextPatch();
    const after = toCourtPieceSnapshot(clients[1].state);
    assert.strictEqual(after.trick.length, 1);
    assert.strictEqual(cardId(after.trick[0].card), "2-clubs");
    assert.strictEqual(after.currentSeat, (holder + 1) % 4);
    assert.strictEqual(after.seats[holder].handCount, 12);
  });

  it("four phones play a whole deal at 500; every trick ends up banked, coins settle, a rematch charges again", async () => {
    const room = await colyseus.createRoom<CourtPieceState>("courtpiece", { variant: "single_siri", entry: 500 });
    const { clients, hands } = await seatFour(room, "guest-deal");
    for (const n of ["Zain", "Ali", "Sara", "Bilal"]) assert.strictEqual(await coins(`guest-deal-${n}`), 500, "entry charged at seating");

    let plays = 0;
    while (room.state.phase === "playing" && plays < 60) {
      const seat = room.state.currentSeat;
      const snap = toCourtPieceSnapshot(clients[seat].state);
      const legal = legalFor(snap, hands[seat]);
      assert.ok(legal.length > 0, `seat ${seat} must have a legal card`);
      const card = legal[0];
      clients[seat].send("play", { card });
      await room.waitForMessage("play");
      await room.waitForNextPatch();
      hands[seat] = hands[seat].filter((c) => cardId(c) !== cardId(card));
      plays++;
    }
    assert.strictEqual(plays, 52, "thirteen tricks of four cards");
    const snap = toCourtPieceSnapshot(clients[0].state);
    assert.strictEqual(snap.phase, "finished", "best of one: the match ends with the deal");
    assert.strictEqual(snap.collected[0] + snap.collected[1], 13, "every trick banked");
    assert.ok(["win", "kot", "goon_kot"].includes(snap.dealResult ?? ""), `result ${snap.dealResult}`);
    assert.strictEqual(snap.seriesWinner, snap.dealWinner);
    assert.deepStrictEqual(snap.score, snap.dealWinner === 0 ? [1, 0] : [0, 1]);
    assert.ok(snap.trump !== null || snap.dealResult === "kot", "a trump was set unless nobody ever cut");

    // Coins: winners get 500 back plus 450 each; losers stay at 500.
    await waitFor(() => true, 10);
    const names = ["Zain", "Ali", "Sara", "Bilal"];
    for (const seat of snap.seats) {
      const expected = seat.team === snap.seriesWinner ? 1450 : 500;
      assert.strictEqual(await coins(`guest-deal-${names[seat.seat]}`), expected, `${seat.name} after the deal`);
    }

    // Everyone votes for a rematch: everyone pays again and a fresh deal starts.
    for (const c of clients) c.send("rematch", {});
    await waitFor(() => room.state.phase === "playing", 3000, "rematch");
    await room.waitForNextPatch();
    const again = toCourtPieceSnapshot(clients[2].state);
    assert.deepStrictEqual(again.score, [0, 0]);
    assert.strictEqual(again.dealNumber, 1);
    assert.strictEqual(again.tricksPlayed, 0);
    assert.strictEqual((await fetchHand(clients[2])).length, 13);
    for (const seat of again.seats) {
      const expected = seat.team === snap.seriesWinner ? 950 : 0;
      assert.strictEqual(await coins(`guest-deal-${names[seat.seat]}`), expected, `${seat.name} paid for the rematch`);
    }
  });

  it("slow players are auto-played; when a whole team has abandoned, the other team wins by forfeit", async () => {
    process.env.COURTPIECE_TURN_SECONDS = "0.2";
    try {
      const room = await colyseus.createRoom<CourtPieceState>("courtpiece", { variant: "single_siri" });
      const { clients } = await seatFour(room);
      await waitFor(() => room.state.tricksPlayed >= 1, 4000, "an automatic trick");
      await waitFor(() => room.state.phase === "finished", 8000, "forfeit");
      const snap = toCourtPieceSnapshot(clients[0].state);
      assert.strictEqual(snap.dealResult, "forfeit");
      assert.ok(snap.seriesWinner === 0 || snap.seriesWinner === 1);
      const losers = snap.seats.filter((s) => s.team !== snap.seriesWinner);
      assert.ok(losers.every((s) => s.abandoned), "both seats of the losing team abandoned");
    } finally {
      delete process.env.COURTPIECE_TURN_SECONDS;
    }
  });

  it("the leader assigns sides; start needs two a side; seats follow the sides with partners opposite", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali", "Sara", "Bilal"]);
    const all = [leader, ...others];
    assert.deepStrictEqual(all.map((c) => lounge.state.members.get(c.sessionId).team), [0, 1, 0, 1], "alternate on join");

    // Only the leader may move people.
    const refused = nextMessage<{ reason: string }>(others[0], "refused");
    others[0].send("set_team", { sessionId: leader.sessionId, team: 1 });
    assert.match((await refused).reason, /leader/i);

    // Leader wants Zain + Bilal against Ali + Sara: move Sara to side 1 and Bilal to side 0.
    leader.send("set_team", { sessionId: others[1].sessionId, team: 1 });
    await lounge.waitForMessage("set_team");
    leader.send("set_team", { sessionId: others[2].sessionId, team: 0 });
    await lounge.waitForMessage("set_team");
    leader.send("set_game", { game: "courtpiece" });
    await lounge.waitForMessage("set_game");
    for (const c of all) c.send("set_ready", { ready: true });
    for (let i = 0; i < 4; i++) await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();

    // Lopsided (three on one side) is refused.
    leader.send("set_team", { sessionId: others[0].sessionId, team: 0 });
    await lounge.waitForMessage("set_team");
    const lopsided = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("start", {});
    assert.match((await lopsided).reason, /two against two/i);
    leader.send("set_team", { sessionId: others[0].sessionId, team: 1 });
    await lounge.waitForMessage("set_team");
    await lounge.waitForNextPatch();
    assert.strictEqual(toLoungeSnapshot(leader.state).canStart, true);

    const seats = all.map((c) => nextMessage<any>(c, "table_ready"));
    leader.send("start", {});
    const reservations = await Promise.all(seats);
    // Consume in scrambled order: seats must still follow the sides, not arrival.
    const scrambled = [3, 1, 0, 2];
    const tables: any[] = new Array(4);
    for (const i of scrambled) tables[i] = await colyseus.sdk.consumeSeatReservation<CourtPieceState>(reservations[i]);
    const table = colyseus.getRoomById<CourtPieceState>(reservations[0].roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "deal start");
    await table.waitForNextPatch();

    const snap = toCourtPieceSnapshot(tables[0].state);
    const bySeat = snap.seats.map((s) => s.name);
    assert.deepStrictEqual(bySeat, ["Zain", "Ali", "Bilal", "Sara"], "side 0 at seats 0 and 2, side 1 at 1 and 3");
    assert.deepStrictEqual(snap.seats.map((s) => s.team), [0, 1, 0, 1]);
  });

  it("a lounge of four can start Court Piece as a best-of-three series", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Ali", "Sara", "Bilal"]);

    // Only the leader may pick the game.
    const refused = nextMessage<{ reason: string }>(others[0], "refused");
    others[0].send("set_game", { game: "courtpiece" });
    assert.match((await refused).reason, /leader/i);

    leader.send("set_game", { game: "courtpiece", variant: "double_siri", bestOf: 3 });
    await lounge.waitForMessage("set_game");
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.game, "courtpiece");
    assert.strictEqual(toLoungeSnapshot(leader.state).bestOf, 3);

    for (const c of [leader, ...others]) c.send("set_ready", { ready: true });
    for (let i = 0; i < 4; i++) await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();

    const seats = [leader, ...others].map((c) => nextMessage<any>(c, "table_ready"));
    leader.send("start", {});
    const reservations = await Promise.all(seats);
    const tables = [];
    for (const r of reservations) tables.push(await colyseus.sdk.consumeSeatReservation<CourtPieceState>(r));
    const table = colyseus.getRoomById<CourtPieceState>(reservations[0].roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "deal start");
    await table.waitForNextPatch();

    assert.strictEqual(table.state.variant, "double_siri");
    assert.strictEqual(table.state.bestOf, 3, "a lounge start may set the series length");
    const snap = toCourtPieceSnapshot(tables[0].state);
    assert.deepStrictEqual(snap.seats.map((s) => s.name), ["Zain", "Ali", "Sara", "Bilal"], "default alternating sides: partners opposite");
    assert.strictEqual((await fetchHand(tables[3])).length, 13);
  });

});

describe("coins at the table", () => {
  it("quick play at 500 charges each seat; a forfeit pays the winner the losers' entry minus the fee", async () => {
    const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2, entry: 500 });
    assert.strictEqual(room.state.entry, 500);
    const a = await connectAs(room, "guest-c1", "Zain");
    await connectAs(room, "guest-c2", "Friend");
    await waitFor(() => room.state.phase === "playing", 3000, "match start");
    assert.strictEqual(await coins("guest-c1"), 500);
    assert.strictEqual(await coins("guest-c2"), 500);

    await a.leave(true);
    await waitFor(() => room.state.phase === "finished", 3000, "forfeit");
    await waitFor(() => true, 20);
    assert.strictEqual(await coins("guest-c2"), 1450, "500 back plus 450");
    assert.strictEqual(await coins("guest-c1"), 500);
  });

  it("leaving before the table fills refunds the entry, and that player cannot come back for free", async () => {
    // A 3-player table so the room stays open (with one seat taken) after the leaver goes.
    const room = await colyseus.createRoom<FiveRowState>("fiverow", { players: 3, entry: 500 });
    const a = await connectAs(room, "guest-r1", "Zain");
    await connectAs(room, "guest-r2", "Friend");
    assert.strictEqual(await coins("guest-r1"), 500);
    await a.leave(true);
    await waitFor(() => room.state.seats.size === 1, 3000, "seat freed");
    await waitFor(() => true, 20);
    assert.strictEqual(await coins("guest-r1"), 1000, "refunded");
    assert.strictEqual(await coins("guest-r2"), 500, "the one who stayed is still charged");

    colyseus.sdk.auth.token = "guest-r1";
    await assert.rejects(colyseus.sdk.joinById(room.roomId, { name: "Zain" }), /left this table/i);
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(await coins("guest-r1"), 1000);
  });

  it("a player who cannot afford the tier is refused, and free practice charges nothing", async () => {
    const pricey = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2, entry: 2000 });
    colyseus.sdk.auth.token = "guest-poor";
    await assert.rejects(colyseus.sdk.joinById(pricey.roomId, { name: "Poor" }), /need 2,000 coins/i);
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(await coins("guest-poor"), 1000, "a refused seat costs nothing");

    const free = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2, entry: 0 });
    await connectAs(free, "guest-f1", "A");
    await connectAs(free, "guest-f2", "B");
    await waitFor(() => free.state.phase === "playing", 3000, "match start");
    assert.strictEqual(await coins("guest-f1"), 1000);
    assert.strictEqual(await coins("guest-f2"), 1000);
  });

  it("quick play never mixes tiers", async () => {
    const cheap = await colyseus.createRoom<FiveRowState>("fiverow", { players: 2, entry: 500 });
    colyseus.sdk.auth.token = "guest-tier-free";
    const practice = await colyseus.sdk.joinOrCreate<FiveRowState>("fiverow", { players: 2, entry: 0, name: "Practice" });
    assert.notStrictEqual(practice.roomId, cheap.roomId, "a free seeker never lands at a 500 table");
    assert.strictEqual(colyseus.getRoomById<FiveRowState>(practice.roomId).state.entry, 0);

    colyseus.sdk.auth.token = "guest-tier-500";
    const match = await colyseus.sdk.joinOrCreate<FiveRowState>("fiverow", { players: 2, entry: 500, name: "Match" });
    colyseus.sdk.auth.token = "guest-TEST";
    assert.strictEqual(match.roomId, cheap.roomId, "a 500 seeker joins the open 500 table");
    assert.strictEqual(await coins("guest-tier-free"), 1000);
    assert.strictEqual(await coins("guest-tier-500"), 500);
  });

  it("in a lounge, Ready is refused when a member cannot afford the leader's tier", async () => {
    const { lounge, leader, others } = await gather("Zain", ["Broke"]);
    const [friend] = others;
    // Make the friend broke: two 500 tables elsewhere.
    await getLedger().chargeTableEntry("guest-broke", "elsewhere-1", 500);
    await getLedger().chargeTableEntry("guest-broke", "elsewhere-2", 500);

    leader.send("set_game", { game: "fiverow", entry: 500 });
    await lounge.waitForMessage("set_game");
    await lounge.waitForNextPatch();
    assert.strictEqual(toLoungeSnapshot(leader.state).entry, 500);

    const refused = nextMessage<{ reason: string }>(friend, "refused");
    friend.send("set_ready", { ready: true });
    assert.match((await refused).reason, /need 500 coins/i);
    assert.strictEqual(lounge.state.members.get(friend.sessionId).ready, false);

    leader.send("set_ready", { ready: true });
    await lounge.waitForMessage("set_ready");
    await lounge.waitForNextPatch();
    assert.strictEqual(lounge.state.members.get(leader.sessionId).ready, true, "the leader can afford it");
  });

  it("the wallet endpoints read the balance and pay the daily bonus once", async () => {
    colyseus.sdk.auth.token = "guest-wallet";
    const first = await colyseus.sdk.http.get("/wallet");
    assert.deepStrictEqual(first.data, { balance: 1000, dailyBonusAvailable: true, dailyBonusCoins: 200, streakDay: 1 });
    const claimed = await colyseus.sdk.http.post("/wallet/daily", {});
    assert.deepStrictEqual(claimed.data, { balance: 1200, dailyBonusAvailable: false, dailyBonusCoins: 200, streakDay: 1 });
    await assert.rejects(colyseus.sdk.http.post("/wallet/daily", {}), /already claimed|409/i);
    colyseus.sdk.auth.token = "";
    await assert.rejects(colyseus.sdk.http.get("/wallet"), /401|sign in/i);
    colyseus.sdk.auth.token = "guest-TEST";
  });
});
