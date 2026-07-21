import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  AuthError,
  authenticate,
  completeWorkspaceLogin,
  roleAtLeast,
  signWorkspaceToken,
  verifyAccessJwt,
  verifyWorkspaceToken,
  workspaceLoginUrl,
} from "../src/auth.js";

globalThis.crypto ||= webcrypto;

function encodeBase64Url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function createAccessFixture(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const payload = encodeBase64Url({
    aud: ["talent-desk-aud"],
    email: "abrar.ahmed@vedantu.com",
    exp: now + 300,
    nbf: now - 30,
    iss: "https://vedantu-test.cloudflareaccess.com",
    ...overrides,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return { token: `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`, publicJwk };
}

test("Admin includes Recruiter permissions", () => {
  assert.equal(roleAtLeast("Admin", "Recruiter"), true);
  assert.equal(roleAtLeast("Admin", "Admin"), true);
});

test("Recruiter cannot perform Admin actions", () => {
  assert.equal(roleAtLeast("Recruiter", "Admin"), false);
  assert.equal(roleAtLeast("Recruiter", "Recruiter"), true);
});

test("Superadmin inherits Admin access without granting Admin master access", () => {
  assert.equal(roleAtLeast("Superadmin", "Admin"), true);
  assert.equal(roleAtLeast("Superadmin", "Recruiter"), true);
  assert.equal(roleAtLeast("Admin", "Superadmin"), false);
});

test("Cloudflare Access JWT is verified before its email is trusted", async (context) => {
  const fixture = await createAccessFixture();
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), { status: 200 }));
  const verified = await verifyAccessJwt(fixture.token, {
    ACCESS_TEAM_DOMAIN: "vedantu-test.cloudflareaccess.com",
    ACCESS_AUD: "talent-desk-aud",
  });
  assert.equal(verified.email, "abrar.ahmed@vedantu.com");
});

test("Cloudflare Access JWT with the wrong audience is rejected", async (context) => {
  const fixture = await createAccessFixture();
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), { status: 200 }));
  await assert.rejects(
    verifyAccessJwt(fixture.token, {
      ACCESS_TEAM_DOMAIN: "vedantu-test.cloudflareaccess.com",
      ACCESS_AUD: "another-app",
    }),
    (error) => error instanceof AuthError && error.status === 401,
  );
});

test("Apps Script login tickets create a signed Talent Desk session", async () => {
  const secret = "test-connector-secret-that-is-long-enough";
  const request = new Request("https://talent.example/auth/login");
  const start = workspaceLoginUrl(request, {
    APPS_SCRIPT_CONNECTOR_URL: "https://script.google.com/macros/s/example/exec",
    CONNECTOR_SECRET: secret,
  });
  const loginUrl = new URL(start.loginUrl);
  const nonce = loginUrl.searchParams.get("nonce");
  assert.equal(loginUrl.pathname, "/a/macros/vedantu.com/s/example/exec");
  assert.equal(loginUrl.searchParams.get("action"), "talentDeskLogin");
  assert.equal(loginUrl.searchParams.get("callback"), "https://talent.example/auth/callback");

  const ticket = await signWorkspaceToken({
    kind: "login",
    email: "recruiter@vedantu.com",
    nonce,
    exp: Math.floor(Date.now() / 1000) + 300,
  }, secret);
  const callback = new Request(`https://talent.example/auth/callback?ticket=${encodeURIComponent(ticket)}`, {
    headers: { cookie: `vtd_login_nonce=${encodeURIComponent(nonce)}` },
  });
  const completed = await completeWorkspaceLogin(callback, { CONNECTOR_SECRET: secret });
  assert.equal(completed.email, "recruiter@vedantu.com");
  const sessionValue = decodeURIComponent(completed.sessionCookie.match(/^vtd_session=([^;]+)/)[1]);
  const session = await verifyWorkspaceToken(sessionValue, secret, "session");
  assert.equal(session.email, "recruiter@vedantu.com");
});

test("Apps Script sessions still require an active Talent Desk user", async () => {
  const secret = "test-connector-secret-that-is-long-enough";
  const token = await signWorkspaceToken({
    kind: "session",
    email: "recruiter@vedantu.com",
    exp: Math.floor(Date.now() / 1000) + 300,
  }, secret);
  const env = {
    AUTH_MODE: "workspace-sso",
    CONNECTOR_SECRET: secret,
    DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => ({ email: "recruiter@vedantu.com", display_name: "Recruiter", role: "Recruiter", active: 1 }) };
          },
        };
      },
    },
  };
  const user = await authenticate(new Request("https://talent.example/api/session", {
    headers: { cookie: `vtd_session=${encodeURIComponent(token)}` },
  }), env);
  assert.deepEqual(user, {
    email: "recruiter@vedantu.com",
    displayName: "Recruiter",
    role: "Recruiter",
    authMode: "workspace-sso",
    protected: true,
  });
});

test("Apps Script tickets reject a mismatched browser nonce", async () => {
  const secret = "test-connector-secret-that-is-long-enough";
  const ticket = await signWorkspaceToken({
    kind: "login",
    email: "recruiter@vedantu.com",
    nonce: "expected-nonce",
    exp: Math.floor(Date.now() / 1000) + 300,
  }, secret);
  await assert.rejects(
    completeWorkspaceLogin(new Request(`https://talent.example/auth/callback?ticket=${encodeURIComponent(ticket)}`, {
      headers: { cookie: "vtd_login_nonce=another-nonce" },
    }), { CONNECTOR_SECRET: secret }),
    (error) => error instanceof AuthError && error.status === 401,
  );
});
