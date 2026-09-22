import { randomInt } from "node:crypto";
import { Room, Client, CloseCode, Delayed, ServerError } from "colyseus";
import {
  FIVEROW_ABANDONED_MOVE_DELAY_MS,
  FIVEROW_CELL_COUNT,
  FIVEROW_EVENTS,
  FIVEROW_MESSAGES,
  FIVEROW_TABLE_CONFIGS,
  FIVEROW_TIMEOUTS_TO_ABANDON,
  FIVEROW_TURN_SECONDS,
  IllegalMoveError,
  NO_CHIP,
  createFiveRowMatch,
  currentPlayer,
  fiverowConfigForPlayers,
  isTableEntry,
  mustPass,
  passTurn,
  playMove,
  randomLegalMove,
  sanitizeDisplayName,
  settleTable,
  type FiveRowMatch,
  type FiveRowMove,
  type FiveRowTableConfig,
} from "@gamenite/game-rules";
import { authenticate, type PlayerAuth } from "../auth.js";
import { isTrustedLaunch } from "../launch.js";
import { LedgerError, getLedger } from "../ledger.js";
import { FiveRowRun, FiveRowSeat, FiveRowState } from "./schema/FiveRowState.js";

/** Unpredictable dealing: never Math.random on the server. randomInt's range must stay below 2^48. */
const RANDOM_RANGE = 2 ** 48 - 1;
const secureRandom = () => randomInt(0, RANDOM_RANGE) / RANDOM_RANGE;

/** Set by a lounge start (trusted) or by quick play. */
export interface FiveRowRoomOptions {
  players?: number;
  /** Coins each seat pays: 0, 500, 2000 or 10000. */
  entry?: number;
  launchSecret?: string;
  /** Seats the lounge reserved for its members; other players take the rest. */
  heldSeats?: number[];
}

/**
 * What arrives in onJoin. A lounge reservation carries `seat` and the
 * launch secret (set server-side, never seen by phones); a phone's own
 * quick-play options never can, so a phone cannot pick a seat.
 */
export interface FiveRowJoinOptions {
  name?: string;
  seat?: number;
  launchSecret?: string;
}

/** How long a lounge's held seats wait for their owners before anyone may take them. */
const HELD_SEAT_MS = 20_000;

/**
 * One Five Row table. The pure engine in @gamenite/game-rules decides
 * everything about the game; this room only handles seats, timers,
 * private hands, and the founder's timeout policy.
 */
export class FiveRowRoom extends Room<{ state: FiveRowState; metadata: { players: number; entry: number } }> {
  state = new FiveRowState();

  private config: FiveRowTableConfig = FIVEROW_TABLE_CONFIGS[0];
  private match: FiveRowMatch | null = null;
  /** sessionId per seat; teammates alternate (seat % teams). */
  private order: (string | undefined)[] = [];
  /** A lounge start may place players in chosen seats. */
  private trusted = false;
  /** Seats reserved by the lounge, so an early stranger cannot sit in them. */
  private held = new Set<number>();
  /** Coins each seat paid. */
  private entry = 0;
  /** userId per sessionId, for the ledger. */
  private userOf = new Map<string, string>();
  /** Users refunded after leaving early; they may not re-enter for free. */
  private refunded = new Set<string>();
  private settled = false;
  private turnTimer?: Delayed;
  private turnSeconds = FIVEROW_TURN_SECONDS;

  static onAuth = authenticate;

  messages = {
    [FIVEROW_MESSAGES.move]: (client: Client, move: FiveRowMove) => this.handleMove(client, move),
    [FIVEROW_MESSAGES.pass]: (client: Client) => this.handlePass(client),
    [FIVEROW_MESSAGES.sync]: (client: Client) => this.sendPrivate(client),
  };

