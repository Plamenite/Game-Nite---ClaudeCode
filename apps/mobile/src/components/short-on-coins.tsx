import { shortfallFromMessage } from '@gamenite/game-rules';

import { ThemedText } from '@/components/themed-text';

/** Turns "You need 500 coins... You have 300." into a way forward. */
export function ShortOnCoins({ message }: { message: string | null | undefined }) {
  const short = shortfallFromMessage(message);
  if (short === null) return null;
  return (
    <ThemedText type="small">
      You are {short.toLocaleString()} coins short for that table. Claim today's bonus in the wallet above, or pick a smaller table.
    </ThemedText>
  );
}
