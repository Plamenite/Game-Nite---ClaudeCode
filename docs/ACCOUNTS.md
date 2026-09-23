# Accounts and keys: what only the founder can do

Everything in this file needs your identity, your card, or a login only you
own. Nobody can do these for you. Each one is a browser task; none needs a
terminal. Do them in this order. Console screens change over time, so this
describes **what to create and what to copy**, not exact button names.

## The two kinds of values

| Kind | Examples | Where it goes |
|---|---|---|
| **Public** | Supabase project URL and anon/publishable key, Google client IDs, Facebook App ID, Agora App ID, Apple Team ID | Paste them to Claude in chat. They ship inside the app anyway. |
| **Secret** | Supabase database password and secret/service key, Google client secret, Facebook App Secret, Agora App Certificate, Apple .p8 keys | **Never paste in chat, never commit.** Type them only into the console that asks for them, or into a file ending in `.local` that git ignores. Keep them in a password manager. |

## 1. Expo (free) — builds the iPhone app on cloud Macs

1. Sign up at https://expo.dev with your email.
2. Later, on your PC, your local Claude session runs `eas login` once.

Send Claude: your Expo username.

## 2. Apple Developer Program ($99/year) — TestFlight and the App Store

1. Enroll at https://developer.apple.com/programs as an **Individual** using
   your own Apple ID. Approval takes one to two days. Organization enrollment
   needs a registered company and a D-U-N-S number; Apple can convert later.
2. Once approved, open https://developer.apple.com/account and find your
   **Team ID** (10 characters).

Done: Team ID received and recorded. The app id `app.plamenite.gamenite`
and Sign in with Apple are set in `app.json`; EAS registers them at first build.

## 3. Supabase (free tier) — accounts, coins, friends

1. Sign up at https://supabase.com with **Sign in with GitHub**.
2. Create an organization "Plamenite" and a project "gamenite".
   - Region: pick **Mumbai (ap-south-1)** or **Singapore**, whichever is
     closest to most of your players.
   - Database password: generate a strong one and store it in your password
     manager. **Secret.**
3. In the project, open **Project Settings → API** and copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon / publishable** key
4. Open **Authentication → Sign In / Providers** and turn on:
   - **Anonymous sign-ins** (this is Guest mode)
   - **Apple**: client id = `app.plamenite.gamenite`
   - **Google**: paste the Web client ID and Web client secret from step 4
   - **Facebook**: paste the App ID and App Secret from step 5
