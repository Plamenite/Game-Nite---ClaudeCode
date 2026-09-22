import { randomInt } from "node:crypto";
import { Room, Client, CloseCode, Delayed, ServerError } from "colyseus";
import {
  ABANDONED_MOVE_DELAY_MS,
  BETWEEN_DEALS_MS,
  COURTPIECE_EVENTS,
  COURTPIECE_MESSAGES,
  COURT_PIECE_PRIVATE_BEST_OF,
  COURT_PIECE_PUBLIC_BEST_OF,
  COURT_PIECE_VARIANTS,
  IllegalPlayError,
  TIMEOUTS_TO_ABANDON,
  TURN_SECONDS,
  cardId,
  createCourtPieceMatch,
  createSeries,
  isTableEntry,
  legalPlaysFor,
  playCard,
  recordDeal,
  rematch,
  sanitizeDisplayName,
  seatTeam,
  settleTable,
  type Card,
  type CourtPieceBestOf,
  type CourtPieceMatch,
  type CourtPieceSeries,
  type CourtPieceVariant,
  type PlayResult,
} from "@gamenite/game-rules";
import { authenticate, type PlayerAuth } from "../auth.js";
import { isTrustedLaunch } from "../launch.js";
import { LedgerError, getLedger } from "../ledger.js";
import * as presence from "../presence.js";
import { resolveName } from "./names.js";
import { CourtPieceSeat, CourtPieceState, TrickPlay } from "./schema/CourtPieceState.js";

/** Unpredictable dealing: never Math.random on the server. */
const RANDOM_RANGE = 2 ** 48 - 1;
const secureRandom = () => randomInt(0, RANDOM_RANGE) / RANDOM_RANGE;

const PLAYERS = 4;

/** Set by a lounge start (trusted) or by quick play (variant only). */
export interface CourtPieceRoomOptions {
  variant?: CourtPieceVariant;
  bestOf?: CourtPieceBestOf;
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
export interface CourtPieceJoinOptions {
  name?: string;
  seat?: number;
  launchSecret?: string;
}

/** How long a lounge's held seats wait for their owners before anyone may take them. */
const HELD_SEAT_MS = 20_000;

/**
 * One Court Piece table. The pure engine decides the game; this room
 * handles seats, timers, private hands, the series, and the founder's
 * timeout policy.
 */
export class CourtPieceRoom extends Room<{ state: CourtPieceState; metadata: { variant: string; entry: number } }> {
  state = new CourtPieceState();
  maxClients = PLAYERS;

  /** sessionId per seat, 0..3. */
  private order: (string | undefined)[] = new Array(PLAYERS).fill(undefined);
  private seatOf = new Map<string, number>();
  private trusted = false;
  /** Seats reserved by the lounge, so an early stranger cannot sit in them. */
  private held = new Set<number>();
  private entry = 0;
  private userOf = new Map<string, string>();
  private refunded = new Set<string>();
  /** Each series (the first, then every rematch) is its own table for the ledger. */
  private seriesIndex = 1;
  private settled = false;
  private series: CourtPieceSeries | null = null;
  private match: CourtPieceMatch | null = null;
  private turnTimer?: Delayed;
  private betweenDeals?: Delayed;
  private turnSeconds = TURN_SECONDS;

  static onAuth = authenticate;

  messages = {
    [COURTPIECE_MESSAGES.play]: (client: Client, payload: { card?: Card } | undefined) => this.handlePlay(client, payload),
    [COURTPIECE_MESSAGES.sync]: (client: Client) => this.sendPrivate(client),
    [COURTPIECE_MESSAGES.rematch]: (client: Client) => this.handleRematch(client),
  };

  async onCreate(options: CourtPieceRoomOptions | undefined) {
    const variant = COURT_PIECE_VARIANTS.some((v) => v.id === options?.variant) ? (options!.variant as CourtPieceVariant) : "single_siri";
    // Only a lounge start may set a series length; quick play is always one deal.
    const requested = Number(options?.bestOf);
    const bestOf = isTrustedLaunch(options) && (COURT_PIECE_PRIVATE_BEST_OF as readonly number[]).includes(requested)
      ? (requested as CourtPieceBestOf)
      : COURT_PIECE_PUBLIC_BEST_OF;

    this.state.variant = variant;
    this.state.bestOf = bestOf;
    this.trusted = isTrustedLaunch(options);
    if (this.trusted && Array.isArray(options?.heldSeats)) {
      this.held = new Set(options!.heldSeats!.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < PLAYERS));
      this.clock.setTimeout(() => this.held.clear(), HELD_SEAT_MS);
    }
    this.entry = isTableEntry(options?.entry) ? Number(options!.entry) : 0;
    this.state.entry = this.entry;
    await this.setMetadata({ variant, entry: this.entry });
    // Tests shorten turns through the environment; clients cannot.
    this.turnSeconds = Number(process.env.COURTPIECE_TURN_SECONDS) || TURN_SECONDS;
  }

