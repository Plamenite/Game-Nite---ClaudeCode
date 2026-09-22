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

Send Claude: the Team ID. Claude then registers the app id
`app.plamenite.gamenite` and enables Sign in with Apple through Expo's tools.

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

## 7. Domain plamenite.app — required by Apple and Meta

Buy `plamenite.app` at any registrar. Claude will publish three small pages
on it: privacy policy, support, and data deletion. Apple needs the first two
before the app can be listed; Meta needs the first and the third.

## Checklist of what to send back

- Expo username
- Apple Team ID
- Supabase Project URL and anon/publishable key
- Google iOS client ID and Web client ID
- Facebook App ID
- Agora App ID
- Confirmation that the domain is bought
