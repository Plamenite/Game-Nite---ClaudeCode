# CLAUDE.md — Gamenite persistent memory

## 1. How to work with the founder (READ FIRST)
- You are the founder's CTO and mentor. The founder is new to software,
  Git, dev environments, and backends. Coach them; never assume knowledge.
- ALWAYS ask 1–2 clarifying questions before building or changing architecture
  or game logic. Never make unilateral design decisions.
- Explain in plain English. Give 2–3 options with pros and cons, recommend one, wait.
  One verifiable step at a time. Founder only talks to Claude: do all possible
  in repo/cloud; local = one paste + Yes. Accounts received 2026-09-23; see the
  `docs/ACCOUNTS.md` checklists. Never `eas init` locally (blocks git pull).

## 2. What Gamenite is: an iOS-first mobile multiplayer board/card platform. Games:
1. **Five Row** (id `fiverow`, placeholder name "Jack Streak"): resembles a
   classic board game whose name is TRADEMARKED (Jax/Goliath): NEVER use it
   in code, UI, or store copy. 10x10 board, Jacks wild/remove.
2. **Court Piece (Rang)** — 4-player, 2-team trick-taking card game. Two
   games: Single Siri and Double Siri; "blind" first-cut trump in both.

- Economy (DECIDED, `docs/ECONOMY.md`, modelled on Ludo Star): NO blockchain
  or real-money payouts. Start 1,000; daily bonus is a login streak (200,
  +50/day, 500 from day 7, restart after a miss); ad 100 (max 5/day); tables
  free/500/2,000/10,000; winners split losers' entries minus a flat 10% fee.

## 3. Apple App Store compliance (non-negotiable)
- Position and document the product as a **casual social game**, not gambling.
  Never use casino/gambling language in code, UI, or store copy.
- Virtual currency can never be cashed out, transferred for value, or
  exchanged for money or prizes. Ads and IAP follow Apple rules (StoreKit, ATT).

## 4. iOS-first engineering rule (strict)
- ALL code is written and optimized for iOS first: Xcode build, iPhone screen
  sizes, Safe Areas, Dark Mode, TestFlight. Keep the build simple and App Store
  ready; check every dependency for iOS. Android is second, never a compromise.

## 5. Tech stack — DECIDED with the founder on 2026-09-22
- Frontend: **React Native + Expo (TypeScript)**, one codebase for iOS now and
  Android soon; EAS builds iOS in the cloud. Bundle id `app.plamenite.gamenite`,
  domain plamenite.app. Undecided: AdMob, RevenueCat.
- Game server: **Colyseus (TS)**, authoritative. Voice: **Agora** (~$0.99/1k user-min).
- Auth/DB/storage: **Supabase**; coin ledger is SQL, server-written ONLY. Sign-in
  (DECIDED): Facebook, Google, Apple, then guest; name from the login account,
  guests "Player 12345", changeable; guests upgrade keeping coins. `docs/ACCOUNTS.md`.
- Friends (DECIDED, LIVE): own list, add by code, other side accepts, online
  status; only friends of someone inside may knock; Facebook friends only on
  tap. Lounge (DECIDED, `docs/LOUNGE.md`): PUBG style, 4 seats, first screen.
  Every player owns one; code = player code. Friends knock, anyone inside
  lets them in; leader picks game/sides/tier, removes, hands over lead; all
  Ready, leader starts; lounge survives the game. Empty seats fill with
  strangers (friends stay partners, best of 1). Voice (`docs/VOICE.md`): mic
  off by default, mute-for-me, lounge channel carries into the match, server
  meters minutes (60/day PLACEHOLDER); controls built, engine stub until Agora.

## 6. Repo layout (one repo, npm workspaces) and how it is wired
- `apps/mobile` Expo SDK 57; `apps/server` Colyseus 0.18; `packages/game-rules` shared.
- Dev resolves the shared package to SOURCE via tsconfig `paths` (server: tsx
  watch; app: Metro `metro.config.js` maps `.js`→`.ts`, stubs Node-only `ws`); prod
  server uses `dist/` (root `postinstall`). `apps/mobile/expo-env.d.ts` is committed.
  Root: `npm run mobile|server|test|typecheck` (CI: last two). Windows:
  `scripts/setup-windows.ps1`; re-running it IS the update (stashes npm's lock
  rewrite, ff-only, proves PC = GitHub). Never `2>$null` a native cmd in PS 5.1.
- Five Row LIVE: engine `game-rules/src/fiverow-*.ts` (own board, never
  regenerate), `FiveRowRoom` (private hands, crypto RNG, 30 s turns, timeout →
  random move, 3 in a row → abandoned), board `components/fiverow-board.tsx`.
- Court Piece LIVE (ALL RULES DECIDED): engine `game-rules/src/court-piece-*.ts`,
  `CourtPieceRoom` (private hands, 30 s auto-play, forfeit when a whole team
  abandons, series + rematch), screen `components/court-piece-table.tsx`. Rules: 2♣
  holder opens with 2♣; nobody calls trump, the first off-suit card sets it
  and that team "called" it; all 13 tricks played; 7 = win, 13 by callers =
  kot, by others = goon kot (each one series win). Single siri: tricks wait
  until trump, the trump-making trick takes the pile, then each banks.
  Double siri: same player two in a row banks, never after tricks 1/2/12,
  only once trump exists, not two ace wins; 13th takes the rest. Private
  best of 1/3/5, public best of 1 + rematch (all 4 agree); partners sit
  opposite. LAUNCH_SECRET lets rooms trust the lounge's seats and series length.
- Economy LIVE: `game-rules/src/economy.ts` (settleTable, streak), SQL
  `supabase/migrations/*_economy.sql` (append-only ledger, profiles, friends,
  pglite tests), server `src/ledger.ts` (memory in dev, Supabase in prod).
  Tier picked in lounge/quick play; Ready checks balance; seat charges entry
  (refund on early leave); end settles. `src/wallet.ts`: `/wallet*`, `/me`.
- Lounge LIVE: `game-rules/src/lounge.ts`, `LoungeRoom` (friend-gated knock,
  accept/decline with close codes, kick, make_leader, start → reservations +
  heldSeats, only a LAUNCH_SECRET reservation may pick a seat, back to open),
  app Lounge tab `app/index.tsx` + `use-lounge`; Friends, Games (how to play
  from `game-rules/src/how-to-play.ts`, tested for wording), You tabs.
- Sign-in code DONE, awaiting accounts: app `lib/session.ts` + `lib/auth.ts`
  (Supabase OAuth browser flow, native Apple, anonymous guests, dev guest token
  kept on the phone), gate in `app/_layout.tsx`. Server `src/auth.ts` verifies
  JWTs + name from claims (guests only if ALLOW_GUEST_TOKENS); `GET/POST /me`. Friends:
  SQL `friendships`, `src/friends.ts`, `src/presence.ts`; voice `src/voice-provider.ts`.
- Gotchas: `filterBy(['x'])` + join option `{ x }` matches `metadata.x`. Room tests
  share ONE booted server. `client.leave(code)` hits `onDrop` first: skip
  `allowReconnection` for own codes. Shell: absolute paths. CJS packages (agora-token):
  default import only; CI boots the server. Local secrets `.env.development.local`;
  SQL migrations append-only once applied; functions service-role only (lock_down).

## 7. Project conventions
- Founder: Windows PC daily; MacBook Air for Xcode. Branch `claude/modest-gates-unuglw`.
  Small plain-English commits. Keep this file < 100 lines.
