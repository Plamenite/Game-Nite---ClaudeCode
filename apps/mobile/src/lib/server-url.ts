import Constants from 'expo-constants';

/** The port the Colyseus server listens on (see apps/server). */
export const SERVER_PORT = 2567;

/**
 * Where the phone should find the game server.
 *
 * 1. If EXPO_PUBLIC_SERVER_URL is set (for example to a deployed server),
 *    use it exactly.
 * 2. Otherwise, in development, reuse the address the phone is already
 *    talking to for live code updates (your PC on the Wi-Fi) and assume
 *    the game server runs there too. That is what `npm run server` does.
 */
export function getServerUrl(): string {
  const configured = process.env.EXPO_PUBLIC_SERVER_URL;
  if (configured) {
    return configured;
  }
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0] || 'localhost';
  return `ws://${host}:${SERVER_PORT}`;
}
