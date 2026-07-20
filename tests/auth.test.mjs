import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { AuthError, roleAtLeast, verifyAccessJwt } from "../src/auth.js";

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
