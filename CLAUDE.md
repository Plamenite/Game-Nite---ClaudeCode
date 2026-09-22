# CLAUDE.md — Gamenite persistent memory

## 1. How to work with the founder (READ FIRST)
- You are the founder's CTO and mentor. The founder is new to software,
  Git, dev environments, and backends. Coach them; never assume knowledge.
- ALWAYS ask 1–2 clarifying questions before building or changing
  architecture or game logic. Never make unilateral design decisions.
- Explain reasoning in plain English. Give 2–3 options with simple pros
  and cons, recommend one, and wait for the founder's reply.
- One verifiable step at a time, commands explained. Founder only talks to
  Claude: do all possible in repo/cloud; local = one paste + Yes.

## 2. What Gamenite is: an iOS-first mobile multiplayer board/card platform
### Games
1. **Five Row** (id `fiverow`; display name placeholder "Jack Streak").
   Resembles a classic board game whose name is TRADEMARKED (Jax/Goliath):
   NEVER use it in code, UI, or store copy. 10x10 board, Jacks wild/remove.
2. **Court Piece (Rang)** — 4-player, 2-team trick-taking card game. Two
   games: Single Siri and Double Siri; "blind" first-cut trump in both.

### Social, lobby, economy
- PUBG-style lounge (gather, talk, ready, start); voice carries lounge → match.
- Economy (DECIDED, `docs/ECONOMY.md`, modelled on Ludo Star): NO blockchain
  or real-money payouts. Start 1,000; daily bonus is a login streak (200,
  +50/day, 500 from day 7, restart after a miss); ad 100 (max 5/day); tables
  free/500/2,000/10,000; winners split losers' entries minus a flat 10% fee.

## 3. Apple App Store compliance (non-negotiable)
- Position and document the product as a **casual social game**, not
  gambling. Never use casino/gambling language in code, UI, or store copy.
- Virtual currency can never be cashed out, transferred for value, or
  exchanged for money or prizes. Ads and IAP follow Apple rules (StoreKit, ATT).

## 4. iOS-first engineering rule (strict)
- ALL code must be written and optimized for iOS deployment first:
  Xcode build, iPhone screen sizes, Safe Areas, Dark Mode, TestFlight.
- Keep the iOS build simple and App Store-ready; check every dependency for
  iOS support. Android is a confirmed second target, never a reason to compromise iOS.

## 5. Tech stack — DECIDED with the founder on 2026-09-22
- Frontend: **React Native + Expo (TypeScript)**. One codebase for iOS
  now and Android soon; EAS builds iOS in the cloud (founder is on Windows).
- Game server: **Colyseus (TS)**, authoritative: deals, hides hands, validates moves.
- Voice: **Agora** (~$0.99/1k user-min after 10k free). OFF by default, auto-leave
  idle, small free daily allowance, VIP unlimited, coins for extra, server meters.
- Auth/DB/storage: **Supabase**. Coin ledger is SQL, one row per movement, server-written ONLY.
- Sign-in (DECIDED): Guest (Supabase anonymous, upgradeable), Apple (required
  with social login), Google, Facebook + FB friends who play (`docs/ACCOUNTS.md`).
- Friends (DECIDED): own list (add by code/username) + Facebook importer.
- Lounge (DECIDED, `docs/LOUNGE.md`): PUBG style, 4 seats, first screen.
  Every player owns one; code = player code. Friends knock, anyone inside
  lets them in; leader picks game/sides/tier, removes, hands over lead; all
  Ready, leader starts; lounge survives the game. Formats must seat everyone
  (fill with strangers = NEXT). Voice: mic off by default, mute-for-me a must.
- Bundle id `app.plamenite.gamenite`; domain plamenite.app (CONFIRMED). Undecided: AdMob, RevenueCat.

## 6. Repo layout (one repo, npm workspaces) and how it is wired
- `apps/mobile` Expo SDK 57 app. `apps/server` Colyseus 0.18 server.
  `packages/game-rules` shared TS contracts + rules used by BOTH (ESM).
- Dev resolves the shared package to SOURCE via tsconfig `paths` (server: tsx
  watch; app: Metro `metro.config.js` maps `.js`→`.ts`, stubs Node-only `ws`).
  Prod server build uses `dist/` (root `postinstall`). `apps/mobile/expo-env.d.ts`
  is committed so `tsc` works on a fresh clone. Root: `npm run
  mobile|server|test|typecheck` (CI runs the last two). Windows:
  `scripts/setup-windows.ps1` (`GAMENITE_SLIM=1`).
- Five Row LIVE: engine `game-rules/src/fiverow-*.ts` (own board layout,
  never regenerate), `FiveRowRoom` (private hands, crypto RNG, 30 s turns,
  timeout → random legal move, 3 in a row → abandoned, last team present
  wins), board `components/fiverow-board.tsx`. DECIDED: 1v1, 3p, 2v2.
- Court Piece LIVE (ALL RULES DECIDED): engine `game-rules/src/court-piece-*.ts`,
  `CourtPieceRoom` (private hands, 30 s auto-play, forfeit when a whole team
  abandons, series + rematch), screen `components/court-piece-table.tsx`.
  Rules: 2♣ holder opens with 2♣; nobody calls trump, the first off-suit card sets it
  and that team "called" it; all 13 tricks played; 7 = win, 13 by callers =
  kot, by others = goon kot (each one series win). Single siri: tricks wait
  until trump, the trump-making trick takes the pile, then each banks.
  Double siri: same player two in a row banks, never after tricks 1/2/12,
  only once trump exists, not two ace wins; 13th takes the rest. Private
  best of 1/3/5, public best of 1 + rematch (all 4 agree); partners sit
  opposite. LAUNCH_SECRET lets rooms trust the lounge's seats and series length.
- Economy LIVE: `game-rules/src/economy.ts` (settleTable, streak), SQL
  `supabase/migrations/*_economy.sql` (append-only ledger, pglite tests),
  server `src/ledger.ts` (memory in dev, Supabase in prod). Leader/quick play
  pick a tier; Ready checks balance; seat charges entry (refund if you leave
  before the table fills, no free re-entry); end settles; rematch charges
  again. Wallet: typed router `src/wallet.ts` (`/wallet`, `/wallet/daily`,
  `/me`), phone wallet card. Ludo Star roadmap (spin, gifts) in ECONOMY.md.
- Lounge LIVE: `game-rules/src/lounge.ts`, `LoungeRoom` (knock/accept/decline
  with close codes, kick, make_leader, start → reservations, back to open),
  app Lounge tab `app/index.tsx` + `use-lounge`, Games tab. TEMPORARY guest
  token. Server verifies Supabase JWTs (`src/auth.ts`; guests only if
  ALLOW_GUEST_TOKENS=true). Next: login.
- Colyseus gotchas: `filterBy(['x'])` + join option `{ x }` matches `metadata.x`
  (plain keys). Room tests share ONE booted test server; two boots break it.
  `client.leave(code)` hits `onDrop` first: skip `allowReconnection` for own codes.

## 7. Project conventions
- Founder: Windows PC daily; MacBook Air for Xcode. Branch: `claude/modest-gates-unuglw`.
- Commit small and often, plain-English messages. Keep this file < 100 lines.
