import { ServerError, type AuthContext } from "colyseus";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";

/** What every room learns about a connected player. */
export interface PlayerAuth {
  /** Supabase user id (a UUID), or the guest token in development. */
  userId: string;
  /** True for Supabase anonymous users and for development guest tokens. */
  guest: boolean;
  /** The name on the login account (Facebook, Google, Apple), if the token carries one. */
  name?: string;
}

/**
 * DECIDED: a new player's display name is imported from the login account.
 * Supabase copies the provider's profile into the token's user_metadata.
 */
export function nameFromClaims(claims: Record<string, unknown>): string | undefined {
  const meta = claims.user_metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const m = meta as Record<string, unknown>;
  for (const key of ["full_name", "name", "preferred_username", "user_name"]) {
    const value = m[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** A function that turns a raw token into a verified identity, or throws. */
export type TokenVerifier = (token: string) => Promise<PlayerAuth>;

export interface AuthSettings {
  /**
   * Accept the app's temporary "guest-XXXX" tokens. ONLY for development
   * before login exists. Production must keep this off.
   */
  allowGuestTokens: boolean;
  /** Verifies real Supabase session tokens. Null until login is configured. */
  verifier: TokenVerifier | null;
  /** True when the verifier uses the project's legacy shared secret (HS256). */
  usesSharedSecret?: boolean;
}

/**
 * Build a verifier for Supabase access tokens.
 *
 * Supabase signs tokens with a project key. New projects use public-key
 * signing, published at <SUPABASE_URL>/auth/v1/.well-known/jwks.json;
 * older projects use a shared secret. `getKey` abstracts both, so tests
 * can pass a local key.
 */
export function createSupabaseVerifier(getKey: JWTVerifyGetKey, issuer: string): TokenVerifier {
  return async (token) => {
    const { payload } = await jwtVerify(token, getKey, { issuer, audience: "authenticated" });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new Error("token has no subject");
    }
    const name = nameFromClaims(payload as Record<string, unknown>);
    return { userId: payload.sub, guest: payload.is_anonymous === true, ...(name ? { name } : {}) };
  };
}

/** Read the settings from environment variables (see .env.development). */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): AuthSettings {
  const url = env.SUPABASE_URL?.replace(/\/+$/, "");
  const secret = env.SUPABASE_JWT_SECRET;

  let verifier: TokenVerifier | null = null;
  if (url && secret) {
    // Legacy projects: shared HS256 secret.
    const key = new TextEncoder().encode(secret);
    verifier = createSupabaseVerifier(() => Promise.resolve(key), `${url}/auth/v1`);
  } else if (url) {
    // Current projects: public keys fetched (and cached) from the project.
    const jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    verifier = createSupabaseVerifier(jwks, `${url}/auth/v1`);
  }

  return {
    allowGuestTokens: env.ALLOW_GUEST_TOKENS === "true",
    verifier,
    usesSharedSecret: Boolean(url && secret),
  };
}

let settings: AuthSettings | null = null;

/**
 * Settings are read on first use, not at import time, because the server
 * loads .env.development / .env.production when it starts listening,
 * which happens after this module is imported.
 */
function currentSettings(): AuthSettings {
  return settings ?? (settings = settingsFromEnv());
}

/** Tests and future admin tooling can swap the settings at runtime. */
export function configureAuth(next: AuthSettings) {
  settings = next;
}

const GUEST_PREFIX = "guest-";

/**
 * Shared by every room. Runs at matchmaking time, before a seat is taken.
 * Throwing rejects the join; the return value becomes `client.auth`.
 */
export async function authenticate(token: string, _options: unknown, _context: AuthContext): Promise<PlayerAuth> {
  if (!token) {
    throw new ServerError(401, "missing auth token");
  }

  const settings = currentSettings();

  if (token.startsWith(GUEST_PREFIX)) {
    if (!settings.allowGuestTokens) {
      throw new ServerError(401, "guest tokens are not accepted here; please sign in");
    }
    return { userId: token, guest: true };
  }

  if (!settings.verifier) {
    throw new ServerError(503, "sign-in is not configured on this server yet");
  }

  try {
    return await settings.verifier(token);
  } catch {
    // A token signed with the legacy shared secret cannot be checked against
    // the project's public keys. Say so, instead of "invalid session".
    if (!settings.usesSharedSecret && algorithmOf(token) === "HS256") {
      throw new ServerError(
        503,
        "this Supabase project still signs tokens with its legacy JWT secret: in Supabase open Project Settings > JWT Keys and migrate to signing keys, or set SUPABASE_JWT_SECRET on the server",
      );
    }
    throw new ServerError(401, "your session is invalid or expired; please sign in again");
  }
}

function algorithmOf(token: string): string | undefined {
  try {
    return decodeProtectedHeader(token).alg;
  } catch {
    return undefined;
  }
}
