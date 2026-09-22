import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTable } from '@/hooks/use-table';

const STATUS_LABEL = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  seated: 'Seated at the table',
  left: 'Left the table',
  error: 'Could not connect',
} as const;

/**
 * WALKING SKELETON screen: join a table, see who else is seated, and pass
 * a turn around by tapping. Proves phone ↔ server before any real game.
 */
export default function TableScreen() {
  const { status, snapshot, error, sessionId, serverUrl, join, leave, play } = useTable();

  const seated = status === 'seated';
  const myTurn = seated && snapshot?.currentTurn === sessionId;
  const started = (snapshot?.turnCount ?? 0) > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Table</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {STATUS_LABEL[status]}
        </ThemedText>
        <ThemedText type="code">{serverUrl}</ThemedText>
        {error ? <ThemedText type="small">{error}</ThemedText> : null}

        <ThemedView type="backgroundElement" style={styles.card}>
          {snapshot && snapshot.players.length > 0 ? (
            snapshot.players.map((player) => {
              const isMe = player.sessionId === sessionId;
              const isTurn = player.sessionId === snapshot.currentTurn;
              return (
                <View key={player.sessionId} style={styles.row}>
                  <ThemedText type={isTurn ? 'smallBold' : 'small'}>
                    {isTurn ? '▶ ' : '  '}
                    {player.name}
                    {isMe ? ' (you)' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {player.score} taps
                  </ThemedText>
                </View>
              );
            })
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {seated ? 'Waiting for another player…' : 'Join to see the table.'}
            </ThemedText>
          )}
          {seated && !started && snapshot && snapshot.players.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              The turn starts when the table is full.
            </ThemedText>
          ) : null}
        </ThemedView>

        <View style={styles.buttons}>
          {seated ? (
            <>
              <Button label={myTurn ? 'Tap to play' : 'Wait for your turn'} onPress={play} disabled={!myTurn} />
              <Button label="Leave" onPress={leave} />
            </>
          ) : (
            <Button
              label={status === 'connecting' ? 'Connecting…' : 'Join a table'}
              onPress={join}
              disabled={status === 'connecting'}
            />
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.buttonInner}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  button: {
    alignSelf: 'stretch',
  },
  buttonInner: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
