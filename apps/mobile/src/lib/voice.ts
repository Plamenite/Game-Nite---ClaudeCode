import AsyncStorage from '@react-native-async-storage/async-storage';
import { type VoiceTicket } from '@gamenite/game-rules';
import { useSyncExternalStore } from 'react';

/**
 * Voice on the phone. The controls (mic per person, speaking indicator,
 * mute-for-me) are real today; the audio engine is a stand-in until the
 * Agora SDK is added. That SDK is a native module, so it needs an EAS
 * development build rather than Expo Go; when it lands, AgoraVoiceEngine
 * replaces NoVoiceEngine below and nothing else changes.
 */
export interface VoiceEngine {
  /** False on this build: controls work, no audio flows. */
  readonly available: boolean;
  join(ticket: VoiceTicket): Promise<void>;
  leave(): Promise<void>;
  setMic(on: boolean): Promise<void>;
  /** Mute-for-me: stop hearing one participant. */
  setMuted(uid: number, muted: boolean): Promise<void>;
  /** Called with the uids currently speaking. */
  onSpeaking(listener: (uids: number[]) => void): () => void;
}

class NoVoiceEngine implements VoiceEngine {
  readonly available = false;
  async join() {}
  async leave() {}
  async setMic() {}
  async setMuted() {}
  onSpeaking() {
    return () => {};
  }
}

let engine: VoiceEngine | null = null;

export function getVoiceEngine(): VoiceEngine {
  return engine ?? (engine = new NoVoiceEngine());
}

// ---------------------------------------------------------------- store

export interface VoiceState {
  /** The engine can carry audio on this build. */
  available: boolean;
  joined: boolean;
  micOn: boolean;
  /** Voice uids speaking right now. */
  speaking: number[];
  /** Player codes I have muted for myself. Kept on this phone. */
  muted: string[];
  notice: string | null;
}

const MUTED_KEY = 'gamenite.mutedPlayers';
let state: VoiceState = { available: getVoiceEngine().available, joined: false, micOn: false, speaking: [], muted: [], notice: null };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getVoiceState(): VoiceState {
  return state;
}

export function patchVoice(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoice(): VoiceState {
  return useSyncExternalStore(subscribe, getVoiceState, getVoiceState);
}

/** Load the mute list once at start. */
export async function loadMuted() {
  try {
    const raw = await AsyncStorage.getItem(MUTED_KEY);
    if (raw) patchVoice({ muted: JSON.parse(raw) as string[] });
  } catch {
    /* an empty list is fine */
  }
}

export function isMuted(playerCode: string): boolean {
  return state.muted.includes(playerCode);
}

/** Mute or unmute one player for myself; sticks across sessions. */
export async function toggleMuted(playerCode: string, uid: number) {
  const muted = isMuted(playerCode) ? state.muted.filter((c) => c !== playerCode) : [...state.muted, playerCode];
  patchVoice({ muted });
  await getVoiceEngine().setMuted(uid, muted.includes(playerCode)).catch(() => {});
  try {
    await AsyncStorage.setItem(MUTED_KEY, JSON.stringify(muted));
  } catch {
    /* keep going */
  }
}

let unsubscribeSpeaking: (() => void) | null = null;

/** The lounge handed us a ticket: join its channel. */
export async function joinChannel(ticket: VoiceTicket) {
  const eng = getVoiceEngine();
  await eng.join(ticket);
  unsubscribeSpeaking?.();
  unsubscribeSpeaking = eng.onSpeaking((uids) => patchVoice({ speaking: uids }));
  patchVoice({ joined: true, notice: null });
}

export async function leaveChannel() {
  unsubscribeSpeaking?.();
  unsubscribeSpeaking = null;
  await getVoiceEngine().leave().catch(() => {});
  patchVoice({ joined: false, micOn: false, speaking: [] });
}

export async function setMicLocal(on: boolean) {
  patchVoice({ micOn: on });
  await getVoiceEngine().setMic(on).catch(() => {});
}
