import { StyleSheet, Text, View } from 'react-native';
import type { Card } from '@gamenite/game-rules';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const SUIT_GLYPH: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RED_SUITS = new Set<Card['suit']>(['hearts', 'diamonds']);

/** A small playing-card face. Shared by every card game screen. */
export function CardFace({ card, size = 'md', dim, highlight }: { card: Card; size?: 'sm' | 'md'; dim?: boolean; highlight?: string }) {
  const theme = useTheme();
  const red = RED_SUITS.has(card.suit);
  return (
    <View
      style={[
        styles.face,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: theme.background, borderColor: highlight ?? theme.backgroundSelected, borderWidth: highlight ? 2 : 1 },
        dim && styles.dim,
      ]}>
      <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: red ? '#D63031' : theme.text }]}>
        {card.rank}
        {SUIT_GLYPH[card.suit]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center', borderRadius: Spacing.two },
  md: { minWidth: 42, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  sm: { minWidth: 34, paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
  text: { fontWeight: '700' },
  textMd: { fontSize: 16 },
  textSm: { fontSize: 13 },
  dim: { opacity: 0.4 },
});
