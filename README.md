# Gamenite

An iOS-first mobile platform for multiplayer board and card games, starting
with **Sequence** and **Court Piece (Rang)**. Friends gather in a party lobby
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
CLAUDE.md             Project memory for the AI CTO. Read it first.
```

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

Phone and PC must be on the same Wi-Fi for `npm run mobile`. If the phone
cannot connect, Windows Firewall is usually blocking Node.js; allow it, or
use the tunnel command.

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo SDK 57, React Native, TypeScript, Expo Router |
| Game server | Colyseus 0.18 (authoritative rooms, reconnection) |
| Accounts, database, storage | Supabase (Postgres) |
| Voice chat | Agora, behind our own VoiceService wrapper |
| Builds | Expo EAS Build (cloud Macs, no local Xcode needed) |
