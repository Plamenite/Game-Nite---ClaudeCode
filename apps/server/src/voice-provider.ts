import { RtcRole, RtcTokenBuilder } from "agora-token";
import { VOICE_TOKEN_MINUTES, type VoiceTicket } from "@gamenite/game-rules";

/**
 * Hands out voice-channel tickets. Agora needs an App ID (public) and an
 * App Certificate (SECRET, server only) from docs/ACCOUNTS.md; until they
 * are set, voice is "not set up yet" and the phone's controls stay honest.
 * This is the one file that changes when the Agora account exists: nothing,
 * because it reads the environment.
 */
export interface VoiceProvider {
  readonly configured: boolean;
  ticket(channel: string, uid: number): VoiceTicket;
}

export class NullVoiceProvider implements VoiceProvider {
  readonly configured = false;
  ticket(): VoiceTicket {
    throw new Error("voice is not configured");
  }
}

export class AgoraVoiceProvider implements VoiceProvider {
  readonly configured = true;
  constructor(
    private readonly appId: string,
    private readonly certificate: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  ticket(channel: string, uid: number): VoiceTicket {
    const seconds = VOICE_TOKEN_MINUTES * 60;
    const token = RtcTokenBuilder.buildTokenWithUid(this.appId, this.certificate, channel, uid, RtcRole.PUBLISHER, seconds, seconds);
    return { appId: this.appId, channel, uid, token, expiresAt: Math.floor(this.now() / 1000) + seconds };
  }
}

export function voiceFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceProvider {
  const appId = env.AGORA_APP_ID;
  const certificate = env.AGORA_APP_CERTIFICATE;
  return appId && certificate ? new AgoraVoiceProvider(appId, certificate) : new NullVoiceProvider();
}

let shared: VoiceProvider | null = null;

export function getVoice(): VoiceProvider {
  return shared ?? (shared = voiceFromEnv());
}

/** Tests swap the provider. */
export function setVoice(provider: VoiceProvider | null) {
  shared = provider;
}
