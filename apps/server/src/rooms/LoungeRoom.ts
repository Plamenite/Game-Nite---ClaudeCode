import { Room, Client, CloseCode, ServerError, matchMaker } from "colyseus";
import {
  COURT_PIECE_PRIVATE_BEST_OF,
  COURT_PIECE_VARIANTS,
  LOUNGE_EVENTS,
  LOUNGE_GAMES,
  LOUNGE_JOIN_FILTER_KEY,
  LOUNGE_LEAVE_CODES,
  LOUNGE_MESSAGES,
  LOUNGE_REQUEST_TIMEOUT_SECONDS,
  LOUNGE_SIZE,
  ROOMS,
  canStartLounge,
  fiverowConfigForPlayers,
  isLoungeFormat,
  isTableEntry,
  isTeamGame,
  normalizeLoungeCode,
  sanitizeDisplayName,
  seatsForLounge,
  type LoungeGameChoice,
} from "@gamenite/game-rules";
import { authenticate } from "../auth.js";
import { LAUNCH_SECRET } from "../launch.js";
import { getLedger } from "../ledger.js";
import { LoungeMember, LoungeRequest, LoungeState } from "./schema/LoungeState.js";

/** How long a knock waits; tests shorten it with LOUNGE_KNOCK_SECONDS. */
const knockSeconds = () => Number(process.env.LOUNGE_KNOCK_SECONDS) || LOUNGE_REQUEST_TIMEOUT_SECONDS;

/** What the phone sends when opening or knocking on a lounge (see loungeJoinOptions). */
export interface LoungeJoinOptions {
  name?: string;
  /** The owner's player code. Key must match the filterBy key. */
  [LOUNGE_JOIN_FILTER_KEY]?: string;
}

/**
 * A lounge = the PUBG-style room every player owns, where friends gather
 * before a game and land back in afterwards.
 *
 * - The code is the owner's player code. Only the owner can open an empty
 *   lounge; the owner always walks straight in.
 * - Anyone else with the code knocks: they wait at the door until a member
 *   lets them in (or turns them away, or a minute passes).
 * - The first one in leads. The leader picks the game, moves people between
 *   sides, removes people, and can hand the lead over. If the leader leaves,
 *   the next member leads.
 * - Everyone taps Ready; the leader starts. The lounge stays open under
 *   the game, so everyone lands back in it with Ready cleared.
 */
export class LoungeRoom extends Room<{ state: LoungeState; metadata: { code: string } }> {
  /** Members plus people waiting at the door. */
  maxClients = LOUNGE_SIZE * 2;
  state = new LoungeState();

  private doorTimers = new Map<string, ReturnType<typeof setTimeout>>();

