const ROLE_LEVEL = { Recruiter: 1, Admin: 2, Superadmin: 3 };
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const SESSION_COOKIE = "vtd_session";
const LOGIN_NONCE_COOKIE = "vtd_login_nonce";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const jwksCache = new Map();

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readCookie(request, name) {
  const cookies = String(request.headers.get("cookie") || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return "";
}

async function hmacKey(secret, usage) {
  const value = String(secret || "");
  if (value.length < 24) throw new AuthError("Workspace sign-in is not configured", 503);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signWorkspaceToken(payload, secret) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const key = await hmacKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyWorkspaceToken(token, secret, expectedKind) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new AuthError("Sign in with your Vedantu account to continue", 401);
  const key = await hmacKey(secret, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(parts[1]),
    new TextEncoder().encode(parts[0]),
  );
  if (!valid) throw new AuthError("Your Talent Desk session is invalid", 401);

  let payload;
  try { payload = decodeJwtJson(parts[0]); }
  catch { throw new AuthError("Your Talent Desk session is invalid", 401); }
  const now = Math.floor(Date.now() / 1000);
  if (payload.kind !== expectedKind || !Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new AuthError("Your Talent Desk session has expired", 401);
  }
  return payload;
}

export function workspaceLoginUrl(request, env) {
  const connector = String(env.APPS_SCRIPT_CONNECTOR_URL || "").trim();
  if (!connector || !env.CONNECTOR_SECRET) throw new AuthError("Google Workspace sign-in is not configured", 503);
  const requestUrl = new URL(request.url);
  const nonce = crypto.randomUUID();
  const callback = `${requestUrl.origin}/auth/callback`;
  const loginUrl = new URL(connector);
  loginUrl.searchParams.set("action", "talentDeskLogin");
  loginUrl.searchParams.set("callback", callback);
  loginUrl.searchParams.set("nonce", nonce);
  return {
    loginUrl: loginUrl.toString(),
    nonceCookie: `${LOGIN_NONCE_COOKIE}=${encodeURIComponent(nonce)}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`,
  };
}

export async function completeWorkspaceLogin(request, env) {
  const url = new URL(request.url);
  const ticket = await verifyWorkspaceToken(url.searchParams.get("ticket"), env.CONNECTOR_SECRET, "login");
  const nonce = readCookie(request, LOGIN_NONCE_COOKIE);
  const email = String(ticket.email || "").trim().toLowerCase();
  if (!nonce || nonce !== ticket.nonce) throw new AuthError("This sign-in attempt has expired. Please try again.", 401);
  if (!/@vedantu\.com$/.test(email)) throw new AuthError("Use your Vedantu Google account to continue", 403);
  const now = Math.floor(Date.now() / 1000);
  const session = await signWorkspaceToken({ kind: "session", email, iat: now, exp: now + SESSION_TTL_SECONDS }, env.CONNECTOR_SECRET);
  return {
    email,
    sessionCookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    clearNonceCookie: `${LOGIN_NONCE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
  };
}

export function clearWorkspaceCookies() {
  return [
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    `${LOGIN_NONCE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
  ];
}

async function verifyWorkspaceSession(request, env) {
  const payload = await verifyWorkspaceToken(readCookie(request, SESSION_COOKIE), env.CONNECTOR_SECRET, "session");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/@vedantu\.com$/.test(email)) throw new AuthError("Use your Vedantu Google account to continue", 403);
  return email;
}

function decodeJwtJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

async function loadAccessKeys(teamDomain, forceRefresh = false) {
  const cached = jwksCache.get(teamDomain);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new AuthError("Cloudflare Access signing keys are unavailable", 503);
  const payload = await response.json();
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  jwksCache.set(teamDomain, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

async function findAccessKey(teamDomain, keyId) {
  let keys = await loadAccessKeys(teamDomain);
  let key = keys.find((candidate) => candidate.kid === keyId);
  if (!key) {
    keys = await loadAccessKeys(teamDomain, true);
    key = keys.find((candidate) => candidate.kid === keyId);
  }
  return key;
}

export async function verifyAccessJwt(token, env) {
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").trim().toLowerCase();
  const expectedAudience = String(env.ACCESS_AUD || "").trim();
  if (!teamDomain || !expectedAudience) {
    throw new AuthError("Cloudflare Access verification is not configured", 503);
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new AuthError("Sign in with your Vedantu account to continue", 401);

  let header;
  let payload;
  try {
    header = decodeJwtJson(parts[0]);
    payload = decodeJwtJson(parts[1]);
  } catch {
    throw new AuthError("Your Cloudflare Access session is invalid", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://${teamDomain}`;
  if (header.alg !== "RS256" || !header.kid || payload.iss !== expectedIssuer || !audienceMatches(payload.aud, expectedAudience)) {
    throw new AuthError("Your Cloudflare Access session is not valid for Talent Desk", 401);
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now || (Number.isFinite(payload.nbf) && payload.nbf > now + 60)) {
    throw new AuthError("Your Cloudflare Access session has expired", 401);
  }

  const jwk = await findAccessKey(teamDomain, header.kid);
  if (!jwk) throw new AuthError("Cloudflare Access signing key was not recognized", 401);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new AuthError("Your Cloudflare Access session could not be verified", 401);

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) throw new AuthError("Your Cloudflare Access session has no email address", 401);
  return { email, payload };
}

export async function authenticate(request, env) {
  const authMode = String(env.AUTH_MODE || "local").toLowerCase();
  const protectedMode = ["cloudflare-access", "apps-script-sso", "workspace-sso"].includes(authMode);
  const accessAssertion = request.headers.get("cf-access-jwt-assertion");
  const email = authMode === "cloudflare-access"
    ? (await verifyAccessJwt(accessAssertion, env)).email
    : authMode === "workspace-sso" && accessAssertion
      ? (await verifyAccessJwt(accessAssertion, env)).email
      : authMode === "apps-script-sso" || authMode === "workspace-sso"
      ? await verifyWorkspaceSession(request, env)
      : "local.admin@example.com";

  if (!email) throw new AuthError("Sign in with your Vedantu account to continue", 401);

  const user = await env.DB.prepare(
    "SELECT email, display_name, role, active FROM access_users WHERE lower(email) = ? LIMIT 1",
  ).bind(email).first();

  if (!user || !Number(user.active)) {
    if (!protectedMode && email === "local.admin@example.com") {
      return {
        email,
        displayName: "Local Admin",
        role: "Admin",
        authMode,
        protected: false,
      };
    }
    throw new AuthError("Your account has not been granted Talent Desk access", 403);
  }

  return {
    email: String(user.email).toLowerCase(),
    displayName: user.display_name,
    role: user.role,
    authMode,
    protected: protectedMode,
  };
}

export function requireRole(user, role) {
  if ((ROLE_LEVEL[user?.role] || 0) < (ROLE_LEVEL[role] || 0)) {
    throw new AuthError(`${role} access is required`, 403);
  }
}

export function canManageSources(user, env) {
  return roleAtLeast(user?.role, "Admin") && (user.protected || String(env.ALLOW_LOCAL_SOURCE_SYNC || "false") === "true");
}

export function roleAtLeast(currentRole, requiredRole) {
  return (ROLE_LEVEL[currentRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
}
