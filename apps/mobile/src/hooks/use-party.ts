import { type Room, type SeatReservation } from '@colyseus/sdk';
import {
  PARTY_EVENTS,
  PARTY_MESSAGES,
  ROOMS,
  normalizePartyCode,
  partyJoinOptions,
  toPartySnapshot,
  type PartySnapshot,
  type PartyStateLike,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient } from '@/lib/colyseus';
import { guest } from '@/lib/guest';

export type PartyStatus = 'idle' | 'connecting' | 'in_party' | 'error';

interface UsePartyOptions {
  /** Called when the leader launches and the server hands us a seat. */
  onTableReady: (reservation: SeatReservation) => void;
}

/**
 * Create or join a party, mirror its live state, toggle Ready, and (for
 * the leader) launch. The server enforces every rule; this only asks.
 */
export function useParty({ onTableReady }: UsePartyOptions) {
  const [status, setStatus] = useState<PartyStatus>('idle');
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const roomRef = useRef<Room<any, PartyStateLike> | null>(null);
  const onTableReadyRef = useRef(onTableReady);
  onTableReadyRef.current = onTableReady;

  const attach = useCallback((room: Room<any, PartyStateLike>) => {
    roomRef.current = room;
    setSessionId(room.sessionId);
    setStatus('in_party');
    setError(null);
    setNotice(null);

    room.onStateChange((state) => setSnapshot(toPartySnapshot(state)));
    room.onMessage(PARTY_EVENTS.refused, (payload: { reason?: string }) =>
      setNotice(payload?.reason ?? 'Request refused'),
    );
    room.onMessage(PARTY_EVENTS.tableReady, (reservation: SeatReservation) =>
      onTableReadyRef.current(reservation),
    );
    room.onError((code, message) => setError(`Server error ${code}: ${message ?? ''}`));
    room.onLeave(() => {
      if (roomRef.current === room) {
        roomRef.current = null;
        setStatus('idle');
        setSnapshot(null);
        setSessionId(null);
      }
    });
  }, []);

  const create = useCallback(async () => {
    if (roomRef.current) return;
    setStatus('connecting');
    setError(null);
    try {
      const room = await getClient().create<PartyStateLike>(ROOMS.party, partyJoinOptions(guest.name));
      attach(room);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [attach]);

  const join = useCallback(
    async (rawCode: string) => {
      if (roomRef.current) return;
      const code = normalizePartyCode(rawCode);
      if (!code) {
        setError('A party code is 6 letters or digits, like K7PM3X.');
        return;
      }
      setStatus('connecting');
      setError(null);
      try {
        const room = await getClient().join<PartyStateLike>(ROOMS.party, partyJoinOptions(guest.name, code));
        attach(room);
      } catch (e) {
        setStatus('error');
        const message = e instanceof Error ? e.message : String(e);
        setError(/no rooms found/i.test(message) ? 'No party with that code.' : message);
      }
    },
    [attach],
  );

  const setReady = useCallback((ready: boolean) => {
    roomRef.current?.send(PARTY_MESSAGES.setReady, { ready });
  }, []);

  const launch = useCallback(() => {
    roomRef.current?.send(PARTY_MESSAGES.launch, {});
  }, []);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.leave(true).catch(() => {});
    setStatus('idle');
    setSnapshot(null);
    setSessionId(null);
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.leave(true).catch(() => {});
      roomRef.current = null;
    };
  }, []);

  return { status, snapshot, error, notice, sessionId, create, join, setReady, launch, leave };
}
