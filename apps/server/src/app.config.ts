import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
  LobbyRoom,
} from "colyseus";

/**
 * Import your Room files
 */
import { GAMES, PARTY_JOIN_FILTER_KEY, ROOMS } from "@gamenite/game-rules";
import { PartyRoom } from "./rooms/PartyRoom.js";
import { FiveRowRoom } from "./rooms/FiveRowRoom.js";

const server = defineServer({

  /**
   * Define your room handlers:
   */
  rooms: {
    // Quick play: joinOrCreate with { players: 2 | 3 | 4 } picks the table shape.
    [ROOMS.fiverow]: defineRoom(FiveRowRoom).filterBy(["players"]).enableRealtimeListing(),
    // Friends join with partyJoinOptions(name, code). The matchmaker forwards
    // the "code" option and its driver matches it against the room's
    // metadata.code, which PartyRoom sets in onCreate.
    [ROOMS.party]: defineRoom(PartyRoom).filterBy([PARTY_JOIN_FILTER_KEY]),
    lobby: defineRoom(LobbyRoom),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello World" };
    }),
    /** The game catalogue, straight from the shared rules package. */
    api_games: createEndpoint("/api/games", { method: "GET" }, async (ctx) => {
      return { games: GAMES };
    }),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {

    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }
  }
});

export default server;

