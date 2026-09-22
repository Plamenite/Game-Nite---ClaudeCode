/**
 * The contract between the phone app and the game server for a LOUNGE:
 * the PUBG-style room where friends gather (and soon talk), tap Ready,
 * and the leader starts the game. Every player owns one lounge, and its
 * code is their player code. Both sides import these names.
 */
import type { RandomSource } from './cards.js';

/** Seats in a lounge, like a PUBG squad. */
export const LOUNGE_SIZE = 4;

/** Messages the phone can send to a lounge room. */
export const LOUNGE_MESSAGES = {
  /** payload: { ready: boolean } */
  setReady: 'set_ready',
  /** payload: LoungeGameChoice. Only the leader may send it. */
  setGame: 'set_game',
  /** payload: { sessionId: string; team: 0 | 1 }. Only the leader may send it. */
  setTeam: 'set_team',
  /** payload: none. Only the leader may send it. */
  start: 'start',
  /** payload: { sessionId }. Any member lets a waiting friend in. */
  accept: 'accept',
  /** payload: { sessionId }. Any member turns a waiting friend away. */
  decline: 'decline',
  /** payload: { sessionId }. Only the leader may remove a member. */
  kick: 'kick',
  /** payload: { sessionId }. Only the leader may hand over the lead. */
  makeLeader: 'make_leader',
} as const;

/** Messages the lounge room sends to phones. */
export const LOUNGE_EVENTS = {
  /** payload: a Colyseus seat reservation for the started table. */
  tableReady: 'table_ready',
  /** payload: { reason: string } when a request was refused. */
  refused: 'refused',
} as const;

/** Close codes the lounge uses when it disconnects someone on purpose. */
export const LOUNGE_LEAVE_CODES = {
  declined: 4100,
  kicked: 4101,
  timedOut: 4102,
} as const;

/** A plain-English line for a close code, or null when it was not the lounge's doing. */
export function loungeLeaveReason(code: number): string | null {
  switch (code) {
    case LOUNGE_LEAVE_CODES.declined:
      return 'Nobody let you in this time.';
    case LOUNGE_LEAVE_CODES.kicked:
      return 'The leader removed you from the lounge.';
    case LOUNGE_LEAVE_CODES.timedOut:
      return 'Nobody answered the door in time.';
    default:
      return null;
  }
}

/** How long a knock waits for an answer before the door closes. */
export const LOUNGE_REQUEST_TIMEOUT_SECONDS = 60;

/** A way to play: a game and how many seats it has. */
export interface LoungeFormat {
  game: 'fiverow' | 'courtpiece';
  players: 2 | 3 | 4;
  /** Short label for the picker; never a trademarked name. */
  name: string;
}

/** Every format the lounge can start. New games add rows here. */
export const LOUNGE_FORMATS: readonly LoungeFormat[] = [
  { game: 'fiverow', players: 2, name: '1 vs 1' },
  { game: 'fiverow', players: 3, name: '3 players' },
  { game: 'fiverow', players: 4, name: '2 vs 2' },
  { game: 'courtpiece', players: 4, name: '2 vs 2' },
];

/**
 * DECIDED: the picker only offers formats that seat everyone in the
 * lounge (or more, once empty seats can be filled with other players).
 */
export function formatsForLounge(size: number): LoungeFormat[] {
  return LOUNGE_FORMATS.filter((f) => f.players >= Math.max(size, 1));
}

export function isLoungeFormat(game: string, players: number): boolean {
  return LOUNGE_FORMATS.some((f) => f.game === game && f.players === players);
}

/** What the leader can choose for the lounge's next game. */
export interface LoungeGameChoice {
  game: 'fiverow' | 'courtpiece';
  /** Seats at the table: 2, 3 or 4 (Court Piece is always 4). */
  players?: number;
  /** Court Piece only. */
  variant?: 'single_siri' | 'double_siri';
  /** Court Piece only; private tables may pick 1, 3 or 5. */
  bestOf?: 1 | 3 | 5;
  /** Coins each player pays to sit: 0, 500, 2000 or 10000. */
  entry?: number;
}

export const LOUNGE_GAMES: readonly LoungeGameChoice['game'][] = ['fiverow', 'courtpiece'];

/**
 * A lounge code IS a player code: 8 letters and digits that are hard to
 * confuse when read aloud or typed. The database generates them with the
 * same alphabet (see new_player_code in the economy migration).
 */
export const LOUNGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LOUNGE_CODE_LENGTH = 8;

