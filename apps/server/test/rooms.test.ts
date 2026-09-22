import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import {
  NO_CHIP,
  boardFromSnapshot,
  movesForCard,
  partyJoinOptions,
  toFiveRowSnapshot,
  toPartySnapshot,
  type Card,
  type FiveRowMove,
} from "@gamenite/game-rules";

import appConfig from "../src/app.config.js";
import { configureAuth } from "../src/auth.js";
import { FiveRowState } from "../src/rooms/schema/FiveRowState.js";
import { PartyState } from "../src/rooms/schema/PartyState.js";

/**
 * All room tests share ONE booted test server. Booting a second server in
 * the same process (one per test file) breaks matchmaking, so every room's
 * tests live in this file until we move to mocha root hooks.
 */
let colyseus: ColyseusTestServer<typeof appConfig>;

before(async () => {
  // Rooms are tested with the app's pre-login guest tokens.
  configureAuth({ allowGuestTokens: true, verifier: null });
  colyseus = await boot(appConfig);
});
after(async () => colyseus.shutdown());

beforeEach(async () => {
  await colyseus.cleanup();
  // cleanup() signs the SDK out, so the token is set per test, not once.
  colyseus.sdk.auth.token = "guest-TEST";
});

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

describe("PartyRoom (walking skeleton)", () => {
  it("creator is leader, friends join by code, wrong code is rejected", async () => {
    const party = await colyseus.createRoom<PartyState>("party", {});
    const leader = await colyseus.connectTo(party, { name: "Zain" });
    const code = party.state.code;
    assert.strictEqual(code.length, 6);
    assert.strictEqual(party.state.leaderSessionId, leader.sessionId);

    // A second, unrelated party is open at the same time (a real lobby has many).
    const otherParty = await colyseus.createRoom<PartyState>("party", {});
    await colyseus.connectTo(otherParty, { name: "Someone" });

    // Join the way the phone does: by room name + code, not by room id.
    const friend = await colyseus.sdk.join<PartyState>("party", partyJoinOptions("Friend", code));
    await party.waitForNextPatch();
    assert.strictEqual(friend.roomId, party.roomId, "landed in the party with that code");
    assert.strictEqual(party.state.members.size, 2);
    assert.strictEqual(otherParty.state.members.size, 1, "the other party is untouched");
    assert.strictEqual(party.state.members.get(friend.sessionId).name, "Friend");
    assert.strictEqual(party.state.members.get(friend.sessionId).ready, false);

    await assert.rejects(
      colyseus.sdk.join("party", partyJoinOptions("Stranger", "ZZZZZZ")),
      /no rooms found|not found/i,
      "an unknown code must not match any party",
    );

    const view = toPartySnapshot(friend.state);
    assert.deepStrictEqual(view.members.map((m) => [m.name, m.isLeader]), [["Zain", true], ["Friend", false]]);
    assert.strictEqual(view.canLaunch, false, "nobody is ready yet");
  });

  it("only the leader can launch, and only when everyone is ready", async () => {
    const party = await colyseus.createRoom<PartyState>("party", {});
    const leader = await colyseus.connectTo(party, { name: "Zain" });
    const friend = await colyseus.sdk.join<PartyState>("party", partyJoinOptions("Friend", party.state.code));
    await party.waitForNextPatch();

    const refused1 = nextMessage<{ reason: string }>(friend, "refused");
    friend.send("launch", {});
    assert.match((await refused1).reason, /leader/i);

    const refused2 = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("launch", {});
    assert.match((await refused2).reason, /ready/i);
    assert.strictEqual(party.state.status, "open");
  });

  it("launch opens a Five Row table sized to the party and seats every member", async () => {
    const party = await colyseus.createRoom<PartyState>("party", {});
    const leader = await colyseus.connectTo(party, { name: "Zain" });
    const friend = await colyseus.sdk.join<PartyState>("party", partyJoinOptions("Friend", party.state.code));
    await party.waitForNextPatch();

    leader.send("set_ready", { ready: true });
    friend.send("set_ready", { ready: true });
    await party.waitForMessage("set_ready");
    await party.waitForMessage("set_ready");
    await party.waitForNextPatch();
    assert.strictEqual(toPartySnapshot(leader.state).canLaunch, true);

    const leaderSeat = nextMessage<any>(leader, "table_ready");
    const friendSeat = nextMessage<any>(friend, "table_ready");
    leader.send("launch", {});
    const [seatA, seatB] = await Promise.all([leaderSeat, friendSeat]);
    assert.strictEqual(seatA.roomId, seatB.roomId, "same table for both");
    assert.strictEqual(party.state.status, "launched");

    const tableA = await colyseus.sdk.consumeSeatReservation<FiveRowState>(seatA);
    const tableB = await colyseus.sdk.consumeSeatReservation<FiveRowState>(seatB);
    const table = colyseus.getRoomById<FiveRowState>(seatA.roomId);
    await waitFor(() => table.state.phase === "playing", 3000, "match start");
    await table.waitForNextPatch();

    assert.strictEqual(table.maxClients, 2, "table sized to the party");
    const view = toFiveRowSnapshot(tableA.state);
    assert.deepStrictEqual(view.seats.map((s) => s.name).sort(), ["Friend", "Zain"]);
    assert.ok(view.turnSessionId, "the first turn has started");
    assert.deepStrictEqual(toFiveRowSnapshot(tableB.state).seats, view.seats);
    assert.strictEqual((await fetchHand(tableA)).length, 7);
  });
});
