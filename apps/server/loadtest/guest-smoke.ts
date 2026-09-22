/**
 * Smoke check against a RUNNING server (npm run server in another terminal):
 *   npm run smoke -w @gamenite/server
 * Joins a table the way the phone does, with a guest token, and prints the
 * table state. Exit code 0 means the server accepts guests in this mode.
 */
import { Client } from "@colyseus/sdk";
import { ROOMS, partyJoinOptions, toPartySnapshot } from "@gamenite/game-rules";

const url = process.env.SMOKE_URL ?? "ws://localhost:2567";
const client = new Client(url);
client.auth.token = "guest-SMOKE";

const party = await client.create(ROOMS.party, partyJoinOptions("Smoke"));
await new Promise((r) => setTimeout(r, 200));
const snapshot = toPartySnapshot(party.state as any);
console.log("joined", url, "party code", snapshot.code, "members", snapshot.members.map((m) => m.name));
await party.leave(true);
if (snapshot.code.length !== 6) {
  throw new Error("party code missing");
}
console.log("SMOKE OK");