  async onJoin(client: Client, options: CourtPieceJoinOptions | undefined) {
    const auth = client.auth as PlayerAuth;
    const name = await resolveName(auth, options?.name);
    // Look before charging: never take coins from someone who cannot sit.
    if (!this.hasSeatFor(options)) throw new ServerError(409, "No free seat at this table right now.");
    await this.chargeSeat(auth, name);
    if (!this.hasSeatFor(options)) {
      // Someone slipped in during the charge: give the coins straight back.
      if (this.entry > 0) await getLedger().settleTable(this.tableKey(), [{ playerId: auth.userId, amount: this.entry, kind: "table_refund" }]);
      throw new ServerError(409, "No free seat at this table right now.");
    }

    const seatIndex = this.seatFor(options);
    this.held.delete(seatIndex);

    const seat = new CourtPieceSeat();
    seat.name = name;
    seat.seat = seatIndex;
    seat.team = seatTeam(seatIndex);
    this.state.seats.set(client.sessionId, seat);
    this.order[seatIndex] = client.sessionId;
    this.seatOf.set(client.sessionId, seatIndex);
    this.userOf.set(client.sessionId, auth.userId);
    presence.enter(auth.userId, "table");

    if (this.order.every((id) => id !== undefined)) {
      this.lock();
      this.series = createSeries(this.state.bestOf as CourtPieceBestOf, 0);
      this.startDeal();
    }
  }

  onDrop(client: Client, _code: CloseCode) {
    const seat = this.state.seats.get(client.sessionId);
    if (seat) seat.connected = false;
    this.allowReconnection(client, 60).catch(() => {});
  }

  onReconnect(client: Client) {
    const seat = this.state.seats.get(client.sessionId);
    if (seat) seat.connected = true;
    this.sendPrivate(client);
  }

  onLeave(client: Client, _code: CloseCode) {
    presence.exit(this.userOf.get(client.sessionId) ?? "", "table");
    const seat = this.state.seats.get(client.sessionId);
    if (!seat) return;
    seat.connected = false;

    if (this.state.phase === "waiting") {
      this.state.seats.delete(client.sessionId);
      this.order = this.order.map((id) => (id === client.sessionId ? undefined : id));
      this.seatOf.delete(client.sessionId);
      void this.refundSeat(client.sessionId);
      this.unlock();
      return;
    }

    this.abandon(client.sessionId);
    if (this.state.phase === "playing" && this.match && this.match.current === seat.seat) {
      this.autoPlay(seat.seat, false);
    }
  }

  onDispose() {
    this.turnTimer?.clear();
    this.betweenDeals?.clear();
  }

  // ------------------------------------------------------------ deals

  private startDeal() {
    if (!this.series || this.series.winner !== null) return;
    this.match = createCourtPieceMatch(this.series.nextDealer, { variant: this.state.variant as CourtPieceVariant }, secureRandom);
    this.state.dealNumber = this.series.deals.length + 1;
    this.state.phase = "playing";
    this.state.dealResult = "";
    this.state.dealWinner = -1;
    this.state.lastTrick.clear();
    this.state.seats.forEach((s) => { s.wantsRematch = false; });
    this.sync();
    for (const client of this.clients) this.sendPrivate(client);
    this.beginTurn();
  }

  private endDeal() {
    const m = this.match;
    if (!m || !this.series || m.winner === null || m.result === null) return;
    this.series = recordDeal(this.series, { winner: m.winner, result: m.result, collected: m.collected });
    this.state.dealWinner = m.winner;
    this.state.dealResult = m.result;
    this.afterDeal();
  }

  /** A whole team has left: the other team wins the deal and the series. */
  private forfeit(losingTeam: number) {
    if (!this.series) return;
    const winner = 1 - losingTeam;
    this.turnTimer?.clear();
    this.betweenDeals?.clear();
    this.series = { ...this.series, winner };
    this.state.dealWinner = winner;
    this.state.dealResult = "forfeit";
    this.state.phase = "finished";
    this.state.turnDeadline = 0;
    this.syncSeries();
    void this.settleCoins(winner);
  }

  private afterDeal() {
    this.turnTimer?.clear();
    this.state.turnDeadline = 0;
    this.syncSeries();
    if (this.series?.winner !== null) {
      this.state.phase = "finished";
      void this.settleCoins(this.series!.winner);
      return;
    }
    this.state.phase = "between_deals";
    this.betweenDeals = this.clock.setTimeout(() => this.startDeal(), BETWEEN_DEALS_MS);
  }

