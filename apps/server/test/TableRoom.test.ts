import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { toTableSnapshot } from "@gamenite/game-rules";
import { TableState } from "../src/rooms/schema/TableState.js";

describe("TableRoom (walking skeleton)", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
    // cleanup() signs the SDK out, so the token is set per test, not once.
    colyseus.sdk.auth.token = "test-user";
  });

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
