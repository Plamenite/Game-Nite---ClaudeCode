import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { continueAsGuest, signInWith, socialSignInAvailable, socialSignInNote } from '@/lib/auth';
import { useSession } from '@/lib/session';

/**
 * The first thing a new player sees. DECIDED order: Facebook, Google,
 * Apple, then guest. Apple's own button is used on iPhone (Apple requires
 * it to be as prominent as the others, which it is: same row, same size).
 */
export function SignInScreen() {
  const session = useSession();
  const busy = session.busy;
  // Apple's rules: a white button on dark backgrounds, black on light ones.
  const dark = useColorScheme() === 'dark';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.center}>
            Gamenite
          </ThemedText>
          <ThemedText type="small" style={styles.center}>
            Board and card nights with friends, anywhere.
          </ThemedText>
        </View>

        <View style={styles.buttons}>
          <Button label="Continue with Facebook" onPress={() => void signInWith('facebook')} disabled={busy || !socialSignInAvailable} />
          <Button label="Continue with Google" onPress={() => void signInWith('google')} disabled={busy || !socialSignInAvailable} />
          {Platform.OS === 'ios' && socialSignInAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={Spacing.three}
              style={styles.apple}
              onPress={() => void signInWith('apple')}
            />
          ) : (
            <Button label="Continue with Apple" onPress={() => void signInWith('apple')} disabled={busy || !socialSignInAvailable} />
          )}
          <Pressable onPress={() => void continueAsGuest()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.guest, pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              {busy ? 'One moment…' : 'Continue as a guest'}
            </ThemedText>
          </Pressable>
        </View>

        {socialSignInNote ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {socialSignInNote}
          </ThemedText>
        ) : null}
        {session.error ? (
          <ThemedText type="small" style={styles.center}>
            {session.error}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          Coins are for play only. They cannot be cashed out or transferred.
        </ThemedText>
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

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: Spacing.four, gap: Spacing.three, alignItems: 'center' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  buttons: { alignSelf: 'stretch', gap: Spacing.two },
  // At least 44 points tall (Apple's minimum touch size); the text sets the rest.
  button: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  apple: { alignSelf: 'stretch', height: 48 },
  guest: { alignItems: 'center', paddingVertical: Spacing.two },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