  private async handleRematch(client: Client) {
    if (this.state.phase !== "finished" || !this.series) return this.refuse(client, "The match is still going.");
    const seat = this.state.seats.get(client.sessionId);
    if (!seat || seat.abandoned) return this.refuse(client, "You have left this table.");
    if (this.entry > 0) {
      const balance = await getLedger().getBalance(this.userOf.get(client.sessionId) ?? "");
      if (balance < this.entry) return this.refuse(client, `You need ${this.entry.toLocaleString()} coins for a rematch. You have ${balance.toLocaleString()}.`);
    }
    seat.wantsRematch = true;

    let everyone = true;
    this.state.seats.forEach((s) => { if (s.abandoned || !s.wantsRematch) everyone = false; });
    if (!everyone) return;

    // A rematch is a new table for the ledger: everyone pays again.
    if (this.entry > 0 && !(await this.chargeEveryone())) return;

    this.series = rematch(this.series);
    this.settled = false;
    this.state.seriesWinner = -1;
    this.state.score0 = 0;
    this.state.score1 = 0;
    this.startDeal();
  }

  // ------------------------------------------------------------ coins

  private tableKey() {
    return `${this.roomId}#${this.seriesIndex}`;
  }

  /** Wallet check and entry charge, BEFORE any seat state changes. Throws to reject the join. */
  /** The seat this joiner would get: the lounge's choice for its members, else the first free seat nobody is holding. */
  private seatFor(options: CourtPieceJoinOptions | undefined): number {
    const wanted = Number(options?.seat);
    const fromLounge = this.trusted && isTrustedLaunch(options);
    if (fromLounge && Number.isInteger(wanted) && wanted >= 0 && wanted < PLAYERS && this.order[wanted] === undefined) return wanted;
    return this.order.findIndex((id, i) => id === undefined && !this.held.has(i));
  }

  private hasSeatFor(options: CourtPieceJoinOptions | undefined): boolean {
    return this.seatFor(options) >= 0;
  }

  private async chargeSeat(auth: PlayerAuth, name: string) {
    const ledger = getLedger();
    await ledger.ensureProfile(auth.userId, name, auth.guest);
    if (this.entry === 0) return;
    if (this.refunded.has(auth.userId)) throw new ServerError(403, "You left this table; join another one.");
    try {
      await ledger.chargeTableEntry(auth.userId, this.tableKey(), this.entry);
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
    await getLedger().settleTable(this.tableKey(), [{ playerId: userId, amount: this.entry, kind: "table_refund" }]).catch((e) => console.error("refund failed", e));
  }

  /** Rematch: charge all four for the new series; undo and abort if anyone falls short. */
  private async chargeEveryone(): Promise<boolean> {
    const ledger = getLedger();
    this.seriesIndex++;
    const charged: string[] = [];
    for (const client of this.clients) {
      const userId = this.userOf.get(client.sessionId);
      if (!userId) continue;
      try {
        await ledger.chargeTableEntry(userId, this.tableKey(), this.entry);
        charged.push(userId);
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        await ledger.settleTable(this.tableKey(), charged.map((id) => ({ playerId: id, amount: this.entry, kind: "table_refund" as const }))).catch(() => {});
        const seat = this.state.seats.get(client.sessionId);
        this.state.seats.forEach((s) => { s.wantsRematch = false; });
        this.broadcast(COURTPIECE_EVENTS.refused, { reason: `${seat?.name ?? "A player"} cannot afford the rematch.` });
        return false;
      }
    }
    return true;
  }

  /** Once per series: winners take the losers' entries minus the fee. */
  private async settleCoins(winnerTeam: number) {
    if (this.settled || this.entry === 0) return;
    this.settled = true;
    const seats: { playerId: string; team: number }[] = [];
    this.state.seats.forEach((seat, sessionId) => {
      const userId = this.userOf.get(sessionId);
      if (userId) seats.push({ playerId: userId, team: seat.team });
    });
    const settlement = settleTable(this.entry, seats, winnerTeam);
    await getLedger().settleTable(this.tableKey(), settlement.moves).catch((e) => console.error("settlement failed", e));
  }

  // ------------------------------------------------------------ turns

  private beginTurn() {
    this.turnTimer?.clear();
    const m = this.match;
    if (!m || this.state.phase !== "playing") return;

    const sessionId = this.order[m.current] ?? "";
    const seat = this.state.seats.get(sessionId);
    if (!seat || seat.abandoned) {
      this.state.turnDeadline = 0;
      this.turnTimer = this.clock.setTimeout(() => this.autoPlay(m.current, false), ABANDONED_MOVE_DELAY_MS);
      return;
    }
    const ms = this.turnSeconds * 1000;
    this.state.turnDeadline = this.clock.currentTime + ms;
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(m.current, true), ms);
  }

