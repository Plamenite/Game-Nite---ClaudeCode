import { type SeatReservation } from '@colyseus/sdk';
import { COURT_PIECE_PRIVATE_BEST_OF, COURT_PIECE_VARIANTS, GAMES, isTeamGame } from '@gamenite/game-rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { CourtPieceTable } from '@/components/court-piece-table';
import { FiveRowBoard, TEAM_COLORS } from '@/components/fiverow-board';
import { useCourtPiece } from '@/hooks/use-court-piece';
import { useFiveRow } from '@/hooks/use-fiverow';
import { useParty } from '@/hooks/use-party';
import { useTheme } from '@/hooks/use-theme';

/**
 * "Play" screen, three phases:
 *   menu  → create a party, join one by code, or quick play
 *   party → see friends, tap Ready, leader taps Launch
 *   table → a live Five Row game
 */
export default function PlayScreen() {
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
  const party = useParty({ onTableReady });
  useEffect(() => {
    if (party.snapshot) gameRef.current = party.snapshot.game;
  }, [party.snapshot]);

  const atTable = table.status === 'seated' || table.status === 'connecting';
  const atCards = cards.status === 'seated' || cards.status === 'connecting';
  const inParty = party.status === 'in_party' || party.status === 'connecting';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {atCards ? (
          <CourtPieceView cards={cards} onLeft={() => void party.leave()} />
        ) : atTable ? (
          <GameView table={table} onLeft={() => void party.leave()} />
        ) : inParty ? (
          <PartyView party={party} />
        ) : (
          <MenuView party={party} table={table} cards={cards} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

// ---------------------------------------------------------------- menu

function MenuView({
  party,
  table,
  cards,
}: {
  party: ReturnType<typeof useParty>;
  table: ReturnType<typeof useFiveRow>;
  cards: ReturnType<typeof useCourtPiece>;
}) {
  const [code, setCode] = useState('');
  const theme = useTheme();
  const busy = party.status === 'connecting' || table.status === 'connecting' || cards.status === 'connecting';
  const error = party.error ?? table.error ?? cards.error;

  return (
    <>
      <ThemedText type="subtitle">Play</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Gather friends in a party, or sit at any open table.
      </ThemedText>
      <ThemedText type="code">{table.serverUrl}</ThemedText>
      {error ? <ThemedText type="small">{error}</ThemedText> : null}

      <ThemedView type="backgroundElement" style={styles.card}>
        <Button label="Create a party" onPress={() => void party.create()} disabled={busy} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          or join a friend's party
        </ThemedText>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Party code, e.g. K7PM3X"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        />
        <Button label="Join party" onPress={() => void party.join(code)} disabled={busy || code.trim().length < 6} />
      </ThemedView>

      <Button label={busy ? 'Connecting…' : `Quick play: ${GAMES[0].name} 1 vs 1`} onPress={() => void table.quickPlay(2)} disabled={busy} />
      <Button label={busy ? 'Connecting…' : 'Quick play: Court Piece (Single Siri)'} onPress={() => void cards.quickPlay('single_siri')} disabled={busy} />
    </>
  );
}

// ---------------------------------------------------------------- party

function PartyView({ party }: { party: ReturnType<typeof useParty> }) {
  const snap = party.snapshot;
  const me = snap?.members.find((m) => m.sessionId === party.sessionId);
  const isLeader = Boolean(me?.isLeader);
  const launching = snap?.status !== 'open';
  const teamGame = snap ? isTeamGame(snap.game, snap.members.length) : false;
  const gameName = snap?.game === 'courtpiece' ? 'Court Piece' : GAMES[0].name;
  const variantName = COURT_PIECE_VARIANTS.find((v) => v.id === snap?.variant)?.name ?? '';

  return (
    <>
      <ThemedText type="subtitle">Party</ThemedText>
      {snap ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Friends join with this code
          </ThemedText>
          <ThemedText type="title" selectable>
            {snap.code}
          </ThemedText>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Connecting…
        </ThemedText>
      )}
      {party.notice ? <ThemedText type="small">{party.notice}</ThemedText> : null}
      {party.error ? <ThemedText type="small">{party.error}</ThemedText> : null}

      {snap ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          {isLeader && !launching ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Game
              </ThemedText>
              <View style={styles.choiceRow}>
                <Choice label={GAMES[0].name} selected={snap.game === 'fiverow'} onPress={() => party.setGame({ game: 'fiverow' })} />
                <Choice label="Court Piece" selected={snap.game === 'courtpiece'} onPress={() => party.setGame({ game: 'courtpiece' })} />
              </View>
              {snap.game === 'courtpiece' ? (
                <>
                  <View style={styles.choiceRow}>
                    {COURT_PIECE_VARIANTS.map((v) => (
                      <Choice key={v.id} label={v.name} selected={snap.variant === v.id} onPress={() => party.setGame({ game: 'courtpiece', variant: v.id })} />
                    ))}
                  </View>
                  <View style={styles.choiceRow}>
                    {COURT_PIECE_PRIVATE_BEST_OF.map((n) => (
                      <Choice key={n} label={`Best of ${n}`} selected={snap.bestOf === n} onPress={() => party.setGame({ game: 'courtpiece', bestOf: n })} />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {gameName}
              {snap.game === 'courtpiece' ? ` · ${variantName} · best of ${snap.bestOf}` : ''}
            </ThemedText>
          )}
        </ThemedView>
      ) : null}

      <ThemedView type="backgroundElement" style={styles.card}>
        {snap?.members.map((member) => (
          <View key={member.sessionId} style={styles.row}>
            <ThemedText type={member.isLeader ? 'smallBold' : 'small'}>
              {member.isLeader ? '★ ' : '  '}
              {member.name}
              {member.sessionId === party.sessionId ? ' (you)' : ''}
            </ThemedText>
            <View style={styles.rowRight}>
              {teamGame ? (
                <Pressable
                  disabled={!isLeader || launching}
                  onPress={() => party.setTeam(member.sessionId, member.team === 0 ? 1 : 0)}
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
        ))}
        {snap && snap.game === 'courtpiece' && snap.members.length !== 4 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Court Piece needs exactly four players.
          </ThemedText>
        ) : snap && snap.members.length < 2 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Waiting for at least one friend…
          </ThemedText>
        ) : null}
        {teamGame && isLeader ? (
          <ThemedText type="small" themeColor="textSecondary">
            Tap A or B to move a player. Two a side; partners sit opposite.
          </ThemedText>
        ) : null}
      </ThemedView>

      <View style={styles.buttons}>
        <Button
          label={me?.ready ? 'Not ready' : 'Ready'}
          onPress={() => party.setReady(!me?.ready)}
          disabled={!me || launching}
        />
        {isLeader ? (
          <Button
            label={launching ? 'Launching…' : 'Launch'}
            onPress={party.launch}
            disabled={!snap?.canLaunch || launching}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {launching ? 'Launching…' : 'The leader launches when everyone is ready.'}
          </ThemedText>
        )}
        <Button label="Leave party" onPress={() => void party.leave()} />
      </View>
    </>
  );
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

function CourtPieceView({ cards, onLeft }: { cards: ReturnType<typeof useCourtPiece>; onLeft: () => void }) {
  const { status, snapshot, hand, error, notice, sessionId, clockOffset, play, rematch, leave } = cards;
  const doLeave = () => {
    void leave();
    onLeft();
  };
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
      {error ? <ThemedText type="small">{error}</ThemedText> : null}
      <CourtPieceTable
        snapshot={snapshot}
        hand={hand}
        mySessionId={sessionId}
        clockOffset={clockOffset}
        notice={notice}
        onPlay={play}
        onRematch={rematch}
        onLeave={doLeave}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- game

function GameView({ table, onLeft }: { table: ReturnType<typeof useFiveRow>; onLeft: () => void }) {
  const { status, snapshot, hand, error, notice, sessionId, clockOffset, sendMove, pass, leave } = table;

  const doLeave = () => {
    void leave();
    onLeft();
  };

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
      {error ? <ThemedText type="small">{error}</ThemedText> : null}
      <FiveRowBoard
        snapshot={snapshot}
        hand={hand}
        mySessionId={sessionId}
        clockOffset={clockOffset}
        notice={notice}
        onMove={sendMove}
        onPass={pass}
        onLeave={doLeave}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- bits

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.buttonInner}>
        <ThemedText type="smallBold">{label}</ThemedText>
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
    paddingTop: Spacing.five,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
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