/** A fresh code, for the development ledger (production codes come from SQL). */
export function generateLoungeCode(random: RandomSource = Math.random): string {
  let code = '';
  for (let i = 0; i < LOUNGE_CODE_LENGTH; i++) {
    code += LOUNGE_CODE_ALPHABET[Math.floor(random() * LOUNGE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Upper-case, strip spaces and dashes. Returns null if it cannot be a code. */
export function normalizeLoungeCode(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== LOUNGE_CODE_LENGTH) {
    return null;
  }
  for (const ch of code) {
    if (!LOUNGE_CODE_ALPHABET.includes(ch)) {
      return null;
    }
  }
  return code;
}

/**
 * The matchmaker only forwards a join option whose key EXACTLY matches the
 * filter key the server registered, and its driver matches that key against
 * the room's metadata. Both sides use this helper so the key never drifts.
 */
export const LOUNGE_JOIN_FILTER_KEY = 'code';

export interface LoungeJoinOptions {
  name: string;
  /** Your own code opens your lounge; a friend's code knocks on theirs. */
  code: string;
}

export function loungeJoinOptions(name: string, code: string): LoungeJoinOptions {
  return { name, [LOUNGE_JOIN_FILTER_KEY]: code };
}

/** "starting" only while the table is being created; then back to "open". */
export type LoungeStatus = 'open' | 'starting';

export interface LoungeMemberSnapshot {
  sessionId: string;
  name: string;
  ready: boolean;
  isLeader: boolean;
  /** 0 or 1. Assigned alternately on join; the leader can change it. */
  team: number;
}

/** Someone at the door, waiting for a member to let them in. */
export interface LoungeRequestSnapshot {
  sessionId: string;
  name: string;
}

export interface LoungeSnapshot {
  code: string;
  leaderSessionId: string;
  status: LoungeStatus;
  game: LoungeGameChoice['game'];
  /** Seats at the chosen table. */
  players: number;
  variant: NonNullable<LoungeGameChoice['variant']>;
  bestOf: NonNullable<LoungeGameChoice['bestOf']>;
  entry: number;
  members: LoungeMemberSnapshot[];
  requests: LoungeRequestSnapshot[];
  /** True when the leader is allowed to start right now. */
  canStart: boolean;
  /** Seats the chosen format still needs beyond the members present; filled with other players. */
  seatsToFill: number;
  /** DECIDED: a table with other players at it is one deal with a rematch vote. */
  bestOfAtTable: number;
}

/** Minimal shape of the server's live lounge state that we read from. */
export interface LoungeStateLike {
  code: string;
  leaderSessionId: string;
  status: string;
  game: string;
  players: number;
  variant: string;
  bestOf: number;
  entry: number;
  members: {
    forEach(cb: (member: { name: string; ready: boolean; team: number }, sessionId: string) => void): void;
  };
  requests: {
    forEach(cb: (request: { name: string }, sessionId: string) => void): void;
  };
}

/** Court Piece is always 2 vs 2; Five Row is 2 vs 2 only at a four-seat table. */
export function isTeamGame(game: string, players: number): boolean {
  return game === 'courtpiece' || (game === 'fiverow' && players === 4);
}

/** Two on each side, the leader's choice. */
export function teamsBalanced(members: readonly { team: number }[]): boolean {
  const a = members.filter((m) => m.team === 0).length;
  const b = members.filter((m) => m.team === 1).length;
  return a === b;
}

/**
 * DECIDED: a lounge may start a table bigger than itself; the empty seats
 * are filled with other players at the same tier. Two friends at a team
 * table are always partners. Three friends split two and one, the
 * leader's choice of sides. A full lounge needs two a side.
 */
export function sidesAllowed(members: readonly { team?: number }[], game: string, players: number): boolean {
  if (!isTeamGame(game, players)) return true;
  const teams = members.map((m) => ({ team: m.team ?? 0 }));
  if (members.length === players) return teamsBalanced(teams);
  if (members.length === 3) return !teamsBalanced(teams) && teams.some((m) => m.team !== teams[0].team);
  return true;
}

/** The one rule for starting, shared so the app can grey out the button honestly. */
export function canStartLounge(
  members: readonly { ready: boolean; team?: number }[],
  status: string,
  game: string,
  players: number,
): boolean {
  if (status !== 'open' || !isLoungeFormat(game, players) || members.length < 1 || members.length > players) return false;
  if (!members.every((m) => m.ready)) return false;
  return sidesAllowed(members, game, players);
}

/**
 * Seats at the table. Solo games (Five Row 1v1 or three players) seat in
 * join order. Team games: side 0 takes seats 0 and 2, side 1 takes 1 and
 * 3, so partners sit opposite. Two friends are seated as partners whatever
 * their badges say; three friends: the pair keeps its side, the single
 * takes the first seat of the other side; the rest is left for others.
 */
export function seatsForLounge(members: readonly { sessionId: string; team: number }[], game: string, players: number): Map<string, number> {
  const seats = new Map<string, number>();
  if (!isTeamGame(game, players)) {
    members.forEach((m, i) => seats.set(m.sessionId, i));
    return seats;
  }
  const slots: Record<number, number[]> = { 0: [0, 2], 1: [1, 3] };
  if (members.length <= 2) {
    members.forEach((m, i) => seats.set(m.sessionId, slots[0][i]));
    return seats;
  }
  for (const m of members) {
    const seat = slots[m.team]?.shift();
    if (seat !== undefined) seats.set(m.sessionId, seat);
  }
  return seats;
}

export function toLoungeSnapshot(state: LoungeStateLike): LoungeSnapshot {
  const members: LoungeMemberSnapshot[] = [];
  state.members.forEach((member, sessionId) => {
    members.push({
      sessionId,
      name: member.name,
      ready: member.ready,
      isLeader: sessionId === state.leaderSessionId,
      team: member.team,
    });
  });
  const requests: LoungeRequestSnapshot[] = [];
  state.requests.forEach((request, sessionId) => {
    requests.push({ sessionId, name: request.name });
  });
  return {
    code: state.code,
    leaderSessionId: state.leaderSessionId,
    status: state.status as LoungeStatus,
    game: state.game as LoungeGameChoice['game'],
    players: state.players,
    variant: state.variant as NonNullable<LoungeGameChoice['variant']>,
    bestOf: state.bestOf as NonNullable<LoungeGameChoice['bestOf']>,
    entry: state.entry,
    members,
    requests,
    canStart: canStartLounge(members, state.status, state.game, state.players),
    seatsToFill: Math.max(state.players - members.length, 0),
    bestOfAtTable: members.length < state.players ? 1 : state.bestOf,
  };
}