  messages = {
    [LOUNGE_MESSAGES.setReady]: async (client: Client, message: { ready?: boolean } | undefined) => {
      if (this.state.status !== "open") return;
      const member = this.state.members.get(client.sessionId);
      if (!member) return;
      const ready = Boolean(message?.ready);
      if (ready && this.state.entry > 0) {
        const balance = await getLedger().getBalance(client.auth?.userId ?? "");
        if (balance < this.state.entry) {
          return this.refuse(client, `You need ${this.state.entry.toLocaleString()} coins for this table. You have ${balance.toLocaleString()}.`);
        }
      }
      member.ready = ready;
    },

    [LOUNGE_MESSAGES.setGame]: (client: Client, choice: LoungeGameChoice | undefined) => {
      if (!this.isLeader(client)) return this.refuse(client, "Only the leader picks the game.");
      if (this.state.status !== "open") return;
      if (!choice || !LOUNGE_GAMES.includes(choice.game)) return this.refuse(client, "Unknown game.");
      const players = choice.players === undefined ? (choice.game === "courtpiece" ? 4 : this.state.players) : Number(choice.players);
      if (!isLoungeFormat(choice.game, players)) return this.refuse(client, "That game does not come in that size.");
      if (players < this.state.members.size) return this.refuse(client, "Pick a table with a seat for everyone here.");
      this.state.game = choice.game;
      this.state.players = players;
      if (choice.variant !== undefined) {
        if (!COURT_PIECE_VARIANTS.some((v) => v.id === choice.variant)) return this.refuse(client, "Unknown variant.");
        this.state.variant = choice.variant;
      }
      if (choice.bestOf !== undefined) {
        if (!(COURT_PIECE_PRIVATE_BEST_OF as readonly number[]).includes(Number(choice.bestOf))) return this.refuse(client, "Best of 1, 3 or 5 only.");
        this.state.bestOf = Number(choice.bestOf);
      }
      if (choice.entry !== undefined) {
        if (!isTableEntry(choice.entry)) return this.refuse(client, "Table entry must be free, 500, 2,000 or 10,000.");
        this.state.entry = Number(choice.entry);
      }
      // Settings changed: everyone confirms again (and affordability is re-checked).
      this.clearReady();
    },

    [LOUNGE_MESSAGES.setTeam]: (client: Client, payload: { sessionId?: string; team?: number } | undefined) => {
      if (!this.isLeader(client)) return this.refuse(client, "Only the leader assigns sides.");
      if (this.state.status !== "open") return;
      const member = payload?.sessionId ? this.state.members.get(payload.sessionId) : undefined;
      const team = Number(payload?.team);
      if (!member || (team !== 0 && team !== 1)) return this.refuse(client, "Pick a member and a side.");
      member.team = team;
    },

    [LOUNGE_MESSAGES.accept]: (client: Client, payload: { sessionId?: string } | undefined) => {
      if (!this.state.members.has(client.sessionId)) return this.refuse(client, "Only people in the lounge can open the door.");
      const guest = this.clients.find((c) => c.sessionId === payload?.sessionId);
      const request = payload?.sessionId ? this.state.requests.get(payload.sessionId) : undefined;
      if (!guest || !request) return this.refuse(client, "They are no longer at the door.");
      if (this.state.members.size >= LOUNGE_SIZE) return this.refuse(client, "The lounge is full.");
      this.admit(guest, request.name);
    },

    [LOUNGE_MESSAGES.decline]: (client: Client, payload: { sessionId?: string } | undefined) => {
      if (!this.state.members.has(client.sessionId)) return this.refuse(client, "Only people in the lounge can answer the door.");
      const guest = this.clients.find((c) => c.sessionId === payload?.sessionId);
      if (!guest || !this.state.requests.has(guest.sessionId)) return this.refuse(client, "They are no longer at the door.");
      this.closeDoor(guest, LOUNGE_LEAVE_CODES.declined);
    },

    [LOUNGE_MESSAGES.kick]: (client: Client, payload: { sessionId?: string } | undefined) => {
      if (!this.isLeader(client)) return this.refuse(client, "Only the leader can remove someone.");
      const target = this.clients.find((c) => c.sessionId === payload?.sessionId);
      if (!target || !this.state.members.has(target.sessionId)) return this.refuse(client, "Pick someone in the lounge.");
      if (target.sessionId === client.sessionId) return this.refuse(client, "You cannot remove yourself; leave instead.");
      target.leave(LOUNGE_LEAVE_CODES.kicked);
    },

    [LOUNGE_MESSAGES.makeLeader]: (client: Client, payload: { sessionId?: string } | undefined) => {
      if (!this.isLeader(client)) return this.refuse(client, "Only the leader can hand over the lead.");
      if (!payload?.sessionId || !this.state.members.has(payload.sessionId)) return this.refuse(client, "Pick someone in the lounge.");
      this.state.leaderSessionId = payload.sessionId;
    },

    [LOUNGE_MESSAGES.start]: async (client: Client) => {
      await this.start(client);
    },
  };

  static onAuth = authenticate;

  async onCreate(options: LoungeJoinOptions) {
    const code = normalizeLoungeCode(options?.[LOUNGE_JOIN_FILTER_KEY]);
    if (!code) throw new Error("a lounge needs its owner's code");
    this.state.code = code;
    // Metadata is what join-by-code filters on (see app.config.ts).
    await this.setMetadata({ code });
  }

  async onJoin(client: Client, options: LoungeJoinOptions) {
    const userId = client.auth?.userId ?? "";
    const name = sanitizeDisplayName(options?.name);
    if (normalizeLoungeCode(options?.[LOUNGE_JOIN_FILTER_KEY]) !== this.state.code) {
      throw new ServerError(403, "wrong lounge code");
    }
    // Make sure the player has a wallet (and the one-time starting coins).
    await getLedger().ensureProfile(userId, name, client.auth?.guest ?? true);
    const isOwner = (await getLedger().playerCode(userId)) === this.state.code;

    if (this.state.members.size === 0 && !isOwner) {
      throw new ServerError(403, "Only the owner can open this lounge.");
    }
    if (isOwner || this.state.members.size === 0) {
      this.admit(client, name);
      return;
    }
    if (this.state.members.size >= LOUNGE_SIZE) {
      throw new ServerError(409, "The lounge is full.");
    }
    // Knock and wait for a member to open the door.
    const request = new LoungeRequest();
    request.name = name;
    this.state.requests.set(client.sessionId, request);
    this.doorTimers.set(
      client.sessionId,
      setTimeout(() => this.closeDoor(client, LOUNGE_LEAVE_CODES.timedOut), knockSeconds() * 1000),
    );
    console.log("lounge", this.state.code, "knock", name);
  }

