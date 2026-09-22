import { type Room, type SeatReservation } from '@colyseus/sdk';
import {
  COURTPIECE_EVENTS,
  COURTPIECE_MESSAGES,
  ROOMS,
  toCourtPieceSnapshot,
  type Card,
  type CourtPieceStateLike,
  type CourtPieceTableSnapshot,
  type CourtPieceVariant,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient } from '@/lib/colyseus';
import { guest } from '@/lib/guest';

export type CourtPieceStatus = 'idle' | 'connecting' | 'seated' | 'left' | 'error';

/**
 * Connects the phone to one Court Piece table. The server decides
 * everything; this hook mirrors the public table, keeps my private hand,
 * and sends my plays.
 */
export function useCourtPiece() {
  const [status, setStatus] = useState<CourtPieceStatus>('idle');
  const [snapshot, setSnapshot] = useState<CourtPieceTableSnapshot | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const roomRef = useRef<Room<any, CourtPieceStateLike> | null>(null);

  const reset = useCallback(() => {
    roomRef.current = null;
    setSnapshot(null);
    setHand([]);
    setSessionId(null);
    setNotice(null);
  }, []);

  const attach = useCallback(
    (room: Room<any, CourtPieceStateLike>) => {
      roomRef.current = room;
      setSessionId(room.sessionId);
      setStatus('seated');
      setError(null);
      setNotice(null);

      room.onStateChange((state) => setSnapshot(toCourtPieceSnapshot(state)));
      room.onMessage(COURTPIECE_EVENTS.hand, (payload: { cards: Card[] }) => setHand(payload.cards ?? []));
      room.onMessage(COURTPIECE_EVENTS.clock, (payload: { now: number }) => setClockOffset(Date.now() - payload.now));
      room.onMessage(COURTPIECE_EVENTS.refused, (payload: { reason?: string }) => setNotice(payload?.reason ?? 'Refused'));
      room.onError((code, message) => setError(`Server error ${code}: ${message ?? ''}`));
      room.onLeave(() => {
        if (roomRef.current === room) {
          reset();
          setStatus('left');
        }
      });
      room.send(COURTPIECE_MESSAGES.sync, {});
    },
    [reset],
  );

  /** Quick play: sit at any open public table of this variant, or open one. */
  const quickPlay = useCallback(
    async (variant: CourtPieceVariant = 'single_siri', entry = 0) => {
      if (roomRef.current) return;
      setStatus('connecting');
      setError(null);
      try {
        const room = await getClient().joinOrCreate<CourtPieceStateLike>(ROOMS.courtpiece, { variant, entry, name: guest.name });
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
        const room = await getClient().consumeSeatReservation<CourtPieceStateLike>(reservation);
        attach(room);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attach],
  );

  const play = useCallback((card: Card) => {
    setNotice(null);
    roomRef.current?.send(COURTPIECE_MESSAGES.play, { card });
  }, []);

  const rematch = useCallback(() => {
    setNotice(null);
    roomRef.current?.send(COURTPIECE_MESSAGES.rematch, {});
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

  return { status, snapshot, hand, error, notice, sessionId, clockOffset, quickPlay, joinWithReservation, play, rematch, leave };
}
