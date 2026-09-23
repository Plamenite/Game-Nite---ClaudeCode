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
  VOICE_EVENTS,
  VOICE_FREE_MINUTES_PER_DAY,
  VOICE_MESSAGES,
  voiceUidFor,
  canStartLounge,
  fiverowConfigForPlayers,
  isLoungeFormat,
  isTableEntry,
  isTeamGame,
  normalizeLoungeCode,
  seatsForLounge,
  type LoungeGameChoice,
} from "@gamenite/game-rules";
import { authenticate, type PlayerAuth } from "../auth.js";
import { LAUNCH_SECRET } from "../launch.js";
import { getLedger } from "../ledger.js";
import * as presence from "../presence.js";
import { getVoice } from "../voice-provider.js";
import { resolveName } from "./names.js";

/** How often mic-on time is written down and checked against the allowance. */
const VOICE_METER_MS = 60_000;
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
  /** userId per sessionId, for friendship checks and presence. */
  private userOf = new Map<string, string>();
  /** player code per sessionId (voice uids and mute-for-me use it). */
  private codeOf = new Map<string, string>();
  /** When each member's mic went on, for metering. */
  private micSince = new Map<string, number>();

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

    [VOICE_MESSAGES.setMic]: async (client: Client, payload: { on?: boolean } | undefined) => {
      const member = this.state.members.get(client.sessionId);
      if (!member) return this.refuse(client, "Only people in the lounge can talk.");
      const on = Boolean(payload?.on);
      if (!on) return this.micOff(client.sessionId);
      if (member.mic) return;
      const userId = this.userOf.get(client.sessionId) ?? "";
      const used = await getLedger().voiceSecondsToday(userId);
      if (used >= VOICE_FREE_MINUTES_PER_DAY * 60) {
        return this.refuse(client, "Your free voice minutes for today are used up.");
      }
      member.mic = true;
      this.micSince.set(client.sessionId, Date.now());
    },

    [VOICE_MESSAGES.joinVoice]: (client: Client) => {
      if (!this.state.members.has(client.sessionId)) return this.refuse(client, "Only people in the lounge can talk.");
      if (!getVoice().configured) return this.refuse(client, "Voice is not set up yet.");
      const code = this.codeOf.get(client.sessionId) ?? "";
      client.send(VOICE_EVENTS.token, getVoice().ticket(this.state.code, voiceUidFor(code)));
    },
  };

  static onAuth = authenticate;

  async onCreate(options: LoungeJoinOptions) {
    const code = normalizeLoungeCode(options?.[LOUNGE_JOIN_FILTER_KEY]);
    if (!code) throw new Error("a lounge needs its owner's code");
    this.state.code = code;
    // Metadata is what join-by-code filters on (see app.config.ts).
    await this.setMetadata({ code });
    // Voice is metered by the server: write down mic-on time regularly.
    this.clock.setInterval((): void => {
      void this.meterVoice();
    }, VOICE_METER_MS);
  }

  async onJoin(client: Client, options: LoungeJoinOptions) {
    const auth = client.auth as PlayerAuth;
    const userId = auth.userId;
    if (normalizeLoungeCode(options?.[LOUNGE_JOIN_FILTER_KEY]) !== this.state.code) {
      throw new ServerError(403, "wrong lounge code");
    }
    // First sight creates the profile (wallet, starting coins, name).
    const name = await resolveName(auth, options?.name);
    const myCode = await getLedger().playerCode(userId);
    const isOwner = myCode === this.state.code;
    this.userOf.set(client.sessionId, userId);
    this.codeOf.set(client.sessionId, myCode);

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
    // DECIDED: only friends of someone inside may knock.
    const insiders = [...this.state.members.keys()].map((sid) => this.userOf.get(sid) ?? "");
    const friendOfSomeone = (await Promise.all(insiders.map((id) => (id ? getLedger().areFriends(userId, id) : false)))).some(Boolean);
    if (!friendOfSomeone) {
      throw new ServerError(403, "Add someone in this lounge as a friend first.");
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
    if (this.state.members.has(client.sessionId)) {
      this.micOff(client.sessionId);
      presence.exit(this.userOf.get(client.sessionId) ?? "", `lounge:${this.state.code}`);
    }
    this.userOf.delete(client.sessionId);
    this.codeOf.delete(client.sessionId);
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
    member.playerCode = this.codeOf.get(client.sessionId) ?? "";
    this.state.members.set(client.sessionId, member);
    if (!this.state.leaderSessionId || !this.state.members.has(this.state.leaderSessionId)) {
      this.state.leaderSessionId = client.sessionId;
    }
    presence.enter(this.userOf.get(client.sessionId) ?? "", `lounge:${this.state.code}`);
    console.log("lounge", this.state.code, "+", name, this.state.leaderSessionId === client.sessionId ? "(leader)" : "");
  }

  /** Mic off: write down the seconds it was on. Safe to call when it was already off. */
  private micOff(sessionId: string) {
    const member = this.state.members.get(sessionId);
    const since = this.micSince.get(sessionId);
    if (member) member.mic = false;
    this.micSince.delete(sessionId);
    if (since !== undefined) {
      const seconds = Math.max(1, Math.round((Date.now() - since) / 1000));
      void getLedger().addVoiceSeconds(this.userOf.get(sessionId) ?? "", seconds).catch((e) => console.error("voice metering failed", e));
    }
  }

  /** Every minute: bank the time so far and switch off anyone past the day's allowance. */
  private async meterVoice() {
    for (const [sessionId, since] of [...this.micSince.entries()]) {
      const userId = this.userOf.get(sessionId) ?? "";
      const seconds = Math.round((Date.now() - since) / 1000);
      this.micSince.set(sessionId, Date.now());
      const total = await getLedger().addVoiceSeconds(userId, seconds).catch(() => 0);
      if (total >= VOICE_FREE_MINUTES_PER_DAY * 60) {
        this.micSince.delete(sessionId);
        const member = this.state.members.get(sessionId);
        if (member) member.mic = false;
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.refuse(client, "Your free voice minutes for today are used up.");
      }
    }
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
      if (members.length > this.state.players) return this.refuse(leader, "Pick a table with a seat for everyone here.");
      if (members.every((m) => m.ready) && isTeamGame(this.state.game, this.state.players)) {
        return this.refuse(leader, members.length === 3 ? "Sides must be two and one." : "Sides must be two against two.");
      }
      return this.refuse(leader, "Everyone must be ready first.");
    }
    const seats = seatsForLounge(members, this.state.game, this.state.players);
    // DECIDED: empty seats are filled with other players at the same tier,
    // and a table with other players at it is one deal with a rematch vote.
    const seatsToFill = this.state.players - members.length;
    const bestOf = seatsToFill > 0 ? 1 : this.state.bestOf;
    const heldSeats = [...seats.values()];

    this.state.status = "starting";
    try {
      let table;
      if (this.state.game === "courtpiece") {
        table = await matchMaker.createRoom(ROOMS.courtpiece, {
          variant: this.state.variant,
          bestOf,
          entry: this.state.entry,
          launchSecret: LAUNCH_SECRET,
          heldSeats,
        });
      } else {
        const config = fiverowConfigForPlayers(this.state.players);
        if (!config) {
          this.state.status = "open";
          return this.refuse(leader, "Five Row needs 2, 3 or 4 players.");
        }
        table = await matchMaker.createRoom(ROOMS.fiverow, { players: config.players, entry: this.state.entry, launchSecret: LAUNCH_SECRET, heldSeats });
      }

      // Reserve one seat per member and hand each phone its own reservation.
      // The secret rides inside the reservation (server-side only), which is
      // how the table knows this seat choice is the lounge's, not a phone's.
      for (const client of this.clients) {
        const member = this.state.members.get(client.sessionId);
        if (!member) continue;
        const reservation = await matchMaker.reserveSeatFor(
          table,
          { name: member.name, seat: seats.get(client.sessionId), launchSecret: LAUNCH_SECRET },
          client.auth,
        );
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
