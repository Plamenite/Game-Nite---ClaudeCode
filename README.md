# Gamenite

An iOS-first mobile platform for multiplayer board and card games, starting
with a five-in-a-row card-and-chip game (internal name Five Row) and **Court Piece (Rang)**. Friends gather in a party lobby
with voice chat, ready up, and play. Coins and gems are in-app only and are
never exchangeable for money.

## What is in this repo

```
apps/mobile/          The phone app (Expo + React Native, TypeScript)
apps/server/          The game server (Colyseus, TypeScript). Deals cards,
                      keeps hands secret, checks every move.
packages/game-rules/  Rules shared by BOTH the app and the server, so they
                      can never disagree about what a legal move is.
scripts/              Setup helpers. See setup-windows.ps1.
docs/ACCOUNTS.md      The accounts and keys only the founder can create.
docs/ECONOMY.md       How coins work, in plain English, and why it is not gambling.
supabase/migrations/  The database: profiles and the append-only coin ledger.
CLAUDE.md             Project memory for the AI CTO. Read it first.
```

Every push is checked automatically on GitHub (type check + tests); look for
the green tick next to the latest commit.

## First-time setup on Windows

Open PowerShell and paste this one line:

```powershell
irm https://raw.githubusercontent.com/Plamenite/Game-Nite---ClaudeCode/claude/modest-gates-unuglw/scripts/setup-windows.ps1 | iex
```

It installs Git, Node.js and VS Code, downloads this code into
`Documents\gamenite`, and installs the packages. Then install the free
**Expo Go** app on your iPhone.

## Everyday commands (run from the `gamenite` folder)

| Command | What it does |
|---|---|
| `npm run mobile` | Starts the app. Scan the QR code with your iPhone camera to open it in Expo Go. |
| `npm run mobile:tunnel` | Same, but works when the phone and PC are on different Wi-Fi networks. Slower. |
| `npm run server` | Starts the game server on your PC at http://localhost:2567 |
| `npm test` | Runs the automated tests. |
| `npm run typecheck` | Checks the code for type errors without running it. |
| `npm run smoke -w @gamenite/server` | With the server running: joins it like a phone would and prints the party code. |

Phone and PC must be on the same Wi-Fi for `npm run mobile`. If the phone
cannot connect, Windows Firewall is usually blocking Node.js; allow it, or
use the tunnel command.

## Try it: party → a real game (phone talks to server)

1. In one terminal: `npm run server`. Click Allow if Windows Firewall asks.
2. In another terminal: `npm run mobile`, then open the app on your iPhone.
3. Open the **Play** tab and tap **Create a party**. A 6-character code
   appears.
4. For a second player, press `w` in the mobile terminal to open the app in
   a browser tab, go to Play, type the code, and tap **Join party**.
5. Both tap **Ready**. The leader (★) taps **Launch**. Everyone lands at the
   same Five Row table with seven private cards. With four friends the
   leader can pick **Court Piece** instead, choose Single or Double Siri and
   best of 1, 3 or 5, and tap the A/B badges to set the teams.
6. On your turn, pick a card, then tap a highlighted space. A two-eyed Jack
   goes anywhere open; a one-eyed Jack removes an opponent's chip. A dead
   card (both spaces taken) can be swapped once per turn. Thirty seconds per
   turn; if you run out, the server plays a random legal card for you.

**Quick play** skips the party: Five Row 1 vs 1, or Court Piece Single Siri with three strangers.

Low on disk space? Use slim setup: it skips VS Code and clears the npm cache.

```powershell
$env:GAMENITE_SLIM = '1'; irm https://raw.githubusercontent.com/Plamenite/Game-Nite---ClaudeCode/claude/modest-gates-unuglw/scripts/setup-windows.ps1 | iex
```

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo SDK 57, React Native, TypeScript, Expo Router |
| Game server | Colyseus 0.18 (authoritative rooms, reconnection) |
| Accounts, database, storage | Supabase (Postgres) |
| Voice chat | Agora, behind our own VoiceService wrapper |
| Builds | Expo EAS Build (cloud Macs, no local Xcode needed) |
