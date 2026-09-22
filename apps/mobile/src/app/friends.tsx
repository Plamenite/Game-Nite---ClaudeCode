import { canKnockOn, describeStatus, sortFriends } from '@gamenite/game-rules';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useFriends } from '@/hooks/use-friends';
import { useTheme } from '@/hooks/use-theme';
import { requestKnock } from '@/lib/intents';
import { useSession } from '@/lib/session';

const REFRESH_MS = 30_000;

/**
 * Friends: add by code, answer requests, see who is online, knock on a
 * friend's lounge from the list. Facebook friends arrive on tap, later.
 */
export default function FriendsScreen() {
  const session = useSession();
  const friends = useFriends();
  const router = useRouter();
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const { refresh } = friends;

  // Fresh whenever the tab is shown, and every half minute while it stays open.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refresh();
      return () => setFocused(false);
    }, [refresh]),
  );
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, refresh]);

  const lists = friends.lists;
  const knock = (friendCode: string) => {
    requestKnock(friendCode);
    router.navigate('/');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Friends</ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              Your code. Friends add you with it, and knock on your lounge with it.
            </ThemedText>
            <ThemedText type="title" selectable>
              {session.playerCode || '—'}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              Add a friend by their code
            </ThemedText>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="e.g. K7PM3XAB"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <Button
              label="Send request"
              disabled={friends.busy || code.trim().length < 8}
              onPress={() => {
                void friends.add(code);
                setCode('');
              }}
            />
            <Button label="Find Facebook friends (soon)" disabled onPress={() => undefined} />
            {friends.error ? <ThemedText type="small">{friends.error}</ThemedText> : null}
          </ThemedView>

          {lists && lists.incoming.length > 0 ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Want to be your friend</ThemedText>
              {lists.incoming.map((r) => (
                <View key={r.playerCode} style={styles.row}>
                  <ThemedText type="small">{r.name}</ThemedText>
                  <View style={styles.rowRight}>
                    <Small label="Accept" onPress={() => void friends.answer(r.playerCode, true)} />
                    <Small label="Decline" onPress={() => void friends.answer(r.playerCode, false)} />
                  </View>
                </View>
              ))}
            </ThemedView>
          ) : null}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Your friends</ThemedText>
            {!lists ? (
              <ThemedText type="small" themeColor="textSecondary">
                Loading…
              </ThemedText>
            ) : lists.friends.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nobody yet. Swap codes with a friend and send a request.
              </ThemedText>
            ) : (
              sortFriends(lists.friends).map((f) => (
                <View key={f.playerCode} style={styles.friend}>
                  <View style={styles.row}>
                    <View>
                      <ThemedText type="small">{f.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {describeStatus(f, session.playerCode)}
                      </ThemedText>
                    </View>
                    <View style={styles.rowRight}>
                      {canKnockOn(f, session.playerCode) && f.loungeCode ? <Small label="Knock" onPress={() => knock(f.loungeCode!)} /> : null}
                      <Small label="Remove" onPress={() => void friends.remove(f.playerCode)} />
                    </View>
                  </View>
                </View>
              ))
            )}
          </ThemedView>

          {lists && lists.outgoing.length > 0 ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Waiting on them</ThemedText>
              {lists.outgoing.map((r) => (
                <View key={r.playerCode} style={styles.row}>
                  <ThemedText type="small">{r.name}</ThemedText>
                  <Small label="Withdraw" onPress={() => void friends.remove(r.playerCode)} />
                </View>
              ))}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.button}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function Small({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundSelected" style={styles.small}>
        <ThemedText type="small">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, alignItems: 'center' },
  scroll: { alignSelf: 'stretch' },
  scrollContent: { alignItems: 'center', gap: Spacing.three, paddingBottom: Spacing.five },
  card: { alignSelf: 'stretch', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderRadius: Spacing.four },
  friend: { gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { alignSelf: 'stretch', borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 18, letterSpacing: 2, textAlign: 'center' },
  button: { alignItems: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three },
  small: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