  onLeave(client: Client, _code: CloseCode) {
    this.forget(client.sessionId);
    this.state.members.delete(client.sessionId);

    if (this.state.leaderSessionId === client.sessionId) {
      // Promote whoever joined next. keys() preserves join order.
      const next = this.state.members.keys().next().value;
      this.state.leaderSessionId = next ?? "";
    }
  }

  onDrop(client: Client, code: CloseCode) {
    // Hold a member's seat for 30s so a network blip does not eject a friend.
    // Not when the lounge itself showed them out.
    const shownOut = (Object.values(LOUNGE_LEAVE_CODES) as number[]).includes(Number(code));
    if (this.state.members.has(client.sessionId) && !shownOut) {
      this.allowReconnection(client, 30).catch(() => {});
    }
  }

  onDispose() {
    this.doorTimers.forEach((timer) => clearTimeout(timer));
  }

  private isLeader(client: Client) {
    return client.sessionId === this.state.leaderSessionId && this.state.members.has(client.sessionId);
  }

  private refuse(client: Client, reason: string) {
    client.send(LOUNGE_EVENTS.refused, { reason });
  }

  private clearReady() {
    this.state.members.forEach((m) => { m.ready = false; });
  }

  /** Move someone from the door (or straight from the street) into a seat. */
  private admit(client: Client, name: string) {
    this.forget(client.sessionId);
    const member = new LoungeMember();
    member.name = name;
    member.team = this.state.members.size % 2; // alternate sides; the leader can change it
    this.state.members.set(client.sessionId, member);
    if (!this.state.leaderSessionId || !this.state.members.has(this.state.leaderSessionId)) {
      this.state.leaderSessionId = client.sessionId;
    }
    console.log("lounge", this.state.code, "+", name, this.state.leaderSessionId === client.sessionId ? "(leader)" : "");
  }

  private closeDoor(client: Client, code: number) {
    this.forget(client.sessionId);
    client.leave(code);
  }

  private forget(sessionId: string) {
    const timer = this.doorTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.doorTimers.delete(sessionId);
    this.state.requests.delete(sessionId);
  }

  private async start(leader: Client) {
    if (!this.isLeader(leader)) {
      return this.refuse(leader, "Only the leader can start.");
    }

    const members = [...this.state.members.entries()].map(([sessionId, m]) => ({ sessionId, ready: m.ready, team: m.team }));
    if (!canStartLounge(members, this.state.status, this.state.game, this.state.players)) {
      const missing = this.state.players - members.length;
      if (missing > 0) return this.refuse(leader, `This table needs ${missing} more ${missing === 1 ? "player" : "players"}.`);
      if (isTeamGame(this.state.game, this.state.players) && members.every((m) => m.ready)) return this.refuse(leader, "Sides must be two against two.");
      return this.refuse(leader, "Everyone must be ready first.");
    }
    const seats = seatsForLounge(members, this.state.game, this.state.players);

    this.state.status = "starting";
    try {
      let table;
      if (this.state.game === "courtpiece") {
        table = await matchMaker.createRoom(ROOMS.courtpiece, {
          variant: this.state.variant,
          bestOf: this.state.bestOf,
          entry: this.state.entry,
          launchSecret: LAUNCH_SECRET,
        });
      } else {
        const config = fiverowConfigForPlayers(this.state.players);
        if (!config) {
          this.state.status = "open";
          return this.refuse(leader, "Five Row needs 2, 3 or 4 players.");
        }
        table = await matchMaker.createRoom(ROOMS.fiverow, { players: config.players, entry: this.state.entry, launchSecret: LAUNCH_SECRET });
      }

      // Reserve one seat per member and hand each phone its own reservation.
      for (const client of this.clients) {
        const member = this.state.members.get(client.sessionId);
        if (!member) continue;
        const reservation = await matchMaker.reserveSeatFor(table, { name: member.name, seat: seats.get(client.sessionId) }, client.auth);
        client.send(LOUNGE_EVENTS.tableReady, reservation);
      }
    } catch (error) {
      console.error("lounge start failed", error);
      this.refuse(leader, "Could not create the table. Try again.");
    } finally {
      // The lounge stays open under the game; everyone lands back here.
      this.state.status = "open";
      this.clearReady();
    }
  }
}
