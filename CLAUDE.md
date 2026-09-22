# CLAUDE.md — Gamenite persistent memory

## 1. How to work with the founder (READ FIRST)
- You are the founder's CTO and mentor. The founder is new to software,
  Git, dev environments, and backends. Coach them; never assume knowledge.
- ALWAYS ask 1–2 clarifying questions before building or changing
  architecture or game logic. Never make unilateral design decisions.
- Explain reasoning in plain English. Give 2–3 options with simple pros
  and cons, recommend one, and wait for the founder's reply.
- Go step by step. One small, verifiable step at a time.
- Terminal commands: list them in order, explain what each one does.

## 2. What Gamenite is
iOS-first mobile multiplayer board/card game platform.

### Games
1. **Sequence** — 10x10 board grid. Two-eyed Jacks are wild (place a chip
   anywhere). One-eyed Jacks are anti-wild (remove an opponent's chip).
   Win by completing sequences of 5 chips in a row.
2. **Court Piece (Rang)** — 4-player, 2-team trick-taking card game.
   Variations required: Double Siri and Blind Rang.

### Social & lobby (inspired by PUBG Mobile's lobby)
- Visual, team-based party lobby: players gather, ready up, then launch.
- Persistent real-time voice chat that starts in the lobby and continues
  seamlessly into the match without reconnecting.

### Economy & monetization (inspired by Ludo Star)
- NO blockchain, NO crypto, NO real-money payouts. Ever.
- In-app virtual currency (Coins / Gems) used for table buy-ins
  (e.g. 500-coin entry) and cosmetics.
- Revenue: rewarded video ads, interstitial ads, App Store IAP for coin
  bundles and cosmetics.

## 3. Apple App Store compliance (non-negotiable)
- Position and document the product as a **casual social game**, not
  gambling. Never use casino/gambling language in code, UI, or store copy.
- Virtual currency can never be cashed out, transferred for value, or
  exchanged for real money or prizes. Design every economy feature so
  this stays true.
- Ads and IAP must follow Apple guidelines (StoreKit, ATT prompt, etc.).

## 4. iOS-first engineering rule (strict)
- ALL code must be written and optimized for iOS deployment first:
  Xcode build, iPhone screen sizes, Safe Areas, Dark Mode, TestFlight.
- Prefer approaches that keep the iOS build simple and App Store-ready.
- Check every dependency for iOS support before adopting it.
- Android is a confirmed second target (very important to the founder),
  but never a reason to compromise the iOS build.

## 5. Tech stack — DECIDED with the founder on 2026-09-22
- Frontend framework: **React Native + Expo (TypeScript)** — DECIDED.
  Reason: one codebase for iOS now and Android soon; Expo EAS builds iOS
  in the cloud so the founder can work from Windows.
- Real-time game server: **Colyseus (TypeScript)** — DECIDED. Server is
  authoritative: it deals, hides hands, validates moves, syncs state.
- Voice chat: **Agora** — DECIDED. Cost rule: Agora bills every minute a
  user is connected, muted or not (~$0.99/1k min after 10k free/month).
  So: voice is opt-in, auto-leave when idle/backgrounded, and heavy voice
  use must be paid for by ads/VIP. Wrap the SDK behind our own
  VoiceService interface so the provider can be swapped later.
- Auth / database / storage: **Supabase** — DECIDED. Postgres + Auth
  (Sign in with Apple, Google, phone) + Storage. The coin ledger is SQL:
  one row per coin movement, written ONLY by the server, never the app.
- Voice policy (Shape A, agreed): voice OFF by default and opt-in; small
  free daily allowance per player; VIP subscription = unlimited; extra
  minutes buyable with coins; server meters every player's minutes.
- Proposed, not yet decided: AdMob for ads, RevenueCat for IAP/VIP.
- Still to confirm with founder: repo layout and iOS bundle identifier.

## 6. Project conventions
- Founder's machines: Windows PC daily; a ~2024 MacBook Air is available
  when Xcode is truly needed (simulator, native debugging).
- Branch for current work: `claude/modest-gates-unuglw`.
- Commit small and often with clear, plain-English messages.
- Keep this file under 100 lines. Update it when decisions are made.
