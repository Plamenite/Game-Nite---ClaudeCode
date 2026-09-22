# The lounge

Decided with the founder on 2026-09-22. The lounge is the PUBG-style room
every player owns: you land in it, friends come in, you talk (voice is
next), the leader picks the game, everyone taps Ready, the leader starts,
and when the game ends you are all back in the same lounge.

## Decisions

1. **First screen.** After login you land in your own lounge, with your
   coins and daily bonus in a strip at the top. The Games tab is the
   catalogue.
2. **Whose lounge.** Every player has one permanent lounge. Its code is the
   player's 8-character player code, so one code adds you as a friend and
   opens your lounge. Only the owner can open an empty lounge, and the
   owner always walks straight in.
3. **Who can walk in.** A friend knocks with the code and waits at the
   door. Anyone already inside can let them in or turn them away; an
   unanswered knock closes after a minute. The leader can remove people.
   Once accounts and friends exist, only friends may knock.
4. **Starting with fewer than four.** A lounge of two or three may start a
   four-seat game and the server fills the empty seats with other players
   at the same tier. NEXT STEP, not built yet: for now the format must be
   full.
5. **Formats.** The picker only offers formats that seat everyone in the
   lounge or more: 1 vs 1, 3 players, 2 vs 2 for Five Row, and Court Piece
   (always four).
6. **Leader.** The first one in leads. The leader picks the game, sides,
   tier, series length; can remove a member; can hand the lead to someone.
   If the leader leaves, the next member leads.
7. **Voice.** Off by default with a per-person mic button and a speaking
   indicator; carries into the game; the free daily minutes count only
   while the mic is on. Every player can mute any other player for
   themselves (must-have). Needs the Agora account.
8. **After the game.** The lounge stays open under the game with Ready
   cleared; everyone lands back in it, same leader. Play again = the
   leader taps Start again.

## Capacity

Four seats, like a PUBG squad. People waiting at the door do not take a
seat.

## Build order

1. The lounge itself (done): permanent lounge, knock and answer, remove,
   hand over, formats, stays open under the game, phone Lounge tab.
2. Fill empty seats with other players when a smaller lounge starts a
   bigger table.
3. Accounts and friends: friend-only knocking, online status, invites.
4. Voice, with mute-for-me.
5. Rewarded ads.

## How it is wired

- Shared contract: `packages/game-rules/src/lounge.ts` (messages, events,
  close codes, formats, `canStartLounge`, seats, snapshot).
- Server: `apps/server/src/rooms/LoungeRoom.ts` and its state schema;
  `GET /me` returns the player code; the ledger hands out player codes
  (memory in dev, `profiles.player_code` in Supabase).
- Phone: `apps/mobile/src/hooks/use-lounge.ts`, screen `src/app/index.tsx`.
