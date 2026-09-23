import { voiceUidFor, type LoungeMemberSnapshot } from '@gamenite/game-rules';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { toggleMuted, useVoice } from '@/lib/voice';

/**
 * The voice strip: my mic button, and for each other person a mic state,
 * a speaking dot, and mute-for-me. Shown in the lounge and above the
 * table, because the lounge's channel carries into the match.
 */
export function VoiceBar({ members, mySessionId, onMic }: { members: LoungeMemberSnapshot[]; mySessionId: string | null; onMic: (on: boolean) => void }) {
  const voice = useVoice();
  const me = members.find((m) => m.sessionId === mySessionId);
  const others = members.filter((m) => m.sessionId !== mySessionId);
  const micOn = Boolean(me?.mic);

  return (
    <ThemedView type="backgroundElement" style={styles.bar}>
      <View style={styles.row}>
        <Pressable onPress={() => onMic(!micOn)} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type={micOn ? 'backgroundSelected' : 'background'} style={styles.mic}>
            <ThemedText type="smallBold">{micOn ? '🎙 Mic on' : '🎙 Mic off'}</ThemedText>
          </ThemedView>
        </Pressable>
        <View style={styles.people}>
          {others.map((m) => {
            const uid = voiceUidFor(m.playerCode);
            const speaking = voice.speaking.includes(uid);
            const muted = voice.muted.includes(m.playerCode);
            return (
              <Pressable key={m.sessionId} onPress={() => void toggleMuted(m.playerCode, uid)} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="background" style={[styles.person, speaking && !muted && styles.speaking]}>
                  <ThemedText type="small">
                    {muted ? '🔇 ' : m.mic ? '🎙 ' : ''}
                    {m.name}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {voice.available ? 'Tap a name to mute them for yourself.' : 'Voice audio arrives with the Agora account; the controls already work. Tap a name to mute them for yourself.'}
      </ThemedText>
      {voice.notice ? <ThemedText type="small">{voice.notice}</ThemedText> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  bar: { alignSelf: 'stretch', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  mic: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, flex: 1 },
  person: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.three, borderWidth: 2, borderColor: 'transparent' },
  speaking: { borderColor: '#34C759' },
  pressed: { opacity: 0.7 },
});
