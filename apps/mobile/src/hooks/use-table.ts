import { Client, type Room } from '@colyseus/sdk';
import {
  ROOMS,
  TABLE_MESSAGES,
  toTableSnapshot,
  type TableSnapshot,
  type TableStateLike,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

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

  const join = useCallback(async () => {
    if (roomRef.current) {
      return;
    }
    setStatus('connecting');
    setError(null);
    try {
      const client = new Client(serverUrl);
      client.auth.token = guest.token;

      const room = await client.joinOrCreate<TableStateLike>(ROOMS.table, { name: guest.name });
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
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [serverUrl]);

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

  return { status, snapshot, error, sessionId, serverUrl, join, leave, play };
}
