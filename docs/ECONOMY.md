# Gamenite coin economy

Decided with the founder on 2026-09-22. This document is also the reference
we point to if Apple or Google ask how the economy works.

## What Gamenite is, in one paragraph

Gamenite is a casual social game. Players use **Coins**, an in-app currency,
to sit at tables and play Five Row and Court Piece with friends. Coins are
earned by playing, by daily bonuses, by watching optional rewarded videos,
or bought in the App Store. Coins have no cash value: they can never be
withdrawn, exchanged for money or prizes, or transferred between players.
Nothing in the game is chance-based; both games are games of skill and
partnership.

## The numbers

| Rule | Value |
|---|---|
| Starting coins for a new player | 1,000 |
| Daily bonus, once per day (UTC) | Login streak: 200 on day 1, +50 each consecutive day, 500 from day 7 on; miss a day and it restarts at day 1 |
| Rewarded video, per completed ad | 100, at most 5 ads per day |
| Table entry tiers | Free practice, 500, 2,000, 10,000 |
| Table fee | 10% of the losing side's entries at every tier (flat, decided), rounded up by leftovers |

## How a table works

1. Every player pays the table entry when they sit down. If a player cannot
   afford it, they cannot sit.
2. The game is played. Nothing changes hands during play.
3. When it ends, the winning side receives its own entries back plus the
   losing side's entries, minus the table fee, split equally. Rounding
   leftovers go to the fee.
4. A draw refunds everyone. Free practice tables charge and award nothing.
5. A player whose seat is abandoned (three timeouts in a row, or leaving)
   stays on their team's side of the result. If a whole team abandons, the
   other team wins.

Examples: 1 versus 1 at 500, the winner nets +450 and the loser −500. 2
versus 2 at 2,000, each winner nets +1,800. Three players at 10,000, the
winner nets +18,000.

Why a fee: every coin that leaves the economy makes the remaining coins
worth more to players, which is what keeps daily bonuses and ads meaningful
and keeps balances from inflating forever.

## Wording we use, and wording we never use

Use: coins, table, entry, reward, bonus, win, lose, series, kot.
Never: bet, wager, stake, pot, gamble, casino, cash out, jackpot, odds.
This applies to code, screens, store listings and support pages.

## Where the truth lives

- The **coin ledger** in Supabase is append-only: one row per movement, with
  a kind, an optional reference (the table id), and an idempotency key so a
  retried request can never apply twice. Rows are never updated or deleted.
- A **balance table** is kept in step by a database trigger and refuses to
  go below zero, which is what stops overdrafts.
- **Only the game server** moves coins, through a handful of database
  functions: create profile and grant the start, claim daily bonus, reward
  an ad, charge a table entry, settle a table. Phones can only read their
  own rows.
- The settlement arithmetic lives in the shared rules package
  (`packages/game-rules/src/economy.ts`) so the server and the phone agree
  to the coin.

## Known risks and the plan for each

- **Guest farming.** A guest gets 1,000 coins; someone could reinstall for
  another 1,000. Mitigation now: table fees make farming slow and guests
  cannot transfer coins. Later: tie the starting grant to a device check
  (App Attest on iOS) and require sign-in for the higher tiers.
- **Ad fraud.** Rewards require a completed-ad callback from the ad network
  with a unique ad id, capped at five per day, and are recorded with that id
  so the same view cannot be claimed twice.
- **Purchases.** Coin bundles bought through the App Store are credited by
  the server only after receipt validation, with the transaction id as the
  idempotency key. Not built yet.

## Ludo Star as the reference model

The founder wants the economy to follow Ludo Star, a proven casual game
with the same audience. What Ludo Star does, and where Gamenite stands:

| Ludo Star | Gamenite today | Plan |
|---|---|---|
| Coins for table entries, tiers from low to very high | Free, 500, 2,000, 10,000 | Add higher tiers as balances grow; gate them by level later |
| Winner takes the entries of the losers | Same, minus a 10% table fee | Keep |
| Daily login bonus that grows with a streak | Live: 200, 250 ... 500 by day 7, restarts after a missed day | Keep; revisit the numbers with real play data |
| Free coins for watching short videos | 100 per ad, five a day | Same, live once the ad account exists |
| Daily spin for coins and gems | Not yet | Free daily spin with fixed, published amounts; no real-money spins |
| Gems: a second, rarer currency for chests, cosmetics, skipping ads | Not yet | Gems for cosmetics and voice minutes; never for table entries |
| Send and receive gifts with friends (Lucky Dice) | Not yet | Small daily friend gifts once the friends list exists; capped, non-transferable balances |
| Invite a friend bonus | Not yet | One-time bonus when an invited friend plays a first table |
| Tournaments and events | Not yet | Later |

Two Ludo Star mechanics we deliberately keep out for the App Store:
nothing with random rewards is ever bought with real money, and coins are
never sent between players as a balance transfer. Gifts are small fixed
bonuses the server grants, not a way to move coins.

## The login streak

- The first claim of a streak pays 200. Every consecutive UTC day adds 50,
  so day 2 pays 250, day 3 pays 300, and day 7 and every day after pay 500.
- Missing a day restarts the streak at day 1. The streak day keeps counting
  past seven (a "day 30 streak" still pays 500) so long streaks feel earned.
- The database keeps the streak day and the last claim date on the profile,
  written only inside the claim; the ledger row records which day it paid.
  The phone shows the day, the amount, and what tomorrow pays.

## When coins actually move at a table

- The lounge leader picks the tier along with the game. Quick play shows the
  tiers as buttons.
- Tapping **Ready** in a lounge, or joining quick play, checks the player can
  afford the tier. If not, the game says how many coins are missing.
- The entry is charged the moment a seat is taken. If a table never fills
  and a player leaves, the entry is refunded, and that player cannot
  re-enter that same table for free.
- Rematch on a public table charges every seat again; a player who cannot
  afford it cannot vote for the rematch.
- Settlement happens once when the match or series ends, using the shared
  arithmetic, and is recorded once no matter how many times it is retried.
