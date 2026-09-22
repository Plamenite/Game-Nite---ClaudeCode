import { useSyncExternalStore } from 'react';

export type SignInProvider = 'facebook' | 'google' | 'apple' | 'guest';

/**
 * Who is using this phone right now. One tiny store for the whole app:
 * the sign-in gate, the lounge, the tables and the wallet all read it.
 */
export interface Session {
  /** loading: restoring; signed_out: show the sign-in screen; ready: play. */
  status: 'loading' | 'signed_out' | 'ready';
  /** Bearer token the game server verifies: a Supabase access token, or a dev guest token. */
  token: string | null;
  provider: SignInProvider | null;
  guest: boolean;
  /** From GET /me: what other players see, and the code that opens my lounge. */
  name: string;
  playerCode: string;
  busy: boolean;
  error: string | null;
}

const initial: Session = { status: 'loading', token: null, provider: null, guest: true, name: '', playerCode: '', busy: false, error: null };

let current: Session = initial;
const listeners = new Set<() => void>();

export function getSession(): Session {
  return current;
}

export function patchSession(patch: Partial<Session>) {
  current = { ...current, ...patch };
  listeners.forEach((listener) => listener());
}

export function resetSession(status: Session['status'], error: string | null = null) {
  current = { ...initial, status, error };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
