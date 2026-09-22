import { Room, Client, CloseCode, ServerError, matchMaker } from "colyseus";
import {
  COURT_PIECE_PRIVATE_BEST_OF,
  COURT_PIECE_VARIANTS,
  PARTY_EVENTS,
  PARTY_GAMES,
  PARTY_JOIN_FILTER_KEY,
  PARTY_MESSAGES,
  ROOMS,
  SKELETON_PARTY_SIZE,
  canLaunchParty,
  fiverowConfigForPlayers,
  isTableEntry,
  isTeamGame,
  seatsForParty,
  type PartyGameChoice,
  generatePartyCode,
  normalizePartyCode,
  sanitizeDisplayName,
} from "@gamenite/game-rules";
import { authenticate } from "../auth.js";
import { LAUNCH_SECRET } from "../launch.js";
import { getLedger } from "../ledger.js";
import { PartyMember, PartyState } from "./schema/PartyState.js";

/** What the phone sends when creating or joining a party (see partyJoinOptions). */
export interface PartyJoinOptions {
  name?: string;
  /** Required for everyone except the creator. Key must match the filterBy key. */
  [PARTY_JOIN_FILTER_KEY]?: string;
}

/**
 * A party = friends gathering before a game (PUBG style).
 *
 * - The creator becomes the leader. If the leader leaves, the next member
 *   is promoted.
 * - Friends join with the 6-character code.
 * - Each member taps Ready. ONLY the leader may launch, and only when
 *   everyone is ready (rule shared with the app in game-rules).
 * - Launching creates a table and hands every member a reserved seat.
 */
export class PartyRoom extends Room<{ state: PartyState; metadata: { code: string } }> {
  maxClients = SKELETON_PARTY_SIZE;
  state = new PartyState();

  messages = {
    [PARTY_MESSAGES.setReady]: async (client: Client, message: { ready?: boolean } | undefined) => {
      if (this.state.status !== "open") { return; }
      const member = this.state.members.get(client.sessionId);
      if (!member) { return; }
      const ready = Boolean(message?.ready);
      if (ready && this.state.entry > 0) {
        const balance = await getLedger().getBalance(client.auth?.userId ?? "");
        if (balance < this.state.entry) {
          return this.refuse(client, `You need ${this.state.entry.toLocaleString()} coins for this table. You have ${balance.toLocaleString()}.`);
        }
      }
      member.ready = ready;
    },

    [PARTY_MESSAGES.setGame]: (client: Client, choice: PartyGameChoice | undefined) => {
      if (client.sessionId !== this.state.leaderSessionId) return this.refuse(client, "Only the party leader picks the game.");
      if (this.state.status !== "open") return;
      if (!choice || !PARTY_GAMES.includes(choice.game)) return this.refuse(client, "Unknown game.");
      this.state.game = choice.game;
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
      this.state.members.forEach((m) => { m.ready = false; });
    },

    [PARTY_MESSAGES.setTeam]: (client: Client, payload: { sessionId?: string; team?: number } | undefined) => {
      if (client.sessionId !== this.state.leaderSessionId) return this.refuse(client, "Only the party leader assigns teams.");
      if (this.state.status !== "open") return;
      const member = payload?.sessionId ? this.state.members.get(payload.sessionId) : undefined;
      const team = Number(payload?.team);
      if (!member || (team !== 0 && team !== 1)) return this.refuse(client, "Pick a member and a side.");
      member.team = team;
    },

    [PARTY_MESSAGES.launch]: async (client: Client) => {
      await this.launch(client);
    },
  };

  static onAuth = authenticate;

  async onCreate(_options: unknown) {
    this.state.code = generatePartyCode();
    // Metadata is what join-by-code filters on (see app.config.ts).
    await this.setMetadata({ code: this.state.code });
  }

  async onJoin(client: Client, options: PartyJoinOptions) {
    const isCreator = this.state.members.size === 0;

    if (!isCreator && normalizePartyCode(options?.[PARTY_JOIN_FILTER_KEY]) !== this.state.code) {
      throw new ServerError(403, "wrong party code");
    }
    if (this.state.status !== "open") {
      throw new ServerError(409, "this party has already launched");
    }

    const member = new PartyMember();
    member.name = sanitizeDisplayName(options?.name);
    member.team = this.state.members.size % 2; // alternate sides; the leader can change it
    this.state.members.set(client.sessionId, member);

    if (isCreator) {
      this.state.leaderSessionId = client.sessionId;
    }
    // Make sure the player has a wallet (and the one-time starting coins).
    await getLedger().ensureProfile(client.auth?.userId ?? "", member.name, client.auth?.guest ?? true);
    console.log("party", this.state.code, "+", member.name, isCreator ? "(leader)" : "");
  }

  onLeave(client: Client, _code: CloseCode) {
    this.state.members.delete(client.sessionId);

    if (this.state.leaderSessionId === client.sessionId) {
      // Promote whoever joined next. keys() preserves join order.
      const next = this.state.members.keys().next().value;
      this.state.leaderSessionId = next ?? "";
    }
  }

  onDrop(client: Client, _code: CloseCode) {
    // Hold the seat for 30s so a network blip does not eject a friend.
    this.allowReconnection(client, 30).catch(() => {});
  }

  private refuse(client: Client, reason: string) {
    client.send(PARTY_EVENTS.refused, { reason });
  }

  private async launch(leader: Client) {
    if (leader.sessionId !== this.state.leaderSessionId) {
      return this.refuse(leader, "Only the party leader can launch.");
    }

    const members = [...this.state.members.entries()].map(([sessionId, m]) => ({ sessionId, ready: m.ready, team: m.team }));
    if (!canLaunchParty(members, this.state.status, this.state.game)) {
      if (this.state.game === "courtpiece" && members.length !== 4) return this.refuse(leader, "Court Piece needs exactly 4 ready players.");
      if (isTeamGame(this.state.game, members.length) && members.every((m) => m.ready)) return this.refuse(leader, "Teams must be two against two.");
      return this.refuse(leader, "Everyone must be ready first.");
    }
    const seats = seatsForParty(members, this.state.game);

    this.state.status = "launching";
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
        const config = fiverowConfigForPlayers(members.length);
        if (!config) {
          this.state.status = "open";
          return this.refuse(leader, "Five Row needs 2, 3 or 4 players.");
        }
        table = await matchMaker.createRoom(ROOMS.fiverow, { players: config.players, entry: this.state.entry, launchSecret: LAUNCH_SECRET });
      }

      // Reserve one seat per member and hand each phone its own reservation.
      for (const client of this.clients) {
        const member = this.state.members.get(client.sessionId);
        if (!member) { continue; }
        const reservation = await matchMaker.reserveSeatFor(table, { name: member.name, seat: seats.get(client.sessionId) }, client.auth);
        client.send(PARTY_EVENTS.tableReady, reservation);
      }

      this.state.status = "launched";
    } catch (error) {
      console.error("party launch failed", error);
      this.state.status = "open";
      this.refuse(leader, "Could not create the table. Try again.");
    }
  }
}
