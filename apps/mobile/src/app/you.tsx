import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setName, signInWith, signOut, socialSignInAvailable } from '@/lib/auth';
import { useSession } from '@/lib/session';

const PROVIDER_LABEL = { facebook: 'Facebook', google: 'Google', apple: 'Apple', guest: 'a guest' } as const;

/** Your name (changeable), your code, how you are signed in, and the way out. */
export default function YouScreen() {
  const session = useSession();
  const theme = useTheme();
  const [draft, setDraft] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await setName(draft);
      setNote('Saved. Friends see the new name from your next lounge or table.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">You</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Your name at the table
          </ThemedText>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={session.name || 'Your name'}
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            maxLength={16}
            style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
          />
          <Button label={saving ? 'Saving…' : 'Save name'} onPress={() => void save()} disabled={saving || draft.trim().length < 2 || draft.trim() === session.name} />
          {note ? <ThemedText type="small">{note}</ThemedText> : null}
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Your code: friends add you and knock on your lounge with it
          </ThemedText>
          <ThemedText type="title" selectable>
            {session.playerCode || '—'}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Signed in {session.provider === 'guest' ? 'as' : 'with'} {session.provider ? PROVIDER_LABEL[session.provider] : '…'}
          </ThemedText>
          {session.guest ? (
            <>
              <ThemedText type="small">Keep your coins and streak on every phone: add an account.</ThemedText>
              <View style={styles.row}>
                <Small label="Facebook" onPress={() => void signInWith('facebook')} disabled={!socialSignInAvailable || session.busy} />
                <Small label="Google" onPress={() => void signInWith('google')} disabled={!socialSignInAvailable || session.busy} />
                <Small label="Apple" onPress={() => void signInWith('apple')} disabled={!socialSignInAvailable || session.busy} />
              </View>
              {!socialSignInAvailable ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Available once the accounts in docs/ACCOUNTS.md exist.
                </ThemedText>
              ) : null}
            </>
          ) : null}
          {session.error ? <ThemedText type="small">{session.error}</ThemedText> : null}
          <Button label="Sign out" onPress={() => void signOut()} disabled={session.busy} />
          {session.guest ? (
            <ThemedText type="small" themeColor="textSecondary">
              Signing out as a guest forgets this guest and its coins.
            </ThemedText>
          ) : null}
        </ThemedView>
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

function Small({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.small}>
        <ThemedText type="small">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.three, alignItems: 'center' },
  card: { alignSelf: 'stretch', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderRadius: Spacing.four },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  input: { alignSelf: 'stretch', borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 18 },
  button: { alignItems: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three },
  small: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