5. Open **Authentication → URL Configuration** and add
   `gamenite://auth` to **Redirect URLs** (the app's return address).

Send Claude: Project URL and anon/publishable key. Keep the database password
and the secret/service key to yourself.

## 4. Google Cloud (free) — Google login

1. Go to https://console.cloud.google.com and create a project "Gamenite".
2. **APIs & Services → OAuth consent screen**: External, app name Gamenite,
   your support email, and your privacy policy URL once the domain is live.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   twice:
   - Type **iOS**: bundle id `app.plamenite.gamenite`. Copy the client ID.
   - Type **Web application**: authorized redirect URI is your Supabase
     project URL followed by `/auth/v1/callback`. Copy the client ID and the
     client secret.
4. Paste the Web client ID and secret into Supabase's Google provider.

Send Claude: the iOS client ID and the Web client ID. Keep the client secret
in Supabase only.

## 5. Meta for Developers (free) — Facebook login and Facebook friends

1. Go to https://developers.facebook.com, create a developer account, then
   **Create App**. Use case: authenticate and request data from users with
   Facebook Login. Type: Consumer. Name: Gamenite.
2. Add the **Facebook Login** product. In its settings, set **Valid OAuth
   Redirect URIs** to your Supabase project URL followed by
   `/auth/v1/callback`.
3. In **App settings → Basic** copy the **App ID** (public) and the **App
   Secret** (secret). Paste both into Supabase's Facebook provider. Also set
   there, once the domain is live: privacy policy URL, and the **Data
   Deletion** callback or instructions URL. Claude will build both pages.
4. Permissions we use: `public_profile`, `email`, and `user_friends`.
   Before the app goes live, Meta reviews the `user_friends` permission and
   wants a short screen recording of the friends feature. Until then, only
   people you add as testers in the app's **Roles** see friends.

What Facebook friends can and cannot do, so expectations are right: Facebook
only ever returns friends who **also use Gamenite** and have granted the same
permission. That is exactly how PUBG's Facebook friends work. Friends who do
not play cannot be listed or invited through Facebook.

Send Claude: the App ID. Keep the App Secret in Supabase only.

## 6. Agora (free tier) — voice chat

1. Sign up at https://console.agora.io and create a project "Gamenite" with
   **Secured mode: App ID + Token**.
2. Copy the **App ID** (public) and the **App Certificate** (secret).

Send Claude: the App ID. The App Certificate goes into the game server's
hosting environment settings later, never into chat or git.

### Wiring voice once Agora exists
`AGORA_APP_ID` (public) and `AGORA_APP_CERTIFICATE` (SECRET) go into the
server's environment; the server then mints channel tickets. See
`docs/VOICE.md` for what the phone still needs (the native SDK build).

## 7. Domain plamenite.app — required by Apple and Meta

Buy `plamenite.app` at any registrar. Claude will publish three small pages
on it: privacy policy, support, and data deletion. Apple needs the first two
before the app can be listed; Meta needs the first and the third.

## Checklist of what to send back

All received on 2026-09-23 and recorded in the repo (public values only):

- Expo username: `plamenite` (`apps/mobile/app.json` owner)
- Apple Team ID: `2Z3295J6DG` (`apps/mobile/app.json`, `apps/mobile/eas.json`)
- Supabase Project URL `https://aimmofpruwznsidtxcyt.supabase.co` and the
  publishable key (`apps/mobile/.env.development`, `.env.production`,
  `apps/server/.env.development`, `.env.production`)
- Google iOS client ID `990433516126-lrnv3ri856d6bkf6u939a9fgmmcesnim` and
  Web client ID `990433516126-dfc4kdkffa2tfu5eq2jj6okdrt6hlej4` (both
  `.apps.googleusercontent.com`): used inside Supabase, not in the app
- Facebook App ID `1818797646231245`: used inside Supabase, not in the app
- Agora App ID `ae5864ede5694931ac007396ed086143` (`apps/server/.env.*`)
- Domain plamenite.app: bought

## Supabase dashboard checklist (tick through once)

Open https://supabase.com/dashboard, pick the project, then:

1. **SQL Editor → New query.** Paste the whole file at
   https://raw.githubusercontent.com/Plamenite/Game-Nite---ClaudeCode/claude/modest-gates-unuglw/supabase/migrations/20260922000001_economy.sql
   and press Run. That creates profiles, the coin ledger, friends and voice
   minutes with all the rules. Safe to run again later; it only adds.
2. **Authentication → Sign In / Providers → Anonymous sign-ins: ON.**
   This is what "Continue as a guest" uses now.
3. **Authentication → Sign In / Providers → Google: ON.** Client ID = the
   Web client ID above; Client Secret = from Google Cloud (SECRET, paste
   into Supabase only). Under "Authorized Client IDs" add the iOS client ID.
   In Google Cloud the OAuth client's authorized redirect URI must be
   `https://aimmofpruwznsidtxcyt.supabase.co/auth/v1/callback`.
4. **Facebook: ON.** App ID above; App Secret from Meta (SECRET). In the
   Meta app, Facebook Login → Valid OAuth Redirect URIs must include the
   same `.../auth/v1/callback` address.
5. **Apple: ON, when the developer account is approved.** Client IDs:
   `app.plamenite.gamenite` (the bundle id, for the native button). For the
   browser flow (Android and guest upgrades) also a Services ID, the Team
   ID `2Z3295J6DG`, a Key ID and the .p8 key (SECRET) from
   developer.apple.com → Certificates, Identifiers & Profiles.
6. **Authentication → URL Configuration → Redirect URLs:** add
   `gamenite://auth/callback`.
7. **Authentication → Settings:** turn on **manual linking** ("Allow manual
   linking"), so a guest who adds an account keeps their coins.
8. **Project Settings → JWT Keys.** If it says the project uses the legacy
   JWT secret, click **Migrate** to signing keys. The game server checks
   tokens against the public keys; the app will say so plainly if this step
   is still missing.
9. **Project Settings → API Keys → secret key** (older projects call it
   "service_role"). Copy it ONLY into a local file on your PC, never chat,
   never the repo. See "Pasting secrets on your PC" below.

## Expo (EAS) project: on the website, no typing

1. Sign in at https://expo.dev as `plamenite`.
2. Projects → **Create a project**. Name it `gamenite`, slug `gamenite`.
3. It shows a **Project ID** (letters, numbers and dashes). Send that to
   Claude, who records it in `apps/mobile/app.json`.

(Please do not run `eas init` on your PC: it edits `app.json` locally, and
that local edit blocks the setup script from pulling later updates.)

## Pasting secrets on your PC

Secrets live in one file on your PC that git ignores:
`Documents\gamenite\apps\server\.env.development.local`. The server
reads it every time it starts. Nothing here ever leaves your PC.

1. Press the **Windows key**, type `powershell`, press **Enter**. A blue or
   black window opens with a line ending in `>`.
2. Go to the server folder. Paste this and press Enter:

   ```powershell
   cd $HOME\Documents\gamenite\apps\server
   ```

   If it says "Cannot find path", the project is not on this PC yet: run
   the setup one-liner from the README first, then come back.
3. In Notepad, write the line below, then replace the part after `=` with
   your secret (keep no spaces around `=`, and keep the single quotes):

   ```powershell
   Add-Content -Path .env.development.local -Value 'SUPABASE_SERVICE_ROLE_KEY=paste-the-secret-key-here'
   ```

   Copy the whole finished line from Notepad, click in PowerShell,
   **right-click** to paste, press **Enter**. No message means it worked.
4. Same for the Agora App Certificate (Agora console → your project →
   Primary Certificate):

   ```powershell
   Add-Content -Path .env.development.local -Value 'AGORA_APP_CERTIFICATE=paste-the-certificate-here'
   ```

5. Check it (shows the names; glance that the values look right):

   ```powershell
   Get-Content .env.development.local
   ```

   A typo? Paste the corrected line again: the last line for a name wins.
6. Close Notepad without saving. Next `npm run server` prints
   "✅ .env.development.local loaded (local secrets)."

## Agora

The App ID is in the server's env files. The **App Certificate** is SECRET:
it goes in the local file, step 4 of "Pasting secrets on your PC" above.
Voice tickets then work; audio itself needs the native SDK build (docs/VOICE.md).
