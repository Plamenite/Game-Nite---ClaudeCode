# Welcome to Colyseus!

This project was created with [⚔️ `create-colyseus-app`](https://github.com/colyseus/create-colyseus-app/).

[Documentation](https://docs.colyseus.io/)

## :crossed_swords: Usage

```
npm start
```

Then open http://localhost:2567 for the playground, or /monitor for the monitor.

## Structure

- `src/index.ts`: entry point — leave it alone if you plan to deploy to Colyseus Cloud
- `src/app.config.ts`: server configuration — rooms, HTTP routes, express middleware
- `src/rooms/MyRoom.ts`: your room handler
- `src/rooms/schema/MyRoomState.ts`: the state synchronized to every client in the room
- `test/MyRoom.test.ts`: boots the real server and connects a real client
- `loadtest/example.ts`: scriptable client for `npm run loadtest`
- `ecosystem.config.cjs`: pm2 configuration, used when deploying to Colyseus Cloud

## Scripts

- `npm start`: run the server in watch mode (`tsx watch src/index.ts`)
- `npm test`: run the mocha test suite
- `npm run build`: compile to `build/`
- `npm run loadtest`: connect N simulated clients with [`@colyseus/loadtest`](https://github.com/colyseus/colyseus-loadtest/)

## What's included

### Turn-based

`MyRoom` owns the turn order: `state.currentTurn` names whose turn it is, and a
`play` message from anyone else is ignored. The room locks once it is full, and
each turn carries a deadline — a `clock.setTimeout` skips a player who runs out
the clock, so one idle client cannot stall the match.

`state.turnDeadline` is stamped from `this.clock.currentTime`, the room's own
clock, so a reconnecting client can render the remaining time without the server
sending a countdown.

- https://docs.colyseus.io/room/timing-events

### Lobby room

A `LobbyRoom` is registered as `lobby`, and the sample room is chained with
`.enableRealtimeListing()` so the lobby receives create/update/dispose events for
it. Clients join the lobby to render a live room browser:

```ts
const lobby = await client.joinOrCreate("lobby");
lobby.onMessage("rooms", (rooms) => { /* full list on join */ });
lobby.onMessage("+", ([roomId, room]) => { /* added or updated */ });
lobby.onMessage("-", (roomId) => { /* removed */ });
```

- https://docs.colyseus.io/matchmaker/lobby

### Reconnection

`MyRoom.onDrop()` holds a dropped client's seat for 30 seconds via
`allowReconnection()`. The SDK retries automatically with exponential backoff;
`onReconnect()` fires if it gets back in time, `onLeave()` if it does not.

- https://docs.colyseus.io/room/reconnection

### Room authentication

`MyRoom.onAuth()` runs at matchmaking time, before a seat is consumed and before
`onJoin()`. Throw to reject the join; whatever you return becomes `client.auth`.

The static form is used here because it does not need a room instance. Replace
the placeholder verification with whatever issues your tokens — a call to your
API, or `JWT.verify()` from `@colyseus/auth` if this server issued them.

- https://docs.colyseus.io/auth/room
