import { type Room, type SeatReservation } from '@colyseus/sdk';
import {
  FIVEROW_EVENTS,
  FIVEROW_MESSAGES,
  ROOMS,
  toFiveRowSnapshot,
  type Card,
  type FiveRowMove,
  type FiveRowStateLike,
  type FiveRowTableSnapshot,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient } from '@/lib/colyseus';
import { guest } from '@/lib/guest';
import { getServerUrl } from '@/lib/server-url';

export type FiveRowStatus = 'idle' | 'connecting' | 'seated' | 'left' | 'error';

/**
 * Connects the phone to one Five Row table. The server decides everything;
 * this hook mirrors the public table state, keeps my private hand, and
 * sends my moves.
 */
export function useFiveRow() {
  const [status, setStatus] = useState<FiveRowStatus>('idle');
  const [snapshot, setSnapshot] = useState<FiveRowTableSnapshot | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Date.now() minus the room clock, so turn deadlines can be shown. */
  const [clockOffset, setClockOffset] = useState(0);
  const roomRef = useRef<Room<any, FiveRowStateLike> | null>(null);

  const serverUrl = getServerUrl();

  const reset = useCallback(() => {
    roomRef.current = null;
    setSnapshot(null);
    setHand([]);
    setSessionId(null);
    setNotice(null);
  }, []);

  const attach = useCallback(
    (room: Room<any, FiveRowStateLike>) => {
      roomRef.current = room;
      setSessionId(room.sessionId);
      setStatus('seated');
      setError(null);
      setNotice(null);

      room.onStateChange((state) => setSnapshot(toFiveRowSnapshot(state)));
      room.onMessage(FIVEROW_EVENTS.hand, (payload: { cards: Card[] }) => setHand(payload.cards ?? []));
      room.onMessage(FIVEROW_EVENTS.clock, (payload: { now: number }) => setClockOffset(Date.now() - payload.now));
      room.onMessage(FIVEROW_EVENTS.refused, (payload: { reason?: string }) => setNotice(payload?.reason ?? 'Refused'));
      room.onError((code, message) => setError(`Server error ${code}: ${message ?? ''}`));
      room.onLeave(() => {
        if (roomRef.current === room) {
          reset();
          setStatus('left');
        }
      });
      // Handlers are registered now; ask for the clock and my hand.
      room.send(FIVEROW_MESSAGES.sync, {});
    },
    [reset],
  );

  /** Quick play: sit at any open table of this shape, or open a new one. */
  const quickPlay = useCallback(
    async (players: 2 | 3 | 4 = 2) => {
      if (roomRef.current) return;
      setStatus('connecting');
      setError(null);
      try {
        const room = await getClient().joinOrCreate<FiveRowStateLike>(ROOMS.fiverow, { players, name: guest.name });
        attach(room);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  /** Party launch: take the seat the party room reserved for us. */
  const joinWithReservation = useCallback(
    async (reservation: SeatReservation) => {
      if (roomRef.current) return;
      setStatus('connecting');
      setError(null);
      try {
        const room = await getClient().consumeSeatReservation<FiveRowStateLike>(reservation);
        attach(room);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const sendMove = useCallback((move: FiveRowMove) => {
    setNotice(null);
    roomRef.current?.send(FIVEROW_MESSAGES.move, move);
  }, []);

  const pass = useCallback(() => {
    setNotice(null);
    roomRef.current?.send(FIVEROW_MESSAGES.pass, {});
  }, []);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    reset();
    if (room) await room.leave(true).catch(() => {});
    setStatus('left');
  }, [reset]);

  useEffect(() => {
    return () => {
      roomRef.current?.leave(true).catch(() => {});
      roomRef.current = null;
    };
  }, []);

  return { status, snapshot, hand, error, notice, sessionId, clockOffset, serverUrl, quickPlay, joinWithReservation, sendMove, pass, leave };
}
