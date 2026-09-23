import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DAILY_STREAK_MAX_DAY } from '@gamenite/game-rules';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useWallet } from '@/hooks/use-wallet';

/** Balance, the daily bonus with its login streak, and a placeholder for rewarded ads. */
export function WalletCard() {
  const { wallet, busy, error, refresh, claimDaily, tomorrowCoins } = useWallet();

  // Refresh whenever this screen comes into view (for example after a table).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">
          Coins
        </ThemedText>
        <ThemedText type="title">{wallet ? wallet.balance.toLocaleString() : '—'}</ThemedText>
      </View>
      {error ? (
        <ThemedText type="small" themeColor="textSecondary">
          {error}
        </ThemedText>
      ) : null}
      <View style={styles.actions}>
        <Action
          label={!wallet ? (error ? 'Daily bonus: server not reached' : 'Checking the daily bonus…') : wallet.dailyBonusAvailable ? `Claim daily bonus +${wallet.dailyBonusCoins}` : 'Daily bonus claimed'}
          disabled={busy || !wallet?.dailyBonusAvailable}
          onPress={() => void claimDaily()}
        />
        {wallet ? (
          <ThemedText type="small" themeColor="textSecondary">
            {streakLine(wallet.streakDay, wallet.dailyBonusAvailable, tomorrowCoins)}
          </ThemedText>
        ) : null}
        <Action label="Watch an ad for +100 (coming soon)" disabled onPress={() => undefined} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Coins are for play only. They cannot be cashed out or transferred.
      </ThemedText>
    </ThemedView>
  );
}

/** One line under the bonus button: where the streak stands and what tomorrow pays. */
function streakLine(streakDay: number, available: boolean, tomorrowCoins: number): string {
  const tomorrow = `Come back tomorrow for +${tomorrowCoins}${streakDay + 1 >= DAILY_STREAK_MAX_DAY ? ' (the max)' : ''}.`;
  if (available) {
    return streakDay <= 1 ? `Day 1 of your streak. Claim every day and the bonus grows. ${tomorrow}` : `Day ${streakDay} streak. ${tomorrow}`;
  }
  return `Day ${streakDay} streak claimed. ${tomorrow} Miss a day and it starts over.`;
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.action}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderRadius: Spacing.four },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  actions: { gap: Spacing.two },
  action: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
