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
- Founder only talks to Claude: do all possible in repo/cloud; local = one paste + Yes.

## 2. What Gamenite is
iOS-first mobile multiplayer board/card game platform.

### Games
1. **Five Row** (id `fiverow`; display name placeholder "Jack Streak",
   founder picks the final). Resembles a classic board game whose name is
   TRADEMARKED (Jax/Goliath): NEVER use that name in code, UI, or store
   copy. 10x10 board, two-eyed Jacks wild, one-eyed Jacks remove a chip.
2. **Court Piece (Rang)** — 4-player, 2-team trick-taking card game. Two
   games: Single Siri and Double Siri; "blind" first-cut trump in both.

### Social, lobby, economy
- PUBG-style party lobby (gather, ready, launch); voice carries lobby → match.
- Ludo Star style economy: NO blockchain/crypto/real-money payouts. Coins/
  Gems buy table entries (e.g. 500) and cosmetics. Revenue: rewarded and
  interstitial ads, App Store IAP for coins and cosmetics.

## 3. Apple App Store compliance (non-negotiable)
- Position and document the product as a **casual social game**, not
  gambling. Never use casino/gambling language in code, UI, or store copy.
- Virtual currency can never be cashed out, transferred for value, or
  exchanged for money or prizes. Ads and IAP follow Apple rules (StoreKit, ATT).

## 4. iOS-first engineering rule (strict)
- ALL code must be written and optimized for iOS deployment first:
  Xcode build, iPhone screen sizes, Safe Areas, Dark Mode, TestFlight.
- Keep the iOS build simple and App Store-ready; check every dependency
  for iOS support before adopting it.
- Android is a confirmed second target, but never a reason to compromise iOS.

## 5. Tech stack — DECIDED with the founder on 2026-09-22
- Frontend: **React Native + Expo (TypeScript)**. One codebase for iOS
  now and Android soon; EAS builds iOS in the cloud (founder is on Windows).
- Game server: **Colyseus (TS)**, authoritative: deals, hides hands,
  validates moves, syncs state.
- Voice: **Agora**, billed per connected user-minute, muted or not
  (~$0.99/1k min after 10k free). Policy (Shape A): voice OFF by default,
  auto-leave when idle/backgrounded, small free daily allowance, VIP
  unlimited, extra minutes for coins, server meters minutes. Wrap the SDK.
- Auth/DB/storage: **Supabase** (Postgres + Auth + Storage). Coin ledger
  is SQL: one row per coin movement, written ONLY by the server.
- Sign-in (DECIDED): Guest (Supabase anonymous, upgradeable), Apple
  (required with any social login), Google, Facebook incl. Facebook friends
  who also play (`user_friends`, Meta review + data-deletion URL). `docs/ACCOUNTS.md`.
- Friends (DECIDED): Gamenite's own friends list (add by player code or
  username) plus Facebook friends as an importer on top.
- Party (DECIDED): PUBG style. Leader makes a code, friends join, all Ready, leader launches.
- Bundle id `app.plamenite.gamenite`; domain plamenite.app (CONFIRMED). Undecided: AdMob, RevenueCat.

## 6. Repo layout (one repo, npm workspaces) and how it is wired
- `apps/mobile` Expo SDK 57 app. `apps/server` Colyseus 0.18 server.
  `packages/game-rules` shared TS contracts + rules used by BOTH (ESM).
- Dev resolves the shared package to SOURCE via tsconfig `paths` (server:
  tsx watch; app: Metro + `metro.config.js` mapping `.js`→`.ts`, stubbing
  Node-only `ws`). Prod server build uses `dist/` (root `postinstall`).
- `apps/mobile/expo-env.d.ts` is committed so `tsc` works on a fresh clone.
- Root: `npm run mobile|server|test|typecheck`; CI runs the last two on
  every push. Windows setup: `scripts/setup-windows.ps1` (`GAMENITE_SLIM=1`).
- Five Row LIVE end to end: engine `game-rules/src/fiverow-*.ts` (own board
  layout, never regenerate), `FiveRowRoom` (private hands, crypto RNG, 30 s
  turns, timeout → random legal move, 3 in a row → abandoned, last team
  present wins), board `components/fiverow-board.tsx`. DECIDED: 1v1, 3p,
  2v2; standard hand sizes and runs-to-win.
- Court Piece (ALL RULES DECIDED): engine `game-rules/src/court-piece-*.ts`,
  `CourtPieceRoom` live (private hands, 30 s auto-play, forfeit when a whole
  team abandons, series + rematch); phone screen NOT built yet. Rules: 2♣
  holder opens with 2♣; nobody calls trump, the first off-suit card sets it
  and that team "called" it; all 13 tricks played; 7 = win, 13 by callers =
  kot, by others = goon kot (each one series win). Single siri: tricks wait
  until trump, the trump-making trick takes the pile, then each banks.
  Double siri: same player two in a row banks, never after tricks 1/2/12,
  only once trump exists, not two ace wins; 13th takes the rest. Private
  best of 1/3/5 (dealer rotates right), public best of 1 + rematch (all 4
  agree). Party leader picks game/variant/best-of; launches use a
  server-only LAUNCH_SECRET so phones cannot request a series.
- Skeleton (done, pre-login): `PartyRoom` (code join, Ready, leader launch
  → seat reservations). App: Play tab (`use-party`/`use-fiverow`), TEMPORARY
  guest token `src/lib/guest.ts`. Server verifies Supabase JWTs (`src/auth.ts`;
  guests only if ALLOW_GUEST_TOKENS=true). Next: app login once accounts exist.
- Colyseus gotchas: `filterBy(['x'])` + join option `{ x }` matches `metadata.x`
  (plain keys). Room tests share ONE booted test server; two boots break it.

## 7. Project conventions
- Founder: Windows PC (58 GB free, normal setup) daily; MacBook Air for Xcode.
- Branch for current work: `claude/modest-gates-unuglw`.
- Commit small and often, plain-English messages. Keep this file < 100 lines.
