import { type SeatReservation } from '@colyseus/sdk';
import {
  COURT_PIECE_PRIVATE_BEST_OF,
  COURT_PIECE_VARIANTS,
  GAMES,
  LOUNGE_FORMATS,
  LOUNGE_SIZE,
  TABLE_ENTRY_TIERS,
  formatsForLounge,
  isTeamGame,
  type LoungeSnapshot,
} from '@gamenite/game-rules';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourtPieceTable } from '@/components/court-piece-table';
import { FiveRowBoard, TEAM_COLORS } from '@/components/fiverow-board';
import { ShortOnCoins } from '@/components/short-on-coins';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VoiceBar } from '@/components/voice-bar';
import { WalletCard } from '@/components/wallet-card';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useCourtPiece } from '@/hooks/use-court-piece';
import { useFiveRow } from '@/hooks/use-fiverow';
import { useLounge } from '@/hooks/use-lounge';
import { useTheme } from '@/hooks/use-theme';
import { takeKnock, usePendingKnock } from '@/lib/intents';
import { loadMuted } from '@/lib/voice';

/**
 * The first screen: your lounge (PUBG style). You land in it, friends knock
 * with your code, everyone taps Ready, the leader starts. The game plays on
 * top; when it ends you are back here with the same people.
 */
export default function LoungeScreen() {
  const table = useFiveRow();
  const cards = useCourtPiece();
  const gameRef = useRef<'fiverow' | 'courtpiece'>('fiverow');
  const joinFiveRow = table.joinWithReservation;
  const joinCourtPiece = cards.joinWithReservation;
  const onTableReady = useCallback(
    (reservation: SeatReservation) => {
      if (gameRef.current === 'courtpiece') void joinCourtPiece(reservation);
      else void joinFiveRow(reservation);
    },
    [joinFiveRow, joinCourtPiece],
  );
  const lounge = useLounge({ onTableReady });
  useEffect(() => {
    if (lounge.snapshot) gameRef.current = lounge.snapshot.game;
  }, [lounge.snapshot]);

  // You always have a lounge: open yours on arrival, and again whenever you
  // leave a friend's (or are shown out).
  const { status: loungeStatus, enterMine, knock } = lounge;
  useEffect(() => {
    if (loungeStatus === 'idle') void enterMine();
  }, [loungeStatus, enterMine]);

  // The Friends tab asked us to knock on someone: do it once we are settled.
  const pendingKnock = usePendingKnock();
  useEffect(() => {
    if (pendingKnock && loungeStatus === 'in_lounge') {
      const code = takeKnock();
      if (code) void knock(code);
    }
  }, [pendingKnock, loungeStatus, knock]);

  useEffect(() => {
    void loadMuted();
  }, []);

  const atTable = table.status === 'seated' || table.status === 'connecting';
  const atCards = cards.status === 'seated' || cards.status === 'connecting';
  // The lounge's voice carries into the match: same strip above the table.
  const voice = lounge.snapshot && lounge.status === 'in_lounge' ? <VoiceBar members={lounge.snapshot.members} mySessionId={lounge.sessionId} onMic={lounge.setMic} /> : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {atCards ? <CourtPieceView cards={cards} voice={voice} /> : atTable ? <GameView table={table} voice={voice} /> : <LoungeView lounge={lounge} table={table} cards={cards} voice={voice} />}
      </SafeAreaView>
    </ThemedView>
  );
}

// ---------------------------------------------------------------- lounge

