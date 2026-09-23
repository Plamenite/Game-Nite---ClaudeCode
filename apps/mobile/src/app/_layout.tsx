// Must stay the first import: engine features some libraries expect.
import '@/lib/polyfills';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { SignInScreen } from '@/components/sign-in-screen';
import { restoreSession } from '@/lib/auth';
import { useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

/** The gate: restore the last session, show sign-in until there is one, then the tabs. */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const session = useSession();
  useEffect(() => {
    void restoreSession();
  }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {session.status === 'ready' ? <AppTabs /> : session.status === 'signed_out' ? <SignInScreen /> : null}
    </ThemeProvider>
  );
}
