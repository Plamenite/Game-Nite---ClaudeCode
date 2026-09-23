# Voice chat

Decided with the founder on 2026-09-22 and 2026-09-23. Voice is Agora,
wrapped so the phone never sees a secret and the app never depends on
Agora's names anywhere but one file per side.

## Decisions

- **Off by default.** Nobody's mic is on until they tap it. Every person
  has their own mic button; everyone sees who has a mic on.
- **Speaking indicator.** A green ring around the name of whoever is
  talking (from the engine's volume events).
- **Mute-for-me (must-have).** Tap a name to stop hearing that person.
  It is your own setting, kept on your phone by player code, so a muted
  person stays muted next time.
- **The lounge's channel carries into the match.** The voice channel is
  the lounge code; it stays open under the game, so friends keep talking
  at the table. Other players who filled empty seats are not in it, like
  a PUBG squad channel.
- **The server meters minutes.** Mic-on time is written down every
  minute and when the mic goes off, per player per UTC day. When the free
  allowance is used up the mic is switched off with a message. VIP
  unlimited and coins for extra minutes come with the VIP tier and shop.

## PLACEHOLDER numbers, to confirm with the founder

| Rule | Value | Where |
|---|---|---|
| Free voice minutes per day | 60 | `VOICE_FREE_MINUTES_PER_DAY` in `packages/game-rules/src/voice.ts` |
| Token lifetime | 60 minutes | `VOICE_TOKEN_MINUTES` |

## How it is wired

- Shared: `packages/game-rules/src/voice.ts` (messages `set_mic`,
  `join_voice`; event `voice_token`; ticket shape; a stable 32-bit voice
  uid per player code).
- Server: `apps/server/src/voice-provider.ts` reads `AGORA_APP_ID` and
  `AGORA_APP_CERTIFICATE` (SECRET) from the environment and mints tickets
  with the official `agora-token` library; without them it says "Voice is
  not set up yet." `LoungeRoom` handles `set_mic` (allowance check,
  metering), `join_voice` (members only, the lounge's own channel), and
  banks minutes through the ledger (`voice_usage` in SQL, memory in dev).
- Phone: `apps/mobile/src/lib/voice.ts` holds the `VoiceEngine` interface
  with a `NoVoiceEngine` stand-in and the store (mic, speaking, muted).
  `components/voice-bar.tsx` is the strip shown in the lounge and above
  the table. `use-lounge` sends mic changes and joins the channel when a
  ticket arrives.

## What switches it on

1. Agora account (docs/ACCOUNTS.md): App ID (public) and App Certificate
   (SECRET) into the server environment.
2. The Agora React Native SDK (`react-native-agora`) is a native module,
   so the app moves from Expo Go to an EAS development build. Then
   `AgoraVoiceEngine` replaces `NoVoiceEngine` in `lib/voice.ts`.
3. iOS microphone permission text (`NSMicrophoneUsageDescription`) in
   `app.json`, added with the SDK.
