import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOUNGE_CODE_ALPHABET, ME_ROUTE, type MeSnapshot } from '@gamenite/game-rules';
import type { User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { getClient, setAuthToken } from '@/lib/colyseus';
import { getSession, patchSession, resetSession, type SignInProvider } from '@/lib/session';
import { getSupabase, supabaseConfigured } from '@/lib/supabase';

/**
 * Sign-in flows. DECIDED: Facebook, Google, Apple, then guest. A new
 * player's name is imported from the login account; a guest starts as
 * "Player 12345"; everyone can change it in the You tab.
 *
 * Before the Supabase account exists, only "Continue as guest" works, with
 * a development guest token the server accepts when ALLOW_GUEST_TOKENS is
 * on. The token is kept on the phone so a guest keeps their coins and
 * lounge code between launches.
 */

const GUEST_TOKEN_KEY = 'gamenite.guestToken';
/** Where the browser sends us back after Facebook/Google/Apple: gamenite://auth/callback. */
const redirectTo = Linking.createURL('auth/callback');
let listening = false;

WebBrowser.maybeCompleteAuthSession();

/**
 * Expo Go is Expo's shared test app. It cannot receive the sign-in return
 * address (gamenite://...) and lacks Apple's native button, so Facebook,
 * Google and Apple only work in Gamenite's own builds. Guests work in both.
 */
export const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const socialSignInAvailable = supabaseConfigured && !inExpoGo;

/** Why the Facebook, Google and Apple buttons are off, or null when they work. */
export const socialSignInNote: string | null = !supabaseConfigured
  ? 'Facebook, Google and Apple sign-in switch on once the accounts exist. Guests keep their coins on this phone.'
  : inExpoGo
    ? 'In Expo Go, play as a guest. Facebook, Google and Apple sign-in work in the Gamenite test build.'
    : null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function providerOf(user: User): SignInProvider {
  if (user.is_anonymous) return 'guest';
  const provider = user.app_metadata?.provider;
  return provider === 'facebook' || provider === 'google' || provider === 'apple' ? provider : 'google';
}

/** Point the game server client at this token and learn who we are. */
async function becomeReady(token: string, provider: SignInProvider, guest: boolean) {
  setAuthToken(token);
  patchSession({ status: 'ready', token, provider, guest, busy: false, error: null });
  try {
    const me = (await getClient().http.get(ME_ROUTE)).data as MeSnapshot;
    patchSession({ name: me.name, playerCode: me.playerCode });
  } catch (e) {
    // The lounge screen retries; the session is still valid.
    patchSession({ error: `Could not reach the game server. ${message(e)}` });
  }
}

/** On app start: pick up where we left off, or show the sign-in screen. */
export async function restoreSession() {
  patchSession({ status: 'loading', error: null });
  try {
    const supabase = getSupabase();
    if (supabase) {
      if (!listening) {
        listening = true;
        // Supabase refreshes tokens in the background; keep the game server client current.
        supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token && getSession().status === 'ready') {
            setAuthToken(session.access_token);
            patchSession({ token: session.access_token });
          }
        });
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await becomeReady(data.session.access_token, providerOf(data.session.user), Boolean(data.session.user.is_anonymous));
      } else {
        resetSession('signed_out');
      }
      return;
    }
    const stored = await AsyncStorage.getItem(GUEST_TOKEN_KEY);
    if (stored) await becomeReady(stored, 'guest', true);
    else resetSession('signed_out');
  } catch (e) {
    resetSession('signed_out', message(e));
  }
}

function newDevGuestToken(): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += LOUNGE_CODE_ALPHABET[Math.floor(Math.random() * LOUNGE_CODE_ALPHABET.length)];
  return `guest-${suffix}`;
}

/** Play without an account. Coins and lounge code stay with this phone. */
export async function continueAsGuest() {
  patchSession({ busy: true, error: null });
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      if (!data.session) throw new Error('no session');
      await becomeReady(data.session.access_token, 'guest', true);
      return;
    }
    const token = (await AsyncStorage.getItem(GUEST_TOKEN_KEY)) ?? newDevGuestToken();
    await AsyncStorage.setItem(GUEST_TOKEN_KEY, token);
    await becomeReady(token, 'guest', true);
  } catch (e) {
    patchSession({ busy: false, error: message(e) });
  }
}

/**
 * Sign in with Facebook, Google or Apple. A guest who signs in keeps their
 * coins: the account is linked to the anonymous user instead of replacing it.
 */
export async function signInWith(provider: Exclude<SignInProvider, 'guest'>) {
  const supabase = getSupabase();
  if (!supabase || !socialSignInAvailable) {
    patchSession({ error: socialSignInNote });
    return;
  }
  patchSession({ busy: true, error: null });
  try {
    const upgrading = getSession().status === 'ready' && getSession().guest;

    if (provider === 'apple' && Platform.OS === 'ios' && !upgrading && (await AppleAuthentication.isAvailableAsync())) {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) throw new Error('Apple did not return a token');
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
      if (error) throw error;
      if (!data.session) throw new Error('no session');
      await becomeReady(data.session.access_token, 'apple', false);
      // Apple shares the name only on the first sign-in, so keep it now.
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
      if (fullName) await setName(fullName).catch(() => {});
      return;
    }

    // Facebook, Google (and Apple outside iOS, or when upgrading a guest): the browser flow.
    const options = { redirectTo, skipBrowserRedirect: true };
    const { data, error } = upgrading
      ? await supabase.auth.linkIdentity({ provider, options })
      : await supabase.auth.signInWithOAuth({ provider, options });
    if (error) throw error;
    if (!data.url) throw new Error('no sign-in page');
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') {
      patchSession({ busy: false });
      return; // cancelled
    }
    const params = new URL(result.url).searchParams;
    const failure = params.get('error_description') ?? params.get('error');
    if (failure) throw new Error(failure);
    const code = params.get('code');
    if (!code) throw new Error('the sign-in page returned no code');
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw exchanged.error;
    await becomeReady(exchanged.data.session.access_token, provider, false);
  } catch (e) {
    const cancelled = typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ERR_REQUEST_CANCELED';
    patchSession({ busy: false, error: cancelled ? null : message(e) });
  }
}

/** Change what other players see (2 to 16 letters, digits, spaces). */
export async function setName(name: string) {
  const me = (await getClient().http.post(ME_ROUTE, { body: { name } })).data as MeSnapshot;
  patchSession({ name: me.name });
}

export async function signOut() {
  patchSession({ busy: true, error: null });
  try {
    await getSupabase()?.auth.signOut();
    await AsyncStorage.removeItem(GUEST_TOKEN_KEY);
  } finally {
    setAuthToken(null);
    resetSession('signed_out');
  }
}
