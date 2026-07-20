const ROLE_LEVEL = { Recruiter: 1, Admin: 2 };
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
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
  const authMode = String(env.AUTH_MODE || "pilot").toLowerCase();
  const protectedMode = authMode === "cloudflare-access";
  const email = protectedMode
    ? (await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), env)).email
    : "pilot.admin@example.com";

  if (!email) throw new AuthError("Sign in with your Vedantu account to continue", 401);

  const user = await env.DB.prepare(
    "SELECT email, display_name, role, active FROM access_users WHERE lower(email) = ? LIMIT 1",
  ).bind(email).first();

  if (!user || !Number(user.active)) {
    if (!protectedMode && email === "pilot.admin@example.com") {
      return {
        email,
        displayName: "Pilot Admin",
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
  return user?.role === "Admin" && (user.protected || String(env.ALLOW_PILOT_SOURCE_SYNC || "false") === "true");
}

export function roleAtLeast(currentRole, requiredRole) {
  return (ROLE_LEVEL[currentRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
}
