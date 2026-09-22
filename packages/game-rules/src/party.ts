/**
 * The contract between the phone app and the game server for a PARTY:
 * the PUBG-style pre-game room where friends gather, tap Ready, and the
 * leader launches the table. Both sides import these names.
 */
import type { RandomSource } from './cards.js';

/** Messages the phone can send to a party room. */
export const PARTY_MESSAGES = {
  /** payload: { ready: boolean } */
  setReady: 'set_ready',
  /** payload: PartyGameChoice. Only the leader may send it. */
  setGame: 'set_game',
  /** payload: none. Only the leader may send it. */
  launch: 'launch',
} as const;

/** What the leader can choose for the party's next game. */
export interface PartyGameChoice {
  game: 'fiverow' | 'courtpiece';
  /** Court Piece only. */
  variant?: 'single_siri' | 'double_siri';
  /** Court Piece only; private tables may pick 1, 3 or 5. */
  bestOf?: 1 | 3 | 5;
}

export const PARTY_GAMES: readonly PartyGameChoice['game'][] = ['fiverow', 'courtpiece'];

/** Messages the party room sends to phones. */
export const PARTY_EVENTS = {
  /** payload: a Colyseus seat reservation for the launched table. */
  tableReady: 'table_ready',
  /** payload: { reason: string } when a request was refused. */
  refused: 'refused',
} as const;

/** Placeholder cap for the skeleton. Real games take it from GameInfo. */
export const SKELETON_PARTY_SIZE = 4;

/** Letters and digits that are hard to confuse when read aloud or typed. */
export const PARTY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PARTY_CODE_LENGTH = 6;

/** A short code friends type to join, e.g. "K7PM3X". */
export function generatePartyCode(random: RandomSource = Math.random): string {
  let code = '';
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
    code += PARTY_CODE_ALPHABET[Math.floor(random() * PARTY_CODE_ALPHABET.length)];
  }
  return code;
}

/** Upper-case, strip spaces and dashes. Returns null if it cannot be a code. */
export function normalizePartyCode(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== PARTY_CODE_LENGTH) {
    return null;
  }
  for (const ch of code) {
    if (!PARTY_CODE_ALPHABET.includes(ch)) {
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
export const PARTY_JOIN_FILTER_KEY = 'code';

export interface PartyJoinOptions {
  name: string;
  /** Present when joining an existing party; absent when creating one. */
  code?: string;
}

export function partyJoinOptions(name: string, code?: string): PartyJoinOptions {
  return code === undefined ? { name } : { name, [PARTY_JOIN_FILTER_KEY]: code };
}

export type PartyStatus = 'open' | 'launching' | 'launched';

export interface PartyMemberSnapshot {
  sessionId: string;
  name: string;
  ready: boolean;
  isLeader: boolean;
}

export interface PartySnapshot {
  code: string;
  leaderSessionId: string;
  status: PartyStatus;
  game: PartyGameChoice['game'];
  variant: NonNullable<PartyGameChoice['variant']>;
  bestOf: NonNullable<PartyGameChoice['bestOf']>;
  members: PartyMemberSnapshot[];
  /** True when the leader is allowed to launch right now. */
  canLaunch: boolean;
}

/** Minimal shape of the server's live party state that we read from. */
export interface PartyStateLike {
  code: string;
  leaderSessionId: string;
  status: string;
  game: string;
  variant: string;
  bestOf: number;
  members: {
    forEach(cb: (member: { name: string; ready: boolean }, sessionId: string) => void): void;
  };
}

/** Minimum members before a launch is allowed. */
export const MIN_PARTY_MEMBERS_TO_LAUNCH = 2;

/** How many players each game needs at the table. */
export function partySizeAllowed(game: string, members: number): boolean {
  if (game === 'courtpiece') return members === 4;
  return members >= MIN_PARTY_MEMBERS_TO_LAUNCH && members <= 4;
}

/** The one rule for launching, shared so the app can grey out the button honestly. */
export function canLaunchParty(members: readonly { ready: boolean }[], status: string, game = 'fiverow'): boolean {
  return status === 'open' && partySizeAllowed(game, members.length) && members.every((m) => m.ready);
}

export function toPartySnapshot(state: PartyStateLike): PartySnapshot {
  const members: PartyMemberSnapshot[] = [];
  state.members.forEach((member, sessionId) => {
    members.push({
      sessionId,
      name: member.name,
      ready: member.ready,
      isLeader: sessionId === state.leaderSessionId,
    });
  });
  return {
    code: state.code,
    leaderSessionId: state.leaderSessionId,
    status: state.status as PartyStatus,
    game: state.game as PartyGameChoice['game'],
    variant: state.variant as NonNullable<PartyGameChoice['variant']>,
    bestOf: state.bestOf as NonNullable<PartyGameChoice['bestOf']>,
    members,
    canLaunch: canLaunchParty(members, state.status, state.game),
  };
}
