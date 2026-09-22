import {
  COURT_PIECE_VARIANTS,
  OPENING_CARD,
  cardId,
  legalPlays,
  type Card,
  type CourtPieceTableSnapshot,
} from '@gamenite/game-rules';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardFace, SUIT_GLYPH } from '@/components/card-face';
import { TEAM_COLORS } from '@/components/fiverow-board';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TEAM_NAMES = ['Team A', 'Team B'] as const;
const RESULT_LABEL: Record<string, string> = { win: 'wins the deal', kot: 'KOT!', goon_kot: 'GOON KOT!', forfeit: 'wins by forfeit' };

interface Props {
  snapshot: CourtPieceTableSnapshot;
  hand: Card[];
  mySessionId: string | null;
  clockOffset: number;
  notice: string | null;
  onPlay: (card: Card) => void;
  onRematch: () => void;
  onLeave: () => void;
}

/** What the phone considers legal; the server has the final say. */
function legalCards(snapshot: CourtPieceTableSnapshot, hand: Card[]): Card[] {
  if (snapshot.tricksPlayed === 0 && snapshot.trick.length === 0) {
    return hand.filter((c) => cardId(c) === cardId(OPENING_CARD));
  }
  const led = snapshot.trick.length > 0 ? snapshot.trick[0].card.suit : null;
  return legalPlays(hand, led);
}

