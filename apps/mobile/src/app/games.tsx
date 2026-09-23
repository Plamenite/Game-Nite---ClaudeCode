import { HOW_TO_PLAY, type HowToPlay } from '@gamenite/game-rules';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

/** The catalogue, with "How to play" for each game. The text lives in the shared rules package. */
export default function GamesScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <AnimatedIcon />
            <ThemedText type="title" style={styles.center}>
              Gamenite
            </ThemedText>
            <ThemedText type="small" style={styles.center}>
              Board and card nights with friends, anywhere.
            </ThemedText>
          </View>

          {HOW_TO_PLAY.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}

          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            Pick a game from your lounge: gather friends, tap Ready, and the leader starts.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function GameCard({ game }: { game: HowToPlay }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(0);
  const current = game.sections[section];

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="subtitle">{game.name}</ThemedText>
      <ThemedText type="small">{game.tagline}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {game.players}
      </ThemedText>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="backgroundSelected" style={styles.button}>
          <ThemedText type="smallBold">{open ? 'Hide the rules' : 'How to play'}</ThemedText>
        </ThemedView>
      </Pressable>

      {open ? (
        <>
          <View style={styles.tabs}>
            {game.sections.map((s, i) => (
              <Pressable key={s.heading} onPress={() => setSection(i)} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type={i === section ? 'backgroundSelected' : 'background'} style={styles.tab}>
                  <ThemedText type={i === section ? 'smallBold' : 'small'}>{s.heading}</ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </View>
          <View style={styles.lines}>
            {current.lines.map((line) => (
              <ThemedText key={line} type="small">
                {'• '}
                {line}
              </ThemedText>
            ))}
          </View>
        </>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.three, alignItems: 'center' },
  scroll: { alignSelf: 'stretch' },
  scrollContent: { alignItems: 'center', gap: Spacing.three, paddingBottom: Spacing.five },
  hero: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  card: { alignSelf: 'stretch', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderRadius: Spacing.four },
  button: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  tab: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.three },
  lines: { gap: Spacing.one },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
