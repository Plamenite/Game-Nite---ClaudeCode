import { Room, Client, CloseCode, Delayed } from "colyseus";
import { SKELETON_PARTY_SIZE, SKELETON_TABLE_SEATS, TABLE_MESSAGES, sanitizeDisplayName } from "@gamenite/game-rules";
import { authenticate } from "../auth.js";
import { TableState, Player } from "./schema/TableState.js";

/** How long a player has to act before their turn is skipped. */
const TURN_DURATION = 15_000;

/** What the phone sends when it joins. */
export interface TableJoinOptions {
  name?: string;
}

/** What creates a table (a party launch, or quick play with no options). */
export interface TableCreateOptions {
  seats?: number;
}

/**
 * One table = one room. The server is the referee: it decides whose turn
 * it is and ignores anything a phone sends out of turn.
 */
export class TableRoom extends Room<{ state: TableState }> {
  maxClients = SKELETON_TABLE_SEATS;
  state = new TableState();

  private turnTimeout?: Delayed;

  messages = {
    /**
     * Ignored unless it is the sender's turn — turn order is the server's to
     * enforce, never the client's to claim.
     */
    [TABLE_MESSAGES.play]: (client: Client, _message: unknown) => {
      if (this.state.currentTurn !== client.sessionId) { return; }

      const player = this.state.players.get(client.sessionId);
      if (!player) { return; }

      player.score++;
      this.nextTurn();
    },
  };

  static onAuth = authenticate;

  onCreate(options: TableCreateOptions | undefined) {
    const requested = Number(options?.seats ?? SKELETON_TABLE_SEATS);
    // Clamp so a bad request can never make a 1-seat or 1000-seat table.
    this.maxClients = Math.min(SKELETON_PARTY_SIZE, Math.max(SKELETON_TABLE_SEATS, requested || SKELETON_TABLE_SEATS));
  }

  onJoin(client: Client, options: TableJoinOptions) {
    const player = new Player();
    player.name = sanitizeDisplayName(options?.name);
    this.state.players.set(client.sessionId, player);
    console.log(client.sessionId, "joined as", player.name, "auth:", client.auth?.userId);

    if (this.state.players.size === this.maxClients) {
      this.lock(); // full: stop the matchmaker from sending anyone else
      this.nextTurn();
    }
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    const wasTheirTurn = this.state.currentTurn === client.sessionId;

    this.state.players.delete(client.sessionId);
    if (wasTheirTurn) { this.nextTurn(); }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  /** Hand the turn to the next player and restart the deadline. */
  nextTurn() {
    this.turnTimeout?.clear();

    const sessionIds = [...this.state.players.keys()];
    if (sessionIds.length === 0) {
      this.state.currentTurn = "";
      return;
    }

    // indexOf("") is -1, so the very first turn lands on sessionIds[0].
    const previous = sessionIds.indexOf(this.state.currentTurn);
    this.state.currentTurn = sessionIds[(previous + 1) % sessionIds.length];
    this.state.turnCount++;
    this.state.turnDeadline = this.clock.currentTime + TURN_DURATION;

    this.turnTimeout = this.clock.setTimeout(() => this.nextTurn(), TURN_DURATION);
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip,
   * the app going to the background, a Wi-Fi to 4G switch. Holding the seat
   * lets the SDK retry into the same session, so the player keeps their place.
   */
  onDrop(client: Client, _code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave() by itself. The catch only silences the rejection that happens
    // when the room is already disposing (server shutdown).
    this.allowReconnection(client, 30).catch(() => {});
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}