function LoungeView({
  lounge,
  table,
  cards,
  voice,
}: {
  lounge: ReturnType<typeof useLounge>;
  table: ReturnType<typeof useFiveRow>;
  cards: ReturnType<typeof useCourtPiece>;
  voice: React.ReactNode;
}) {
  const snap = lounge.snapshot;
  const me = snap?.members.find((m) => m.sessionId === lounge.sessionId);
  const isLeader = Boolean(me?.isLeader);
  const starting = snap?.status !== 'open';
  const busy = lounge.status === 'connecting' || table.status === 'connecting' || cards.status === 'connecting';
  const error = lounge.error ?? table.error ?? cards.error;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <WalletCard />

      {lounge.status === 'waiting' ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle">Knocking…</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Waiting for someone in the lounge to let you in.
          </ThemedText>
          <Button label="Never mind" onPress={() => void lounge.leave()} />
        </ThemedView>
      ) : null}

      {lounge.status === 'error' ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">{error ?? 'Could not reach the server.'}</ThemedText>
          <Button label="Try again" onPress={() => void lounge.enterMine()} />
        </ThemedView>
      ) : null}

      {lounge.status === 'connecting' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Opening your lounge…
        </ThemedText>
      ) : null}

      {lounge.notice ? <ThemedText type="small">{lounge.notice}</ThemedText> : null}
      <ShortOnCoins message={lounge.notice} />
      {error && lounge.status !== 'error' ? <ThemedText type="small">{error}</ThemedText> : null}
      <ShortOnCoins message={error} />

      {snap && lounge.status === 'in_lounge' ? (
        <>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">{lounge.inMyOwn ? 'Your lounge' : "A friend's lounge"}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {lounge.inMyOwn ? 'Friends knock with your code' : 'Friends knock with this code'}
            </ThemedText>
            <ThemedText type="title" selectable>
              {snap.code}
            </ThemedText>
          </ThemedView>

          {voice}
          <Seats snap={snap} mySessionId={lounge.sessionId} isLeader={isLeader} starting={starting} lounge={lounge} />

          {snap.requests.length > 0 ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">At the door</ThemedText>
              {snap.requests.map((r) => (
                <View key={r.sessionId} style={styles.row}>
                  <ThemedText type="small">{r.name} wants to join</ThemedText>
                  <View style={styles.rowRight}>
                    <SmallButton label="Let in" onPress={() => lounge.accept(r.sessionId)} />
                    <SmallButton label="Not now" onPress={() => lounge.decline(r.sessionId)} />
                  </View>
                </View>
              ))}
            </ThemedView>
          ) : null}

          <GamePicker snap={snap} isLeader={isLeader} starting={starting} lounge={lounge} />

          <View style={styles.buttons}>
            <Button label={me?.ready ? 'Not ready' : 'Ready'} onPress={() => lounge.setReady(!me?.ready)} disabled={!me || starting} />
            {isLeader ? (
              <>
                <Button label={starting ? 'Starting…' : 'Start'} onPress={lounge.start} disabled={!snap.canStart || starting} />
                {snap.seatsToFill > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                    {snap.seatsToFill === 1 ? 'One empty seat goes' : `${snap.seatsToFill} empty seats go`} to other players at the same entry.
                    {snap.game === 'courtpiece' ? ' With other players at the table it is one deal, then a rematch vote.' : ''}
                  </ThemedText>
                ) : null}
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {starting ? 'Starting…' : 'The leader starts when everyone is ready.'}
              </ThemedText>
            )}
            {!lounge.inMyOwn ? <Button label="Back to my lounge" onPress={() => void lounge.leave()} /> : null}
          </View>

          {lounge.inMyOwn ? <KnockCard lounge={lounge} busy={busy} /> : null}
          {lounge.inMyOwn && snap.members.length === 1 ? <QuickPlayCard table={table} cards={cards} busy={busy} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Seats({
  snap,
  mySessionId,
  isLeader,
  starting,
  lounge,
}: {
  snap: LoungeSnapshot;
  mySessionId: string | null;
  isLeader: boolean;
  starting: boolean;
  lounge: ReturnType<typeof useLounge>;
}) {
  const teamGame = isTeamGame(snap.game, snap.players);
  // Two friends at a team table are always partners; sides only matter from three up.
  const showSides = teamGame && snap.members.length >= 3;
  const empty = Math.max(LOUNGE_SIZE - snap.members.length, 0);
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {snap.members.map((member) => {
        const isMe = member.sessionId === mySessionId;
        return (
          <View key={member.sessionId} style={styles.seat}>
            <View style={styles.row}>
              <ThemedText type={member.isLeader ? 'smallBold' : 'small'}>
                {member.isLeader ? '★ ' : '  '}
                {member.name}
                {isMe ? ' (you)' : ''}
              </ThemedText>
              <View style={styles.rowRight}>
                {showSides ? (
                  <Pressable
                    disabled={!isLeader || starting}
                    onPress={() => lounge.setTeam(member.sessionId, member.team === 0 ? 1 : 0)}
                    accessibilityRole="button"
                    style={({ pressed }) => pressed && styles.pressed}>
                    <View style={[styles.teamBadge, { backgroundColor: TEAM_COLORS[member.team] }]}>
                      <ThemedText type="smallBold" style={styles.teamBadgeText}>
                        {member.team === 0 ? 'A' : 'B'}
                      </ThemedText>
                    </View>
                  </Pressable>
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  {member.ready ? 'Ready' : 'Not ready'}
                </ThemedText>
              </View>
            </View>
            {isLeader && !isMe && !starting ? (
              <View style={styles.rowRight}>
                <SmallButton label="Make leader" onPress={() => lounge.makeLeader(member.sessionId)} />
                <SmallButton label="Remove" onPress={() => lounge.kick(member.sessionId)} />
              </View>
            ) : null}
          </View>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <ThemedText key={`empty-${i}`} type="small" themeColor="textSecondary">
          {'  '}Empty seat
        </ThemedText>
      ))}
      {showSides && isLeader ? (
        <ThemedText type="small" themeColor="textSecondary">
          {snap.members.length === LOUNGE_SIZE ? 'Tap A or B to move a player. Two a side; partners sit opposite.' : 'Tap A or B to move a player. Two together, one alone; another player partners the one alone.'}
        </ThemedText>
      ) : null}
      {teamGame && snap.members.length === 2 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You two play as partners. Two other players take the other side.
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function GamePicker({ snap, isLeader, starting, lounge }: { snap: LoungeSnapshot; isLeader: boolean; starting: boolean; lounge: ReturnType<typeof useLounge> }) {
  const formats = formatsForLounge(snap.members.length);
  const gameName = snap.game === 'courtpiece' ? 'Court Piece' : GAMES[0].name;
  const sizeName = formats.find((f) => f.game === snap.game && f.players === snap.players)?.name ?? `${snap.players} players`;
  const variantName = COURT_PIECE_VARIANTS.find((v) => v.id === snap.variant)?.name ?? '';

  if (!isLeader || starting) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          {gameName} · {sizeName}
          {snap.game === 'courtpiece' ? ` · ${variantName} · best of ${snap.bestOfAtTable}` : ''}
          {` · entry ${tierLabel(snap.entry)}`}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary">
        Game
      </ThemedText>
      <View style={styles.choiceRow}>
        <Choice label={GAMES[0].name} selected={snap.game === 'fiverow'} onPress={() => lounge.setGame({ game: 'fiverow', players: formats.find((f) => f.game === 'fiverow')?.players })} />
        <Choice label="Court Piece" selected={snap.game === 'courtpiece'} onPress={() => lounge.setGame({ game: 'courtpiece' })} />
      </View>
      {snap.game === 'fiverow' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Table
          </ThemedText>
          <View style={styles.choiceRow}>
            {formats
              .filter((f) => f.game === 'fiverow')
              .map((f) => (
                <Choice key={f.players} label={f.name} selected={snap.players === f.players} onPress={() => lounge.setGame({ game: 'fiverow', players: f.players })} />
              ))}
          </View>
        </>
      ) : (
        <>
          <View style={styles.choiceRow}>
            {COURT_PIECE_VARIANTS.map((v) => (
              <Choice key={v.id} label={v.name} selected={snap.variant === v.id} onPress={() => lounge.setGame({ game: 'courtpiece', variant: v.id })} />
            ))}
          </View>
          {snap.seatsToFill === 0 ? (
            <View style={styles.choiceRow}>
              {COURT_PIECE_PRIVATE_BEST_OF.map((n) => (
                <Choice key={n} label={`Best of ${n}`} selected={snap.bestOf === n} onPress={() => lounge.setGame({ game: 'courtpiece', bestOf: n })} />
              ))}
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Best of 3 or 5 needs a full lounge of four friends.
            </ThemedText>
          )}
        </>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        Table entry
      </ThemedText>
      <View style={styles.choiceRow}>
        {TABLE_ENTRY_TIERS.map((tier) => (
          <Choice key={tier} label={tierLabel(tier)} selected={snap.entry === tier} onPress={() => lounge.setGame({ game: snap.game, entry: tier })} />
        ))}
      </View>
    </ThemedView>
  );
}

function KnockCard({ lounge, busy }: { lounge: ReturnType<typeof useLounge>; busy: boolean }) {
  const [code, setCode] = useState('');
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        Join a friend: type their code and knock (friends only; add them in the Friends tab first)
      </ThemedText>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Friend's code, e.g. K7PM3XAB"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
      />
      <Button label="Knock" onPress={() => void lounge.knock(code)} disabled={busy || code.trim().length < 8} />
    </ThemedView>
  );
}

function QuickPlayCard({ table, cards, busy }: { table: ReturnType<typeof useFiveRow>; cards: ReturnType<typeof useCourtPiece>; busy: boolean }) {
  const [entry, setEntry] = useState<number>(0);
  const [game, setGame] = useState<'fiverow' | 'courtpiece'>('fiverow');
  const [players, setPlayers] = useState<2 | 3 | 4>(2);
  const [variant, setVariant] = useState<'single_siri' | 'double_siri'>('single_siri');
  const play = () => {
    if (game === 'courtpiece') void cards.quickPlay(variant, entry);
    else void table.quickPlay(players, entry);
  };
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary">
        On your own? Play now with other players
      </ThemedText>
      <View style={styles.choiceRow}>
        <Choice label={GAMES[0].name} selected={game === 'fiverow'} onPress={() => setGame('fiverow')} />
        <Choice label="Court Piece" selected={game === 'courtpiece'} onPress={() => setGame('courtpiece')} />
      </View>
      <View style={styles.choiceRow}>
        {game === 'fiverow'
          ? LOUNGE_FORMATS.filter((f) => f.game === 'fiverow').map((f) => (
              <Choice key={f.players} label={f.name} selected={players === f.players} onPress={() => setPlayers(f.players)} />
            ))
          : COURT_PIECE_VARIANTS.map((v) => <Choice key={v.id} label={v.name} selected={variant === v.id} onPress={() => setVariant(v.id)} />)}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Table entry
      </ThemedText>
      <View style={styles.choiceRow}>
        {TABLE_ENTRY_TIERS.map((tier) => (
          <Choice key={tier} label={tierLabel(tier)} selected={entry === tier} onPress={() => setEntry(tier)} />
        ))}
      </View>
      <Button label={busy ? 'Connecting…' : 'Play now'} onPress={play} disabled={busy} />
    </ThemedView>
  );
}

function tierLabel(tier: number): string {
  return tier === 0 ? 'Free' : tier.toLocaleString();
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type={selected ? 'backgroundSelected' : 'background'} style={styles.choice}>
        <ThemedText type={selected ? 'smallBold' : 'small'}>{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

// ---------------------------------------------------------------- court piece

function CourtPieceView({ cards, voice }: { cards: ReturnType<typeof useCourtPiece>; voice: React.ReactNode }) {
  const { status, snapshot, hand, error, notice, sessionId, clockOffset, play, rematch, leave } = cards;
  const doLeave = () => void leave();
  if (status === 'connecting' || !snapshot) {
    return (
      <>
        <ThemedText type="subtitle">Court Piece</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Taking your seat…
        </ThemedText>
        {error ? <ThemedText type="small">{error}</ThemedText> : null}
        <Button label="Cancel" onPress={doLeave} />
      </>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {voice}
      {error ? <ThemedText type="small">{error}</ThemedText> : null}
      <CourtPieceTable snapshot={snapshot} hand={hand} mySessionId={sessionId} clockOffset={clockOffset} notice={notice} onPlay={play} onRematch={rematch} onLeave={doLeave} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- five row

function GameView({ table, voice }: { table: ReturnType<typeof useFiveRow>; voice: React.ReactNode }) {
  const { status, snapshot, hand, error, notice, sessionId, clockOffset, sendMove, pass, leave } = table;
  const doLeave = () => void leave();

  if (status === 'connecting' || !snapshot) {
    return (
      <>
        <ThemedText type="subtitle">Table</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Taking your seat…
        </ThemedText>
        {error ? <ThemedText type="small">{error}</ThemedText> : null}
        <Button label="Cancel" onPress={doLeave} />
      </>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {voice}
      {error ? <ThemedText type="small">{error}</ThemedText> : null}
      <FiveRowBoard snapshot={snapshot} hand={hand} mySessionId={sessionId} clockOffset={clockOffset} notice={notice} onMove={sendMove} onPass={pass} onLeave={doLeave} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- bits

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.buttonInner}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundSelected" style={styles.choice}>
        <ThemedText type="small">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    alignSelf: 'stretch',
  },
  scrollContent: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  seat: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  choice: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  teamBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamBadgeText: {
    color: '#FFFFFF',
  },
  buttons: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  buttonInner: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
  },
  center: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
