import { useSyncExternalStore } from 'react';

/**
 * Small hand-offs between screens. The Friends tab asks the Lounge tab to
 * knock on a friend; the Lounge tab, which holds the live connection,
 * picks it up when it is ready.
 */
let pendingKnock: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestKnock(code: string) {
  pendingKnock = code;
  listeners.forEach((l) => l());
}

export function takeKnock(): string | null {
  const code = pendingKnock;
  pendingKnock = null;
  listeners.forEach((l) => l());
  return code;
}

export function usePendingKnock(): string | null {
  return useSyncExternalStore(subscribe, () => pendingKnock, () => pendingKnock);
}