  async onCreate(options: FiveRowRoomOptions | undefined) {
    this.config = fiverowConfigForPlayers(Number(options?.players ?? 2)) ?? FIVEROW_TABLE_CONFIGS[0];
    this.maxClients = this.config.players;
    this.trusted = isTrustedLaunch(options);
    this.order = new Array(this.config.players).fill(undefined);
    if (this.trusted && Array.isArray(options?.heldSeats)) {
      this.held = new Set(options!.heldSeats!.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < this.order.length));
      this.clock.setTimeout(() => this.held.clear(), HELD_SEAT_MS);
    }
    this.entry = isTableEntry(options?.entry) ? Number(options!.entry) : 0;
    this.state.entry = this.entry;
    // Quick play filters on these so seekers land at the right size and tier.
    await this.setMetadata({ players: this.config.players, entry: this.entry });
    this.state.players = this.config.players;
    this.state.teams = this.config.teams;
    for (let i = 0; i < FIVEROW_CELL_COUNT; i++) {
      this.state.chips.push(NO_CHIP);
      this.state.locked.push(false);
    }
    // Tests shorten turns through the environment; clients cannot.
    this.turnSeconds = Number(process.env.FIVEROW_TURN_SECONDS) || FIVEROW_TURN_SECONDS;
  }

  async onJoin(client: Client, options: FiveRowJoinOptions | undefined) {
    const auth = client.auth as PlayerAuth;
    const name = sanitizeDisplayName(options?.name);
    // Look before charging: never take coins from someone who cannot sit.
    if (!this.hasSeatFor(options)) throw new ServerError(409, "No free seat at this table right now.");
    await this.chargeSeat(auth, name);
    if (!this.hasSeatFor(options)) {
      // Someone slipped in during the charge: give the coins straight back.
      if (this.entry > 0) await getLedger().settleTable(this.roomId, [{ playerId: auth.userId, amount: this.entry, kind: "table_refund" }]);
      throw new ServerError(409, "No free seat at this table right now.");
    }

    const index = this.seatFor(options);
    this.held.delete(index);

    const seat = new FiveRowSeat();
    seat.name = name;
    seat.team = index % this.config.teams;
    this.state.seats.set(client.sessionId, seat);
    this.order[index] = client.sessionId;
    this.userOf.set(client.sessionId, auth.userId);

    if (this.order.every((id) => id !== undefined)) {
      this.lock();
      this.startMatch();
    }
  }

  onDrop(client: Client, _code: CloseCode) {
    const seat = this.state.seats.get(client.sessionId);
    if (seat) seat.connected = false;
    // The turn timer keeps running; a dropped player simply gets auto-played.
    this.allowReconnection(client, 60).catch(() => {});
  }

  onReconnect(client: Client) {
    const seat = this.state.seats.get(client.sessionId);
    if (seat) seat.connected = true;
    this.sendPrivate(client);
  }

  onLeave(client: Client, _code: CloseCode) {
    const seat = this.state.seats.get(client.sessionId);
    if (!seat) return;
    seat.connected = false;

    if (this.state.phase === "waiting") {
      // Free the seat for someone else, and give the entry back.
      this.state.seats.delete(client.sessionId);
      this.order = this.order.map((id) => (id === client.sessionId ? undefined : id));
      void this.refundSeat(client.sessionId);
      this.unlock();
      return;
    }

    if (this.state.phase === "playing") {
      this.abandon(client.sessionId);
      if (this.match && this.match.winner === null && currentPlayer(this.match).id === client.sessionId) {
        this.autoPlay(client.sessionId, false);
      } else {
        this.afterChange();
      }
    }
  }

  onDispose() {
    this.turnTimer?.clear();
  }

  // ------------------------------------------------------------ match flow

  private startMatch() {
    this.match = createFiveRowMatch(this.order as string[], { teams: this.config.teams }, secureRandom);
    this.state.phase = "playing";
    this.afterChange();
  }

  /** Mirror the engine into the synced state, deliver hands, arm the timer. */
  private afterChange() {
    const m = this.match;
    if (!m) return;

    m.board.chips.forEach((chip, i) => { this.state.chips[i] = chip === null ? NO_CHIP : chip; });
    m.board.locked.forEach((flag, i) => { this.state.locked[i] = flag; });

    this.state.runs.clear();
    for (const run of m.board.runs) {
      const r = new FiveRowRun();
      r.team = run.team;
      for (const c of run.cells) r.cells.push(c);
      this.state.runs.push(r);
    }

    for (const p of m.players) {
      const seat = this.state.seats.get(p.id);
      if (seat) seat.handCount = p.hand.length;
    }

    this.state.turnSessionId = currentPlayer(m).id;
    this.state.exchangedThisTurn = m.exchangedThisTurn;
    this.state.drawPileCount = m.drawPile.length;
    this.state.winnerTeam = m.winner ?? NO_CHIP;

    if (m.winner !== null || m.stalemate) {
      this.state.phase = "finished";
      this.state.turnDeadline = 0;
      this.turnTimer?.clear();
      void this.settleCoins(m.winner);
    }

    for (const client of this.clients) this.sendPrivate(client);
    if (this.state.phase === "playing") this.beginTurn();
  }

  /** Clock and hand go to ONE phone; never into shared state. */
  private sendPrivate(client: Client) {
    client.send(FIVEROW_EVENTS.clock, { now: this.clock.currentTime });
    const player = this.match?.players.find((p) => p.id === client.sessionId);
    if (player) client.send(FIVEROW_EVENTS.hand, { cards: player.hand });
  }

  private beginTurn() {
    this.turnTimer?.clear();
    const m = this.match;
    if (!m || this.state.phase !== "playing") return;

    const current = currentPlayer(m);
    const seat = this.state.seats.get(current.id);

    if (!seat || seat.abandoned) {
      // Abandoned seats play instantly, after a short beat so others can follow.
      this.state.turnDeadline = 0;
      this.turnTimer = this.clock.setTimeout(() => this.autoPlay(current.id, false), FIVEROW_ABANDONED_MOVE_DELAY_MS);
      return;
    }

    const ms = this.turnSeconds * 1000;
    this.state.turnDeadline = this.clock.currentTime + ms;
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(current.id, true), ms);
  }

  /** Founder's policy: the server plays a random legal card for a slow player. */
  private autoPlay(sessionId: string, countsAsTimeout: boolean) {
    const m = this.match;
    if (!m || this.state.phase !== "playing" || currentPlayer(m).id !== sessionId) return;

    const seat = this.state.seats.get(sessionId);
    if (countsAsTimeout && seat) {
      seat.timeouts++;
      if (seat.timeouts >= FIVEROW_TIMEOUTS_TO_ABANDON && !seat.abandoned) {
        this.abandon(sessionId);
        if (this.match?.winner !== null) { this.afterChange(); return; }
      }
    }

    // An exchange keeps the turn, so loop until the turn actually passes.
    let guard = 0;
    while (this.match && this.match.winner === null && !this.match.stalemate && currentPlayer(this.match).id === sessionId && guard++ < 3) {
      const move = randomLegalMove(this.match, sessionId, secureRandom);
      this.match = move ? playMove(this.match, sessionId, move, secureRandom).match : passTurn(this.match, sessionId);
    }
    this.afterChange();
  }

  /** Mark a seat abandoned; if only one team is still present, it wins. */
  private abandon(sessionId: string) {
    const seat = this.state.seats.get(sessionId);
    if (!seat || seat.abandoned) return;
    seat.abandoned = true;

    const present = new Set<number>();
    this.state.seats.forEach((s) => { if (!s.abandoned) present.add(s.team); });
    if (present.size === 1 && this.match && this.match.winner === null) {
      const [winner] = [...present];
      this.match = { ...this.match, winner };
    }
  }

  // ------------------------------------------------------------ coins

  /** Wallet check and entry charge, BEFORE any seat state changes. Throws to reject the join. */
  /** The seat this joiner would get: the lounge's choice for its members, else the first free seat nobody is holding. */
  private seatFor(options: FiveRowJoinOptions | undefined): number {
    const wanted = Number(options?.seat);
    const fromLounge = this.trusted && isTrustedLaunch(options);
    if (fromLounge && Number.isInteger(wanted) && wanted >= 0 && wanted < this.order.length && this.order[wanted] === undefined) return wanted;
    return this.order.findIndex((id, i) => id === undefined && !this.held.has(i));
  }

  private hasSeatFor(options: FiveRowJoinOptions | undefined): boolean {
    return this.seatFor(options) >= 0;
  }

  private async chargeSeat(auth: PlayerAuth, name: string) {
    const ledger = getLedger();
    await ledger.ensureProfile(auth.userId, name, auth.guest);
    if (this.entry === 0) return;
    if (this.refunded.has(auth.userId)) throw new ServerError(403, "You left this table; join another one.");
    try {
      await ledger.chargeTableEntry(auth.userId, this.roomId, this.entry);
    } catch (error) {
      if (error instanceof LedgerError) {
        const balance = await ledger.getBalance(auth.userId);
        throw new ServerError(402, `You need ${this.entry.toLocaleString()} coins for this table. You have ${balance.toLocaleString()}.`);
      }
      throw error;
    }
  }

  private async refundSeat(sessionId: string) {
    const userId = this.userOf.get(sessionId);
    this.userOf.delete(sessionId);
    if (!userId || this.entry === 0) return;
    this.refunded.add(userId);
    await getLedger().settleTable(this.roomId, [{ playerId: userId, amount: this.entry, kind: "table_refund" }]).catch((e) => console.error("refund failed", e));
  }

  /** Once per table: winners take the losers' entries minus the fee; a draw refunds. */
  private async settleCoins(winnerTeam: number | null) {
    if (this.settled || this.entry === 0) return;
    this.settled = true;
    const seats: { playerId: string; team: number }[] = [];
    this.state.seats.forEach((seat, sessionId) => {
      const userId = this.userOf.get(sessionId);
      if (userId) seats.push({ playerId: userId, team: seat.team });
    });
    const settlement = settleTable(this.entry, seats, winnerTeam);
    await getLedger().settleTable(this.roomId, settlement.moves).catch((e) => console.error("settlement failed", e));
  }

  // ------------------------------------------------------------ messages

  private refuse(client: Client, reason: string) {
    client.send(FIVEROW_EVENTS.refused, { reason });
  }

  private handleMove(client: Client, move: FiveRowMove) {
    if (!this.match || this.state.phase !== "playing") return this.refuse(client, "The game is not running.");
    if (!move || typeof move !== "object" || !move.card || typeof move.card.rank !== "string" || typeof move.card.suit !== "string") {
      return this.refuse(client, "That move is not valid.");
    }
    try {
      const { match } = playMove(this.match, client.sessionId, move, secureRandom);
      this.match = match;
      const seat = this.state.seats.get(client.sessionId);
      if (seat) seat.timeouts = 0;
      this.afterChange();
    } catch (error) {
      if (error instanceof IllegalMoveError) return this.refuse(client, "That move is not allowed right now.");
      throw error;
    }
  }

  private handlePass(client: Client) {
    if (!this.match || this.state.phase !== "playing") return this.refuse(client, "The game is not running.");
    if (!mustPass(this.match, client.sessionId)) return this.refuse(client, "You still have a legal move.");
    this.match = passTurn(this.match, client.sessionId);
    const seat = this.state.seats.get(client.sessionId);
    if (seat) seat.timeouts = 0;
    this.afterChange();
  }
}
