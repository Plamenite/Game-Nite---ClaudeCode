import {
  FIVEROW_BOARD,
  FIVEROW_BOARD_SIZE,
  FREE_SPACE,
  NO_CHIP,
  boardFromSnapshot,
  cardFromCellId,
  cardId,
  isDeadCard,
  isOneEyedJack,
  isTwoEyedJack,
  movesForCard,
  type Card,
  type FiveRowMove,
  type FiveRowTableSnapshot,
} from '@gamenite/game-rules';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Team chip colours: blue, red, green. */
export const TEAM_COLORS = ['#2F80ED', '#EB5757', '#27AE60'] as const;

const SUIT_GLYPH: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RED_SUITS = new Set<Card['suit']>(['hearts', 'diamonds']);

interface Props {
  snapshot: FiveRowTableSnapshot;
  hand: Card[];
  mySessionId: string | null;
  clockOffset: number;
  notice: string | null;
  onMove: (move: FiveRowMove) => void;
  onPass: () => void;
  onLeave: () => void;
}

export function FiveRowBoard({ snapshot, hand, mySessionId, clockOffset, notice, onMove, onPass, onLeave }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<Card | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const me = snapshot.seats.find((s) => s.sessionId === mySessionId);
  const myTeam = me?.team ?? 0;
  const myTurn = snapshot.phase === 'playing' && snapshot.turnSessionId === mySessionId;
  const board = useMemo(() => boardFromSnapshot(snapshot), [snapshot]);

  // Legal targets for the selected card, computed locally for highlighting.
  const targets = useMemo(() => {
    if (!selected || !myTurn) return new Map<number, FiveRowMove>();
    const map = new Map<number, FiveRowMove>();
    for (const move of movesForCard(board, selected, myTeam)) map.set(move.cell, move);
    return map;
  }, [board, selected, myTurn, myTeam]);

  const selectedIsDead = selected ? isDeadCard(board, selected) : false;
  const canSwapDead = myTurn && selectedIsDead && !snapshot.exchangedThisTurn;
  const hasAnyMove = useMemo(() => {
    if (!myTurn) return false;
    return hand.some((c) => movesForCard(board, c, myTeam).length > 0 || (isDeadCard(board, c) && !snapshot.exchangedThisTurn));
  }, [board, hand, myTeam, myTurn, snapshot.exchangedThisTurn]);

  // Turn countdown from the server's deadline.
  useEffect(() => {
    if (snapshot.phase !== 'playing' || !snapshot.turnDeadline) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((snapshot.turnDeadline + clockOffset - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [snapshot.phase, snapshot.turnDeadline, clockOffset]);

  // Drop the selection when it is no longer my turn or the card left my hand.
  useEffect(() => {
    if (!myTurn) setSelected(null);
    else if (selected && !hand.some((c) => cardId(c) === cardId(selected))) setSelected(null);
  }, [myTurn, hand, selected]);

  const cellSize = Math.floor(Math.min(width - Spacing.four * 2, 420) / FIVEROW_BOARD_SIZE);
  const turnSeat = snapshot.seats.find((s) => s.sessionId === snapshot.turnSessionId);

  let headline: string;
  if (snapshot.phase === 'waiting') headline = 'Waiting for players…';
  else if (snapshot.phase === 'finished') headline = snapshot.winnerTeam === NO_CHIP ? 'Draw' : snapshot.winnerTeam === myTeam ? 'You win!' : `Team ${snapshot.winnerTeam + 1} wins`;
  else headline = myTurn ? `Your turn · ${secondsLeft}s` : `${turnSeat?.name ?? '…'}'s turn · ${secondsLeft}s`;

  return (
    <View style={styles.wrapper}>
      <ThemedText type="subtitle">{headline}</ThemedText>
      <View style={styles.seats}>
        {snapshot.seats.map((seat) => (
          <View key={seat.sessionId} style={styles.seat}>
            <View style={[styles.chipSmall, { backgroundColor: TEAM_COLORS[seat.team] }]} />
            <ThemedText type="small" themeColor={seat.abandoned ? 'textSecondary' : 'text'}>
              {seat.name}
              {seat.sessionId === mySessionId ? ' (you)' : ''}
              {seat.abandoned ? ' · left' : !seat.connected ? ' · reconnecting' : ''} · {seat.handCount}
            </ThemedText>
          </View>
        ))}
      </View>
      {notice ? <ThemedText type="small">{notice}</ThemedText> : null}

      <View style={[styles.grid, { width: cellSize * FIVEROW_BOARD_SIZE }]}>
        {FIVEROW_BOARD.map((cell, index) => {
          const chip = snapshot.chips[index];
          const locked = snapshot.locked[index];
          const target = targets.get(index);
          const isFree = cell === FREE_SPACE;
          const card = isFree ? null : cardFromCellId(cell);
          return (
            <Pressable
              key={index}
              disabled={!target}
              onPress={() => {
                if (target) {
                  onMove(target);
                  setSelected(null);
                }
              }}
              style={[
                styles.cell,
                { width: cellSize, height: cellSize, borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement },
                target && { borderColor: TEAM_COLORS[myTeam], borderWidth: 2, backgroundColor: theme.backgroundSelected },
              ]}>
              {isFree ? (
                <Text style={[styles.cellText, { color: theme.textSecondary, fontSize: cellSize * 0.4 }]}>★</Text>
              ) : (
                <Text style={[styles.cellText, { color: card && RED_SUITS.has(card.suit) ? '#D63031' : theme.text, fontSize: cellSize * 0.3 }]}>
                  {card?.rank}
                  {card ? SUIT_GLYPH[card.suit] : ''}
                </Text>
              )}
              {chip !== NO_CHIP ? (
                <View
                  style={[
                    styles.chip,
                    { width: cellSize * 0.62, height: cellSize * 0.62, borderRadius: cellSize, backgroundColor: TEAM_COLORS[chip] },
                    locked && styles.chipLocked,
                    target?.kind === 'remove' && styles.chipRemovable,
                  ]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <ThemedView type="backgroundElement" style={styles.handCard}>
        <ThemedText type="small" themeColor="textSecondary">
          {myTurn ? (selected ? (selectedIsDead ? 'Dead card: both spaces are taken.' : isOneEyedJack(selected) ? 'One-eyed Jack: tap an opponent chip to remove it.' : isTwoEyedJack(selected) ? 'Two-eyed Jack: tap any open space.' : 'Tap a highlighted space.') : 'Pick a card.') : 'Your hand'}
        </ThemedText>
        <View style={styles.hand}>
          {hand.map((card, i) => {
            const isSelected = selected !== null && cardId(card) === cardId(selected) && i === hand.findIndex((c) => cardId(c) === cardId(selected));
            const dead = isDeadCard(board, card);
            return (
              <Pressable
                key={`${cardId(card)}-${i}`}
                disabled={!myTurn}
                onPress={() => setSelected(isSelected ? null : card)}
                style={[
                  styles.handCardFace,
                  { borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                  isSelected && { borderColor: TEAM_COLORS[myTeam], borderWidth: 2 },
                  dead && styles.deadCard,
                ]}>
                <Text style={[styles.handText, { color: RED_SUITS.has(card.suit) ? '#D63031' : theme.text }]}>
                  {card.rank}
                  {SUIT_GLYPH[card.suit]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          {canSwapDead && selected ? (
            <ActionButton label="Swap dead card" onPress={() => { onMove({ kind: 'exchangeDead', card: selected }); setSelected(null); }} />
          ) : null}
          {myTurn && !hasAnyMove ? <ActionButton label="No moves: pass" onPress={onPass} /> : null}
          <ActionButton label={snapshot.phase === 'finished' ? 'Back to menu' : 'Leave table'} onPress={onLeave} />
        </View>
      </ThemedView>
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundSelected" style={styles.actionButton}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.two },
  seats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.three },
  seat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  chipSmall: { width: 10, height: 10, borderRadius: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  cellText: { fontWeight: '600' },
  chip: { position: 'absolute', opacity: 0.92 },
  chipLocked: { borderWidth: 2, borderColor: '#FFFFFF' },
  chipRemovable: { opacity: 0.5, borderWidth: 2, borderColor: '#000000' },
  handCard: { alignSelf: 'stretch', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.four },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, justifyContent: 'center' },
  handCardFace: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderRadius: Spacing.two, borderWidth: 1, minWidth: 40, alignItems: 'center' },
  handText: { fontSize: 16, fontWeight: '700' },
  deadCard: { opacity: 0.45 },
  actions: { gap: Spacing.two },
  actionButton: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
});
