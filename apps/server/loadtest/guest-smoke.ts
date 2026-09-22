/**
 * Smoke test against a RUNNING server: connect like a phone would, open my
 * lounge, print its code, leave. Usage: npm run smoke -w @gamenite/server
 * (SMOKE_URL=ws://host:2567 to point elsewhere).
 */
import { Client } from "@colyseus/sdk";
import { ME_ROUTE, ROOMS, loungeJoinOptions, toLoungeSnapshot, type MeSnapshot } from "@gamenite/game-rules";

const url = process.env.SMOKE_URL ?? "ws://localhost:2567";
const client = new Client(url);
client.auth.token = `guest-SMOKE`;

const me = (await client.http.get(ME_ROUTE)).data as MeSnapshot;
const lounge = await client.joinOrCreate(ROOMS.lounge, loungeJoinOptions("Smoke", me.playerCode));
await new Promise((resolve) => setTimeout(resolve, 200));
const snapshot = toLoungeSnapshot(lounge.state as any);
console.log("joined", url, "lounge code", snapshot.code, "members", snapshot.members.map((m) => m.name));
await lounge.leave(true);
if (snapshot.code !== me.playerCode) {
  throw new Error("lounge code should be my player code");
}
