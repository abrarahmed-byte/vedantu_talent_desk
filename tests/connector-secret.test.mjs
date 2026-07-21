import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { decryptConnectorSecret, encryptConnectorSecret, getConnectorSecret, storeConnectorSecret } from "../src/connector-secret.js";

globalThis.crypto ||= webcrypto;

function memoryEnv(rootSecret) {
  let stored = null;
  return {
    CONNECTOR_SECRET: rootSecret,
    DB: {
      prepare(sql) {
        if (sql.startsWith("SELECT value")) return { first: async () => stored };
        return {
          bind(_key, value) {
            return { run: async () => { stored = { value }; } };
          },
        };
      },
    },
    storedValue() { return stored?.value || ""; },
  };
}

test("connector secrets encrypt and decrypt without storing plaintext", async () => {
  const root = "root-secret-that-is-long-enough-for-the-vault";
  const secret = "rotated-connector-secret-that-remains-private";
  const encrypted = await encryptConnectorSecret(secret, root);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(await decryptConnectorSecret(encrypted, root), secret);
});

test("the encrypted database override becomes the effective connector secret", async () => {
  const env = memoryEnv("existing-cloudflare-secret-used-only-as-vault-key");
  assert.equal(await getConnectorSecret(env), env.CONNECTOR_SECRET);
  const rotated = "new-google-connector-secret-with-sufficient-length";
  await storeConnectorSecret(env, rotated, "superadmin@vedantu.com");
  assert.equal(env.storedValue().includes(rotated), false);
  assert.equal(await getConnectorSecret(env), rotated);
});
