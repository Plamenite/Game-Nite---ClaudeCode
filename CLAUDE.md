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
- The founder prefers to only talk to Claude: do everything possible in
  the repo/cloud; keep their local steps to one paste plus clicking Yes.

## 2. What Gamenite is
iOS-first mobile multiplayer board/card game platform.

### Games
1. **Five Row** (id `fiverow`; display name placeholder "Jack Streak",
   founder picks the final). Resembles a classic board game whose name is
   TRADEMARKED (Jax/Goliath): NEVER use that name in code, UI, or store
   copy. 10x10 board, two-eyed Jacks wild, one-eyed Jacks remove a chip.
2. **Court Piece (Rang)** — 4-player, 2-team trick-taking card game.
   Variations required: Double Siri and Blind Rang.

### Social, lobby, economy
- Party lobby like PUBG Mobile: gather, ready up, launch. Voice chat starts
  in the lobby and continues into the match without reconnecting.
- Ludo Star style economy. NO blockchain, NO crypto, NO real-money payouts.
  Coins/Gems buy table entries (e.g. 500 coins) and cosmetics. Revenue:
  rewarded video ads, interstitial ads, App Store IAP for coins/cosmetics.

## 3. Apple App Store compliance (non-negotiable)
- Position and document the product as a **casual social game**, not
  gambling. Never use casino/gambling language in code, UI, or store copy.
- Virtual currency can never be cashed out, transferred for value, or
  exchanged for money or prizes. Design every economy feature for this.
- Ads and IAP must follow Apple guidelines (StoreKit, ATT prompt, etc.).

## 4. iOS-first engineering rule (strict)
- ALL code must be written and optimized for iOS deployment first:
  Xcode build, iPhone screen sizes, Safe Areas, Dark Mode, TestFlight.
- Keep the iOS build simple and App Store-ready; check every dependency
  for iOS support before adopting it.
- Android is a confirmed second target (very important to the founder),
  but never a reason to compromise the iOS build.

## 5. Tech stack — DECIDED with the founder on 2026-09-22
- Frontend: **React Native + Expo (TypeScript)**. One codebase for iOS
  now and Android soon; EAS builds iOS in the cloud (founder is on Windows).
- Game server: **Colyseus (TS)**, authoritative: deals, hides hands,
  validates moves, syncs state.
- Voice: **Agora**, billed per connected user-minute, muted or not
  (~$0.99/1k min after 10k free/month). Policy (Shape A, agreed): voice
  OFF by default/opt-in, auto-leave when idle/backgrounded, small free
  daily allowance, VIP = unlimited, extra minutes for coins, server meters
  minutes. Wrap the SDK in our own VoiceService so it can be swapped.
- Auth/DB/storage: **Supabase** (Postgres + Auth + Storage). Coin ledger
  is SQL: one row per coin movement, written ONLY by the server.
- Sign-in (DECIDED): Guest (Supabase anonymous, upgradeable), Sign in
  with Apple (required by Apple when any social login exists), Google,
  Facebook incl. Facebook friends who also play (`user_friends`, needs
  Meta App Review + data-deletion URL). Setup guide: `docs/ACCOUNTS.md`.
- Friends (DECIDED): Gamenite's own friends list (add by player code or
  username) plus Facebook friends as an importer on top.
- Party (DECIDED): PUBG style. Leader creates a party with a join code,
  friends join by code, each taps Ready, ONLY the leader launches.
- Proposed, not yet decided: AdMob for ads, RevenueCat for IAP/VIP.
- Bundle id `app.plamenite.gamenite` (iOS + Android); domain plamenite.app,
  spelling CONFIRMED by founder 2026-09-22.

## 6. Repo layout (one repo, npm workspaces) and how it is wired
- `apps/mobile` Expo SDK 57 app. `apps/server` Colyseus 0.18 server.
  `packages/game-rules` shared TS contracts + rules used by BOTH (ESM).
- Dev resolves the shared package to SOURCE via tsconfig `paths` (server:
  tsx watch; app: Metro + `metro.config.js`, which maps `.js` imports to
  `.ts` and stubs Node-only `ws`). Prod server build uses `dist/`, built
  by root `postinstall`.
- `apps/mobile/expo-env.d.ts` is committed so `tsc` works on a fresh clone.
- Root: `npm run mobile|server|test|typecheck`; CI runs the last two on
  every push. Windows setup: `scripts/setup-windows.ps1` (`GAMENITE_SLIM=1`).
- Five Row rules core DONE (`game-rules/src/fiverow-*.ts`): our OWN board
  layout (never regenerate casually), moves, Jacks, dead cards, runs with
  the one-shared-chip rule, pure match engine, 27 tests. Standard hand sizes
  and runs-to-win pending the rules interview; not wired to a room. Court
  Piece rules: not started.
- Walking skeleton (done, pre-login): `PartyRoom` (create/join by code,
  Ready, leader-only launch → seat reservations in a `TableRoom` turn
  demo). App: Play tab (`use-party`/`use-table`), TEMPORARY guest token in
  `src/lib/guest.ts`. Server verifies Supabase JWTs (`src/auth.ts`; guests
  only with ALLOW_GUEST_TOKENS=true). Next: app login once accounts exist.
- Colyseus gotchas: `filterBy(['code'])` + join option `{ code }` matches
  `metadata.code` (plain keys, no dot notation). Room tests share ONE booted
  test server in `test/rooms.test.ts`; two boots per process break it.

## 7. Project conventions
- Founder: Windows PC (58 GB free, normal setup) daily; MacBook Air for Xcode.
- Branch for current work: `claude/modest-gates-unuglw`.
- Commit small and often, plain-English messages. Keep this file < 100 lines.
