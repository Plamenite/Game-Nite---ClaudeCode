import { type SeatReservation } from '@colyseus/sdk';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { FiveRowBoard } from '@/components/fiverow-board';
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
  const { joinWithReservation } = table;
  const onTableReady = useCallback(
    (reservation: SeatReservation) => {
      void joinWithReservation(reservation);
    },
    [joinWithReservation],
  );
  const party = useParty({ onTableReady });

  const atTable = table.status === 'seated' || table.status === 'connecting';
  const inParty = party.status === 'in_party' || party.status === 'connecting';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {atTable ? (
          <GameView table={table} onLeft={() => void party.leave()} />
        ) : inParty ? (
          <PartyView party={party} />
        ) : (
          <MenuView party={party} table={table} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

// ---------------------------------------------------------------- menu

function MenuView({ party, table }: { party: ReturnType<typeof useParty>; table: ReturnType<typeof useFiveRow> }) {
  const [code, setCode] = useState('');
  const theme = useTheme();
  const busy = party.status === 'connecting' || table.status === 'connecting';
  const error = party.error ?? table.error;

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

      <Button label={busy ? 'Connecting…' : 'Quick play: 1 vs 1'} onPress={() => void table.quickPlay(2)} disabled={busy} />
    </>
  );
}

// ---------------------------------------------------------------- party

function PartyView({ party }: { party: ReturnType<typeof useParty> }) {
  const snap = party.snapshot;
  const me = snap?.members.find((m) => m.sessionId === party.sessionId);
  const isLeader = Boolean(me?.isLeader);
  const launching = snap?.status !== 'open';

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

      <ThemedView type="backgroundElement" style={styles.card}>
        {snap?.members.map((member) => (
          <View key={member.sessionId} style={styles.row}>
            <ThemedText type={member.isLeader ? 'smallBold' : 'small'}>
              {member.isLeader ? '★ ' : '  '}
              {member.name}
              {member.sessionId === party.sessionId ? ' (you)' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {member.ready ? 'Ready' : 'Not ready'}
            </ThemedText>
          </View>
        ))}
        {snap && snap.members.length < 2 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Waiting for at least one friend…
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
