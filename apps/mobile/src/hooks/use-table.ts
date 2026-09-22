import { type Room, type SeatReservation } from '@colyseus/sdk';
import {
  ROOMS,
  TABLE_MESSAGES,
  toTableSnapshot,
  type TableSnapshot,
  type TableStateLike,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient } from '@/lib/colyseus';
import { guest } from '@/lib/guest';
import { getServerUrl } from '@/lib/server-url';

export type TableStatus = 'idle' | 'connecting' | 'seated' | 'left' | 'error';

/**
 * Connects the phone to one table on the game server and mirrors the
 * table's live state into React. The server decides everything; this hook
 * only sends "play" and displays what comes back.
 */
export function useTable() {
  const [status, setStatus] = useState<TableStatus>('idle');
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const roomRef = useRef<Room<any, TableStateLike> | null>(null);

  const serverUrl = getServerUrl();

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      await room.leave(true).catch(() => {});
    }
    setStatus('left');
    setSnapshot(null);
    setSessionId(null);
  }, []);

  const attach = useCallback((room: Room<any, TableStateLike>) => {
    roomRef.current = room;
    setSessionId(room.sessionId);
    setStatus('seated');

    room.onStateChange((state) => setSnapshot(toTableSnapshot(state)));
    room.onError((code, message) => setError(`Server error ${code}: ${message ?? ''}`));
    room.onLeave(() => {
      if (roomRef.current === room) {
        roomRef.current = null;
        setStatus('left');
        setSnapshot(null);
        setSessionId(null);
      }
    });
  }, []);

  /** Quick play: sit at any open table, or open a new one. */
  const join = useCallback(async () => {
    if (roomRef.current) {
      return;
    }
    setStatus('connecting');
    setError(null);
    try {
      const room = await getClient().joinOrCreate<TableStateLike>(ROOMS.table, { name: guest.name });
      attach(room);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [attach]);

  /** Party launch: take the seat the party room reserved for us. */
  const joinWithReservation = useCallback(
    async (reservation: SeatReservation) => {
      if (roomRef.current) {
        return;
      }
      setStatus('connecting');
      setError(null);
      try {
        const room = await getClient().consumeSeatReservation<TableStateLike>(reservation);
        attach(room);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const play = useCallback(() => {
    roomRef.current?.send(TABLE_MESSAGES.play, {});
  }, []);

  // Leave the table if the screen goes away.
  useEffect(() => {
    return () => {
      roomRef.current?.leave(true).catch(() => {});
      roomRef.current = null;
    };
  }, []);

  return { status, snapshot, error, sessionId, serverUrl, join, joinWithReservation, leave, play };
}
