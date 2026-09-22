/**
 * Friends (DECIDED): Gamenite's own list. Add by player code, the other
 * side accepts or declines, see who is online, and knock on a friend's
 * lounge straight from the list. Facebook friends are imported only when
 * the player taps "Find Facebook friends" (needs the Meta account).
 *
 * Everything goes through the game server over HTTP; phones never talk to
 * the database directly.
 */

export const FRIEND_ROUTES = {
  /** GET: friends with online status, plus requests in and out. */
  list: '/friends',
  /** POST { code }: send a request; a request both ways becomes a friendship. */
  add: '/friends/add',
  /** POST { code, accept }: answer a request that came in. */
  answer: '/friends/answer',
  /** POST { code }: remove a friend, or withdraw a request. */
  remove: '/friends/remove',
} as const;

/** Where a friend is right now, as the game server sees it. */
export type OnlineStatus = 'offline' | 'online' | 'lounge' | 'table';

export interface FriendSnapshot {
  playerCode: string;
  name: string;
  status: OnlineStatus;
  /** The lounge they are in, when status is "lounge": knock with it. */
  loungeCode?: string;
}

export interface FriendRequestSnapshot {
  playerCode: string;
  name: string;
}

export interface FriendLists {
  friends: FriendSnapshot[];
  /** People who asked to be my friend; I accept or decline. */
  incoming: FriendRequestSnapshot[];
  /** People I asked; waiting on them. */
  outgoing: FriendRequestSnapshot[];
}

/** One line for the list: "In their lounge", "At a table", "Online", "Offline". */
export function describeStatus(friend: Pick<FriendSnapshot, 'status' | 'loungeCode'>, myLoungeCode?: string): string {
  switch (friend.status) {
    case 'table':
      return 'At a table';
    case 'lounge':
      return myLoungeCode && friend.loungeCode === myLoungeCode ? 'In your lounge' : 'In their lounge';
    case 'online':
      return 'Online';
    default:
      return 'Offline';
  }
}

/** Can I knock on this friend right now? Only when they are in a lounge that is not the one I am in. */
export function canKnockOn(friend: Pick<FriendSnapshot, 'status' | 'loungeCode'>, myLoungeCode?: string): boolean {
  return friend.status === 'lounge' && Boolean(friend.loungeCode) && friend.loungeCode !== myLoungeCode;
}

/** Friends first (online before offline), then names, so the list reads the same on every phone. */
export function sortFriends(friends: readonly FriendSnapshot[]): FriendSnapshot[] {
  const rank: Record<OnlineStatus, number> = { lounge: 0, online: 1, table: 2, offline: 3 };
  return [...friends].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}