  /** Founder's policy: the server plays a random legal card for a slow player. */
  private autoPlay(seatIndex: number, countsAsTimeout: boolean) {
    const m = this.match;
    if (!m || this.state.phase !== "playing" || m.current !== seatIndex) return;

    const sessionId = this.order[seatIndex] ?? "";
    const seat = this.state.seats.get(sessionId);
    if (countsAsTimeout && seat) {
      seat.timeouts++;
      if (seat.timeouts >= TIMEOUTS_TO_ABANDON && !seat.abandoned) {
        this.abandon(sessionId);
        if (this.state.phase !== "playing") return;
      }
    }

    const legal = legalPlaysFor(m, seatIndex);
    if (legal.length === 0) return; // cannot happen mid-deal; hands never run dry early
    const card = legal[Math.floor(secureRandom() * legal.length)];
    this.applyPlay(seatIndex, card);
  }

  private abandon(sessionId: string) {
    const seat = this.state.seats.get(sessionId);
    if (!seat || seat.abandoned) return;
    seat.abandoned = true;

    if (this.state.phase === "finished") return;
    const present = [0, 0];
    this.state.seats.forEach((s) => { if (!s.abandoned) present[s.team]++; });
    if (present[seat.team] === 0) this.forfeit(seat.team);
  }

  // ------------------------------------------------------------ plays

  private refuse(client: Client, reason: string) {
    client.send(COURTPIECE_EVENTS.refused, { reason });
  }

  private handlePlay(client: Client, payload: { card?: Card } | undefined) {
    if (!this.match || this.state.phase !== "playing") return this.refuse(client, "The deal is not running.");
    const card = payload?.card;
    if (!card || typeof card !== "object" || typeof card.rank !== "string" || typeof card.suit !== "string") {
      return this.refuse(client, "That card is not valid.");
    }
    const seatIndex = this.seatOf.get(client.sessionId);
    if (seatIndex === undefined) return this.refuse(client, "You are not seated here.");
    try {
      this.applyPlay(seatIndex, { rank: card.rank, suit: card.suit });
      const seat = this.state.seats.get(client.sessionId);
      if (seat) seat.timeouts = 0;
    } catch (error) {
      if (error instanceof IllegalPlayError) return this.refuse(client, "That card cannot be played right now.");
      throw error;
    }
  }

  /** Runs the engine for one card, then mirrors, delivers hands, and re-arms the timer. */
  private applyPlay(seatIndex: number, card: Card) {
    const m = this.match;
    if (!m) return;
    const result: PlayResult = playCard(m, seatIndex, card);
    this.match = result.match;

    if (result.trick) {
      this.state.lastTrick.clear();
      for (const p of result.trick.plays) this.state.lastTrick.push(trickPlay(p.seat, p.card));
    }
    this.sync();
    for (const client of this.clients) this.sendPrivate(client);

    if (this.match.phase === "finished") this.endDeal();
    else this.beginTurn();
  }

  // ------------------------------------------------------------ sync

  private sync() {
    const m = this.match;
    if (!m) return;
    this.state.trump = m.trump ?? "";
    this.state.trumpSetterSeat = m.trumpSetter ?? -1;
    this.state.leaderSeat = m.leader;
    this.state.currentSeat = m.phase === "playing" ? m.current : -1;
    this.state.trick.clear();
    for (const p of m.trick) this.state.trick.push(trickPlay(p.seat, p.card));
    this.state.tricksPlayed = m.completed.length;
    this.state.collected0 = m.collected[0];
    this.state.collected1 = m.collected[1];
    this.state.heap = m.heap;
    this.state.turnSessionId = m.phase === "playing" ? this.order[m.current] ?? "" : "";
    m.hands.forEach((hand, i) => {
      const seat = this.state.seats.get(this.order[i] ?? "");
      if (seat) seat.handCount = hand.length;
    });
  }

  private syncSeries() {
    const s = this.series;
    if (!s) return;
    this.state.score0 = s.score[0];
    this.state.score1 = s.score[1];
    this.state.seriesWinner = s.winner ?? -1;
    this.state.currentSeat = -1;
    this.state.turnSessionId = "";
  }

  /** Clock and hand go to ONE phone; never into shared state. */
  private sendPrivate(client: Client) {
    client.send(COURTPIECE_EVENTS.clock, { now: this.clock.currentTime });
    const seatIndex = this.seatOf.get(client.sessionId);
    if (seatIndex !== undefined && this.match) {
      client.send(COURTPIECE_EVENTS.hand, { cards: this.match.hands[seatIndex] });
    }
  }
}

function trickPlay(seat: number, card: Card): TrickPlay {
  const p = new TrickPlay();
  p.seat = seat;
  p.card = cardId(card);
  return p;
}
