import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { partyJoinOptions, toPartySnapshot, toTableSnapshot } from "@gamenite/game-rules";

import appConfig from "../src/app.config.js";
import { configureAuth } from "../src/auth.js";
import { PartyState } from "../src/rooms/schema/PartyState.js";
import { TableState } from "../src/rooms/schema/TableState.js";

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

describe("TableRoom (walking skeleton)", () => {
  it("only lets the current player act", async () => {
    const room = await colyseus.createRoom<TableState>("table", {});
    const client1 = await colyseus.connectTo(room, { name: "  Zain <b>  " });
    const client2 = await colyseus.connectTo(room, { name: "" });

    assert.strictEqual(room.state.players.get(client1.sessionId).name, "Zain b", "names are sanitized");
    assert.strictEqual(room.state.players.get(client2.sessionId).name, "Guest", "empty name falls back");

    assert.strictEqual(room.state.currentTurn, client1.sessionId, "first joiner starts");

    // out of turn: ignored
    client2.send("play", {});
    await room.waitForMessage("play");
    assert.strictEqual(room.state.players.get(client2.sessionId).score, 0);
    assert.strictEqual(room.state.currentTurn, client1.sessionId);

    // in turn: counted, and the turn passes on
    client1.send("play", {});
    await room.waitForMessage("play");
    assert.strictEqual(room.state.players.get(client1.sessionId).score, 1);
    assert.strictEqual(room.state.currentTurn, client2.sessionId);
  });
  it("phone-side snapshots match the server and agree between players", async () => {
    const room = await colyseus.createRoom<TableState>("table", {});
    const client1 = await colyseus.connectTo(room, { name: "Zain" });
    const client2 = await colyseus.connectTo(room, { name: "Friend" });
    // client1 learns about client2 in the next state update; wait for it.
    await room.waitForNextPatch();

    // Both phones see the same table, in join order, with sanitized names.
    const view1 = toTableSnapshot(client1.state);
    const view2 = toTableSnapshot(client2.state);
    assert.deepStrictEqual(view1, view2);
    assert.deepStrictEqual(view1.players.map((p) => p.name), ["Zain", "Friend"]);
    assert.strictEqual(view1.currentTurn, client1.sessionId);

    // A play by the current player shows up on the other phone.
    client1.send("play", {});
    await room.waitForMessage("play");
    await room.waitForNextPatch();
    const after = toTableSnapshot(client2.state);
    assert.strictEqual(after.players.find((p) => p.sessionId === client1.sessionId)?.score, 1);
    assert.strictEqual(after.currentTurn, client2.sessionId);
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

    // Friend tries to launch: refused.
    const refused1 = nextMessage<{ reason: string }>(friend, "refused");
    friend.send("launch", {});
    assert.match((await refused1).reason, /leader/i);

    // Leader launches before everyone is ready: refused.
    const refused2 = nextMessage<{ reason: string }>(leader, "refused");
    leader.send("launch", {});
    assert.match((await refused2).reason, /ready/i);
    assert.strictEqual(party.state.status, "open");
  });

  it("launch creates a table and seats every member via reservations", async () => {
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
    assert.notStrictEqual(seatA.sessionId, seatB.sessionId);
    assert.strictEqual(party.state.status, "launched");

    // Each phone takes its reserved seat.
    const tableA = await colyseus.sdk.consumeSeatReservation<TableState>(seatA);
    const tableB = await colyseus.sdk.consumeSeatReservation<TableState>(seatB);
    const table = colyseus.getRoomById(seatA.roomId);
    await table.waitForNextPatch();

    const view = toTableSnapshot(tableA.state);
    assert.deepStrictEqual(view.players.map((p) => p.name).sort(), ["Friend", "Zain"]);
    assert.strictEqual(table.maxClients, 2, "table sized to the party");
    assert.ok(view.currentTurn, "the turn starts once every seat is taken");
    assert.deepStrictEqual(toTableSnapshot(tableB.state).players, view.players);
  });
});
