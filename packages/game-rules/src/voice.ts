/**
 * Voice chat (DECIDED): Agora, OFF by default, a mic button per person,
 * a speaking indicator, mute-for-me on every seat, the lounge's channel
 * carries into the match, the server meters minutes against a small free
 * daily allowance. The phone never holds Agora secrets: the lounge hands
 * out a short-lived token for its own channel to its own members.
 */

/**
 * PLACEHOLDER numbers until the founder decides: free minutes per UTC day,
 * and what a top-up costs (VIP unlimited comes with a VIP tier later).
 */
export const VOICE_FREE_MINUTES_PER_DAY = 60;
export const VOICE_TOKEN_MINUTES = 60;

/** Voice-related lounge messages (phone → lounge). */
export const VOICE_MESSAGES = {
  /** payload: { on: boolean }. Everyone sees who has their mic on. */
  setMic: 'set_mic',
  /** payload: none. Reply: VOICE_EVENTS.token, or LOUNGE_EVENTS.refused. */
  joinVoice: 'join_voice',
} as const;

/** Voice-related lounge events (lounge → phone). */
export const VOICE_EVENTS = {
  /** payload: VoiceTicket */
  token: 'voice_token',
} as const;

/** What a phone needs to join the lounge's voice channel. */
export interface VoiceTicket {
  appId: string;
  channel: string;
  /** Agora needs a 32-bit number per participant; the server derives one per player. */
  uid: number;
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** A stable 32-bit voice uid for a player id, so the same person keeps the same uid across tokens. */
export function voiceUidFor(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Agora uids are unsigned 32-bit and 0 means "let Agora pick".
  return hash === 0 ? 1 : hash;
}

/** Minutes left today, never negative. */
export function voiceMinutesLeft(secondsUsedToday: number, freeMinutes = VOICE_FREE_MINUTES_PER_DAY): number {
  return Math.max(0, Math.ceil((freeMinutes * 60 - secondsUsedToday) / 60));
}
