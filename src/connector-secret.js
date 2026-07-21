const VAULT_SETTING_KEY = "connector_secret_ciphertext_v1";
const CACHE_TTL_MS = 30 * 1000;
const secretCache = new WeakMap();

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function vaultKey(rootSecret, usage) {
  const secret = String(rootSecret || "");
  if (secret.length < 24) throw new Error("The connector vault key is not configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [usage]);
}

export async function encryptConnectorSecret(secret, rootSecret) {
  const value = String(secret || "");
  if (value.length < 32 || value.length > 256) throw new Error("Use a connector key between 32 and 256 characters");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(rootSecret, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return JSON.stringify({
    version: 1,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  });
}

export async function decryptConnectorSecret(encryptedValue, rootSecret) {
  const payload = JSON.parse(String(encryptedValue || "{}"));
  if (payload.version !== 1 || !payload.iv || !payload.ciphertext) throw new Error("The connector vault entry is invalid");
  const key = await vaultKey(rootSecret, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(payload.iv) },
    key,
    decodeBase64Url(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function getConnectorSecret(env) {
  const cached = secretCache.get(env);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let encryptedValue = "";
  if (env.DB?.prepare) {
    const statement = env.DB.prepare("SELECT value FROM workspace_settings WHERE key='connector_secret_ciphertext_v1'");
    if (typeof statement?.first === "function") {
      const row = await statement.first();
      encryptedValue = String(row?.value || "");
    }
  }

  const value = encryptedValue
    ? await decryptConnectorSecret(encryptedValue, env.CONNECTOR_SECRET)
    : String(env.CONNECTOR_SECRET || "");
  if (!value) throw new Error("The Google connector is not configured");
  secretCache.set(env, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function storeConnectorSecret(env, secret, updatedBy = "") {
  if (!env.DB?.prepare) throw new Error("The Talent Desk database is not configured");
  const encryptedValue = await encryptConnectorSecret(secret, env.CONNECTOR_SECRET);
  await env.DB.prepare(`INSERT INTO workspace_settings(key, value, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
    .bind(VAULT_SETTING_KEY, encryptedValue, String(updatedBy || "").slice(0, 320)).run();
  secretCache.delete(env);
}
