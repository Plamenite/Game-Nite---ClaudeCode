import assert from "assert";
import { ServerError } from "colyseus";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import {
  authenticate,
  configureAuth,
  createSupabaseVerifier,
  settingsFromEnv,
  type AuthSettings,
} from "../src/auth.js";

const ISSUER = "https://example.supabase.co/auth/v1";
const ctx = {} as any;

async function expectServerError(promise: Promise<unknown>, code: number, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ServerError, "expected a ServerError");
    assert.strictEqual(error.code, code);
    assert.match(error.message, pattern);
    return true;
  });
}

describe("authenticate (Supabase tokens and dev guest tokens)", () => {
  let previous: AuthSettings;
  before(() => { previous = settingsFromEnv(); });
  after(() => configureAuth(previous));

  it("rejects an empty token", async () => {
    configureAuth({ allowGuestTokens: true, verifier: null });
    await expectServerError(authenticate("", {}, ctx), 401, /missing/);
  });

  it("accepts guest tokens only when allowed", async () => {
    configureAuth({ allowGuestTokens: true, verifier: null });
    assert.deepStrictEqual(await authenticate("guest-AB12", {}, ctx), { userId: "guest-AB12", guest: true });

    configureAuth({ allowGuestTokens: false, verifier: null });
    await expectServerError(authenticate("guest-AB12", {}, ctx), 401, /sign in/);
  });

  it("says so when login is not configured yet", async () => {
    configureAuth({ allowGuestTokens: false, verifier: null });
    await expectServerError(authenticate("eyJ.not.real", {}, ctx), 503, /not configured/);
  });

  describe("with public-key signed tokens (current Supabase projects)", () => {
    let sign: (claims: Record<string, unknown>, opts?: { expired?: boolean; audience?: string }) => Promise<string>;

    before(async () => {
      const { privateKey, publicKey } = await generateKeyPair("ES256");
      const jwk = await exportJWK(publicKey);
      jwk.kid = "test-key";
      const getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256" }] });
      configureAuth({ allowGuestTokens: false, verifier: createSupabaseVerifier(getKey, ISSUER) });

      sign = (claims, opts = {}) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: "ES256", kid: "test-key" })
          .setIssuer(ISSUER)
          .setAudience(opts.audience ?? "authenticated")
          .setIssuedAt()
          .setExpirationTime(opts.expired ? "-1m" : "1h")
          .sign(privateKey);
    });

    it("accepts a valid signed-in user", async () => {
      const token = await sign({ sub: "11111111-2222-3333-4444-555555555555", role: "authenticated" });
      assert.deepStrictEqual(await authenticate(token, {}, ctx), {
        userId: "11111111-2222-3333-4444-555555555555",
        guest: false,
      });
    });

    it("marks Supabase anonymous users as guests", async () => {
      const token = await sign({ sub: "anon-user-id", is_anonymous: true });
      assert.deepStrictEqual(await authenticate(token, {}, ctx), { userId: "anon-user-id", guest: true });
    });

    it("rejects expired, wrong-audience, tampered, and unsigned tokens", async () => {
      await expectServerError(authenticate(await sign({ sub: "u" }, { expired: true }), {}, ctx), 401, /invalid or expired/);
      await expectServerError(authenticate(await sign({ sub: "u" }, { audience: "anon" }), {}, ctx), 401, /invalid or expired/);
      const good = await sign({ sub: "u" });
      const tampered = good.slice(0, -4) + "AAAA";
      await expectServerError(authenticate(tampered, {}, ctx), 401, /invalid or expired/);
      await expectServerError(authenticate("guest.looks.legit", {}, ctx), 401, /invalid or expired/);
    });

    it("still refuses dev guest tokens when they are disabled", async () => {
      await expectServerError(authenticate("guest-ZZZZ", {}, ctx), 401, /sign in/);
    });
  });

  describe("with a shared-secret token (legacy Supabase projects)", () => {
    it("verifies HS256 tokens from settingsFromEnv", async () => {
      const secret = "super-secret-jwt-secret-for-tests-only";
      configureAuth(settingsFromEnv({ SUPABASE_URL: "https://example.supabase.co/", SUPABASE_JWT_SECRET: secret }));
      const token = await new SignJWT({ sub: "legacy-user" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience("authenticated")
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret));
      assert.deepStrictEqual(await authenticate(token, {}, ctx), { userId: "legacy-user", guest: false });
    });
  });

  it("settingsFromEnv reads the guest switch and picks a verifier only with SUPABASE_URL", () => {
    assert.strictEqual(settingsFromEnv({}).verifier, null);
    assert.strictEqual(settingsFromEnv({ ALLOW_GUEST_TOKENS: "true" }).allowGuestTokens, true);
    assert.strictEqual(settingsFromEnv({ ALLOW_GUEST_TOKENS: "yes" }).allowGuestTokens, false, "only the exact word true");
    assert.ok(settingsFromEnv({ SUPABASE_URL: "https://x.supabase.co" }).verifier, "JWKS verifier");
  });
});