export function CourtPieceTable({ snapshot, hand, mySessionId, clockOffset, notice, onPlay, onRematch, onLeave }: Props) {
  const theme = useTheme();
  const [secondsLeft, setSecondsLeft] = useState(0);

  const me = snapshot.seats.find((s) => s.sessionId === mySessionId);
  const mySeat = me?.seat ?? 0;
  const myTeam = me?.team ?? 0;
  const playing = snapshot.phase === 'playing';
  const myTurn = playing && snapshot.turnSessionId === mySessionId;

  const legal = useMemo(() => (myTurn ? new Set(legalCards(snapshot, hand).map(cardId)) : new Set<string>()), [snapshot, hand, myTurn]);

  useEffect(() => {
    if (!playing || !snapshot.turnDeadline) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((snapshot.turnDeadline + clockOffset - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [playing, snapshot.turnDeadline, clockOffset]);

  // Seats around me: play goes to the right, partner sits opposite.
  const seatAt = (offset: number) => snapshot.seats.find((s) => s.seat === (mySeat + offset) % 4);
  const positions = { bottom: seatAt(0), right: seatAt(1), top: seatAt(2), left: seatAt(3) };
  const showing = snapshot.trick.length > 0 ? snapshot.trick : snapshot.lastTrick;
  const dimmed = snapshot.trick.length === 0;
  const cardOf = (seat: number | undefined) => (seat === undefined ? undefined : showing.find((p) => p.seat === seat)?.card);
  const variantName = COURT_PIECE_VARIANTS.find((v) => v.id === snapshot.variant)?.name ?? snapshot.variant;
  const currentSeat = snapshot.seats.find((s) => s.seat === snapshot.currentSeat);

  let headline: string;
  if (snapshot.phase === 'waiting') headline = 'Waiting for players…';
  else if (snapshot.phase === 'between_deals' || snapshot.phase === 'finished') {
    const winner = snapshot.phase === 'finished' && snapshot.seriesWinner >= 0 ? snapshot.seriesWinner : snapshot.dealWinner;
    const label = snapshot.dealResult ? RESULT_LABEL[snapshot.dealResult] ?? snapshot.dealResult : '';
    headline = winner >= 0 ? `${TEAM_NAMES[winner]} ${label}${winner === myTeam ? ' · you win' : ''}` : 'Deal over';
    if (snapshot.phase === 'finished' && snapshot.bestOf > 1) headline = `${TEAM_NAMES[snapshot.seriesWinner]} wins the series`;
  } else headline = myTurn ? `Your turn · ${secondsLeft}s` : `${currentSeat?.name ?? '…'}'s turn · ${secondsLeft}s`;

  return (
    <View style={styles.wrapper}>
      <ThemedText type="subtitle">{headline}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {variantName} · deal {snapshot.dealNumber} of best of {snapshot.bestOf} · series {snapshot.score[0]}–{snapshot.score[1]}
      </ThemedText>
      <View style={styles.scoreRow}>
        <Score team={0} tricks={snapshot.collected[0]} mine={myTeam === 0} />
        <ThemedText type="small" themeColor="textSecondary">
          {snapshot.trump ? `Trump ${SUIT_GLYPH[snapshot.trump]}` : 'No trump yet'}
          {snapshot.heap > 0 ? ` · ${snapshot.heap} in the middle` : ''}
        </ThemedText>
        <Score team={1} tricks={snapshot.collected[1]} mine={myTeam === 1} />
      </View>
      {notice ? <ThemedText type="small">{notice}</ThemedText> : null}

      <ThemedView type="backgroundElement" style={styles.table}>
        <SeatSpot seat={positions.top} card={cardOf(positions.top?.seat)} dim={dimmed} current={snapshot.currentSeat} trumpSetter={snapshot.trumpSetterSeat} />
        <View style={styles.middleRow}>
          <SeatSpot seat={positions.left} card={cardOf(positions.left?.seat)} dim={dimmed} current={snapshot.currentSeat} trumpSetter={snapshot.trumpSetterSeat} />
          <ThemedText type="small" themeColor="textSecondary">
            {snapshot.tricksPlayed}/13
          </ThemedText>
          <SeatSpot seat={positions.right} card={cardOf(positions.right?.seat)} dim={dimmed} current={snapshot.currentSeat} trumpSetter={snapshot.trumpSetterSeat} />
        </View>
        <SeatSpot seat={positions.bottom} card={cardOf(positions.bottom?.seat)} dim={dimmed} current={snapshot.currentSeat} trumpSetter={snapshot.trumpSetterSeat} isMe />
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.handCard}>
        <ThemedText type="small" themeColor="textSecondary">
          {myTurn ? (snapshot.tricksPlayed === 0 && snapshot.trick.length === 0 ? 'Open with the two of clubs.' : 'Tap a highlighted card.') : 'Your hand'}
        </ThemedText>
        <View style={styles.hand}>
          {hand.map((card, i) => {
            const ok = legal.has(cardId(card));
            return (
              <Pressable key={`${cardId(card)}-${i}`} disabled={!ok} onPress={() => onPlay(card)} style={({ pressed }) => pressed && styles.pressed}>
                <CardFace card={card} dim={myTurn && !ok} highlight={ok ? TEAM_COLORS[myTeam] : undefined} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          {snapshot.phase === 'finished' && snapshot.bestOf === 1 && !me?.abandoned ? (
            <ActionButton label={me?.wantsRematch ? 'Waiting for the others…' : 'Rematch'} onPress={onRematch} />
          ) : null}
          <ActionButton label={snapshot.phase === 'finished' ? 'Back to menu' : 'Leave table'} onPress={onLeave} />
        </View>
      </ThemedView>
      <View style={{ height: Spacing.two, backgroundColor: theme.background }} />
    </View>
  );
}

function Score({ team, tricks, mine }: { team: number; tricks: number; mine: boolean }) {
  return (
    <View style={styles.score}>
      <View style={[styles.chip, { backgroundColor: TEAM_COLORS[team] }]} />
      <ThemedText type={mine ? 'smallBold' : 'small'}>
        {TEAM_NAMES[team]} {tricks}
      </ThemedText>
    </View>
  );
}

function SeatSpot({
  seat,
  card,
  dim,
  current,
  trumpSetter,
  isMe,
}: {
  seat?: CourtPieceTableSnapshot['seats'][number];
  card?: Card;
  dim: boolean;
  current: number;
  trumpSetter: number;
  isMe?: boolean;
}) {
  if (!seat) return <View style={styles.spot} />;
  const active = seat.seat === current;
  return (
    <View style={styles.spot}>
      <View style={styles.seatLabel}>
        <View style={[styles.chip, { backgroundColor: TEAM_COLORS[seat.team] }]} />
        <ThemedText type={active ? 'smallBold' : 'small'} themeColor={seat.abandoned ? 'textSecondary' : 'text'}>
          {active ? '▶ ' : ''}
          {isMe ? 'You' : seat.name}
          {seat.seat === trumpSetter ? ' ★' : ''}
          {seat.abandoned ? ' · left' : !seat.connected ? ' · …' : ''} · {seat.handCount}
        </ThemedText>
      </View>
      {card ? <CardFace card={card} size="sm" dim={dim} /> : <View style={styles.emptyCard} />}
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
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: Spacing.two },
  score: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  chip: { width: 10, height: 10, borderRadius: 5 },
  table: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, borderRadius: Spacing.four },
  middleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  spot: { alignItems: 'center', gap: Spacing.one, minWidth: 90, minHeight: 58 },
  seatLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  emptyCard: { width: 34, height: 26 },
  handCard: { alignSelf: 'stretch', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.four },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, justifyContent: 'center' },
  actions: { gap: Spacing.two },
  actionButton: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
  pressed: { opacity: 0.7 },
});
