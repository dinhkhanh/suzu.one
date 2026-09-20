// Step-up re-authentication (FR-PLT-06, NFR-SEC-08): the pure rules. No I/O.
//
// A session carries `reauth_at` — when its holder last proved who they are (sign-in, or the
// step-up round trip). Compensation screens and payroll actions ask for a recent one.

/** How long a proof of identity opens the compensation screens. Company practice, not law. */
export const STEP_UP_WINDOW_MINUTES = 15;

export function isStepUpFresh(reauthAt: Date | null | undefined, now: Date = new Date(), windowMinutes: number = STEP_UP_WINDOW_MINUTES): boolean {
  if (!reauthAt || Number.isNaN(reauthAt.getTime())) return false;
  const age = now.getTime() - reauthAt.getTime();
  // A timestamp from the future is a broken clock or a forged row, not a fresh proof.
  return age >= -60_000 && age <= windowMinutes * 60_000;
}

/** Only in-app paths survive the round trip: no scheme, no host, no protocol-relative address. */
export function safeNextPath(next: string | null | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  if (next.startsWith("/step-up") || next.startsWith("/api/")) return fallback;
  return next;
}

export type IdTokenClaims = { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; email?: unknown; email_verified?: unknown; nonce?: unknown; auth_time?: unknown };

/**
 * Is this ID token, fetched from Google's token endpoint a moment ago, proof that the session's
 * holder just signed in again? `auth_time` is what `max_age` asks for; when Google leaves it out
 * the token's own issue time has to do (the round trip was forced with `prompt=login`).
 */
export function checkStepUpClaims(claims: IdTokenClaims, expected: { clientId: string; email: string; nonce: string }, now: Date = new Date(), maxAgeSeconds = 300): { ok: true } | { ok: false; reason: string } {
  const seconds = Math.floor(now.getTime() / 1000);
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return { ok: false, reason: "issuer" };
  if (claims.aud !== expected.clientId) return { ok: false, reason: "audience" };
  if (typeof claims.exp !== "number" || claims.exp < seconds) return { ok: false, reason: "expired" };
  if (claims.nonce !== expected.nonce) return { ok: false, reason: "nonce" };
  if (typeof claims.email !== "string" || claims.email.toLowerCase() !== expected.email.toLowerCase() || claims.email_verified !== true) return { ok: false, reason: "different_account" };
  const provedAt = typeof claims.auth_time === "number" ? claims.auth_time : typeof claims.iat === "number" ? claims.iat : null;
  if (provedAt === null || seconds - provedAt > maxAgeSeconds || provedAt - seconds > 60) return { ok: false, reason: "not_recent" };
  return { ok: true };
}
