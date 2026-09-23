import type { Room, SeatReservation } from '@colyseus/sdk';
import {
  LOUNGE_EVENTS,
  LOUNGE_MESSAGES,
  ME_ROUTE,
  ROOMS,
  VOICE_EVENTS,
  VOICE_MESSAGES,
  loungeJoinOptions,
  loungeLeaveReason,
  normalizeLoungeCode,
  toLoungeSnapshot,
  type LoungeGameChoice,
  type LoungeSnapshot,
  type LoungeStateLike,
  type MeSnapshot,
  type VoiceTicket,
} from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient } from '@/lib/colyseus';
import { getSession, patchSession } from '@/lib/session';
import { joinChannel, leaveChannel, patchVoice, setMicLocal } from '@/lib/voice';

/**
 * idle        not connected to any lounge
 * connecting  opening my lounge or knocking on a friend's
 * waiting     at a friend's door, until someone inside answers
 * in_lounge   seated in a lounge (mine or a friend's)
 */
export type LoungeStatus = 'idle' | 'connecting' | 'waiting' | 'in_lounge' | 'error';

interface UseLoungeOptions {
  /** Called when the leader starts and the server hands us a seat. */
  onTableReady: (reservation: SeatReservation) => void;
}

/**
 * Open my lounge, knock on a friend's, mirror the live state, answer the
 * door, toggle Ready, and (for the leader) pick the game and start. The
 * server enforces every rule; this only asks.
 */
export function useLounge({ onTableReady }: UseLoungeOptions) {
  const [status, setStatus] = useState<LoungeStatus>('idle');
  const [snapshot, setSnapshot] = useState<LoungeSnapshot | null>(null);
  const [me, setMe] = useState<MeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const roomRef = useRef<Room<any, LoungeStateLike> | null>(null);
  const onTableReadyRef = useRef(onTableReady);
  onTableReadyRef.current = onTableReady;

  const detach = useCallback(() => {
    roomRef.current = null;
    setStatus('idle');
    setSnapshot(null);
    setSessionId(null);
    void leaveChannel();
  }, []);

  const attach = useCallback(
    (room: Room<any, LoungeStateLike>) => {
      roomRef.current = room;
      setSessionId(room.sessionId);
      setError(null);
      setNotice(null);

      room.onStateChange((state) => {
        const snap = toLoungeSnapshot(state);
        setSnapshot(snap);
        // Am I seated, or still at the door?
        setStatus(snap.members.some((m) => m.sessionId === room.sessionId) ? 'in_lounge' : 'waiting');
      });
      room.onMessage(LOUNGE_EVENTS.refused, (payload: { reason?: string }) => setNotice(payload?.reason ?? 'Request refused'));
      room.onMessage(LOUNGE_EVENTS.tableReady, (reservation: SeatReservation) => onTableReadyRef.current(reservation));
      room.onMessage(VOICE_EVENTS.token, (ticket: VoiceTicket) => void joinChannel(ticket).catch((e) => patchVoice({ notice: e instanceof Error ? e.message : String(e) })));
      room.onError((code, message) => setError(`Server error ${code}: ${message ?? ''}`));
      room.onLeave((code) => {
        if (roomRef.current !== room) return;
        const reason = loungeLeaveReason(code);
        if (reason) setNotice(reason);
        detach();
      });
    },
    [detach],
  );

  /** Who am I, according to the server (my player code opens my lounge). */
  const whoAmI = useCallback(async (): Promise<MeSnapshot> => {
    if (me) return me;
    const session = getSession();
    if (session.playerCode) {
      const known = { playerCode: session.playerCode, guest: session.guest, name: session.name };
      setMe(known);
      return known;
    }
    const response = await getClient().http.get(ME_ROUTE);
    const snap = response.data as MeSnapshot;
    patchSession({ name: snap.name, playerCode: snap.playerCode });
    setMe(snap);
    return snap;
  }, [me]);

  /** Open (or return to) my own lounge. */
  const enterMine = useCallback(async () => {
    if (roomRef.current) return;
    setStatus('connecting');
    setError(null);
    try {
      const { playerCode } = await whoAmI();
      const room = await getClient().joinOrCreate<LoungeStateLike>(ROOMS.lounge, loungeJoinOptions(getSession().name, playerCode));
      attach(room);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [attach, whoAmI]);

  /** Knock on a friend's lounge with their code. */
  const knock = useCallback(
    async (rawCode: string) => {
      const code = normalizeLoungeCode(rawCode);
      if (!code) {
        setError('A lounge code is 8 letters or digits, like K7PM3XAB.');
        return;
      }
      const mine = await whoAmI().catch(() => null);
      if (mine && code === mine.playerCode) {
        setError('That is your own code. Share it with a friend, or type theirs.');
        return;
      }
      // Leave wherever I am first: one lounge at a time.
      const current = roomRef.current;
      roomRef.current = null;
      if (current) await current.leave(true).catch(() => {});
      setStatus('connecting');
      setError(null);
      setSnapshot(null);
      try {
        const room = await getClient().join<LoungeStateLike>(ROOMS.lounge, loungeJoinOptions(getSession().name, code));
        attach(room);
      } catch (e) {
        setStatus('error');
        const message = e instanceof Error ? e.message : String(e);
        setError(/no rooms found/i.test(message) ? 'Nobody is in a lounge with that code right now.' : message);
      }
    },
    [attach, whoAmI],
  );

  const send = useCallback((type: string, payload: unknown) => {
    roomRef.current?.send(type, payload);
  }, []);

  const setReady = useCallback((ready: boolean) => send(LOUNGE_MESSAGES.setReady, { ready }), [send]);
  const start = useCallback(() => send(LOUNGE_MESSAGES.start, {}), [send]);
  /** Leader only: choose the game, table size, variant, series length and entry. */
  const setGame = useCallback((choice: LoungeGameChoice) => send(LOUNGE_MESSAGES.setGame, choice), [send]);
  /** Leader only: move a member to a side. */
  const setTeam = useCallback((sessionId: string, team: 0 | 1) => send(LOUNGE_MESSAGES.setTeam, { sessionId, team }), [send]);
  /** Any member: let someone at the door in, or turn them away. */
  const accept = useCallback((sessionId: string) => send(LOUNGE_MESSAGES.accept, { sessionId }), [send]);
  const decline = useCallback((sessionId: string) => send(LOUNGE_MESSAGES.decline, { sessionId }), [send]);
  /** Voice: my mic on or off (the server meters minutes); everyone sees the state. */
  const setMic = useCallback(
    (on: boolean) => {
      send(VOICE_MESSAGES.setMic, { on });
      void setMicLocal(on);
      if (on) send(VOICE_MESSAGES.joinVoice, {});
    },
    [send],
  );
  /** Leader only. */
  const kick = useCallback((sessionId: string) => send(LOUNGE_MESSAGES.kick, { sessionId }), [send]);
  const makeLeader = useCallback((sessionId: string) => send(LOUNGE_MESSAGES.makeLeader, { sessionId }), [send]);

  /** Leave this lounge (a friend's, or my own). */
  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.leave(true).catch(() => {});
    detach();
  }, [detach]);

  useEffect(() => {
    return () => {
      roomRef.current?.leave(true).catch(() => {});
      roomRef.current = null;
    };
  }, []);

  const inMyOwn = Boolean(snapshot && me && snapshot.code === me.playerCode);

  return { status, snapshot, me, inMyOwn, error, notice, sessionId, enterMine, knock, setReady, start, setGame, setTeam, accept, decline, kick, makeLeader, setMic, leave };
}
