const ROLE_LEVEL = { Recruiter: 1, Admin: 2 };

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function authenticate(request, env) {
  const authMode = String(env.AUTH_MODE || "pilot").toLowerCase();
  const protectedMode = authMode === "cloudflare-access";
  const email = protectedMode
    ? String(request.headers.get("cf-access-authenticated-user-email") || "").trim().toLowerCase()
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
