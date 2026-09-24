// Step-up re-authentication (FR-PLT-06, NFR-SEC-08): the adapter. The rules are in
// step-up-policy.ts; this file knows the session row and the two drivers.
//
//   google — a second OpenID Connect round trip to Google with `prompt=login` and `max_age=0`,
//            pinned to the signed-in address with `login_hint`. The callback exchanges the code
//            itself (the ID token then comes straight from Google over TLS) and checks issuer,
//            audience, nonce, address and `auth_time`. WRITTEN BUT NEVER RUN: it needs the real
//            OAuth client, and `${BETTER_AUTH_URL}/api/step-up/callback` added to the client's
//            authorised redirect URIs.
//   local  — a confirm button, for development machines only. `env()` refuses to start with it
//            in a production build or on Vercel (see `stepUpDriverProblem`).
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import type { CurrentUser } from "./session";
import { invalidateSession } from "./session-cache";
import { checkStepUpClaims, type IdTokenClaims, isStepUpFresh, safeNextPath } from "./step-up-policy";

export const stepUpDriver = (): "google" | "local" => env().STEP_UP_DRIVER;

/** For pages: sends the person to prove who they are, then back to `nextPath`. */
export function requireStepUp(user: CurrentUser, nextPath: string): void {
  if (!isStepUpFresh(user.reauthAt)) redirect(`/step-up?next=${encodeURIComponent(safeNextPath(nextPath))}`);
}

export async function markReauthenticated(sessionId: string, at: Date = new Date()): Promise<void> {
  await db().update(schema.session).set({ reauthAt: at }).where(eq(schema.session.id, sessionId));
  await invalidateSession(sessionId);
}

// ── Google driver ───────────────────────────────────────────────────────────────────────────

export const STEP_UP_STATE_COOKIE = "suzu.step_up";
const STATE_TTL_SECONDS = 600;

type PendingStepUp = { state: string; nonce: string; next: string; sessionId: string; expiresAt: number };

const sign = (body: string) => createHmac("sha256", env().BETTER_AUTH_SECRET).update("step-up\u0000").update(body).digest("base64url");

export function sealPendingStepUp(input: { next: string; sessionId: string }, now: Date = new Date()): { cookie: string; pending: PendingStepUp } {
  const pending: PendingStepUp = { state: randomBytes(24).toString("base64url"), nonce: randomBytes(24).toString("base64url"), next: safeNextPath(input.next), sessionId: input.sessionId, expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(pending), "utf8").toString("base64url");
  return { cookie: `${body}.${sign(body)}`, pending };
}

export function openPendingStepUp(cookie: string | undefined, now: Date = new Date()): PendingStepUp | null {
  if (!cookie) return null;
  const [body, signature, extra] = cookie.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const pending = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PendingStepUp;
    return pending.expiresAt >= Math.floor(now.getTime() / 1000) ? pending : null;
  } catch {
    return null;
  }
}

const callbackUrl = () => `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/api/step-up/callback`;

export function googleStepUpUrl(pending: PendingStepUp, email: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid email",
    state: pending.state,
    nonce: pending.nonce,
    // Ask for the password (or passkey) again, not just an account choice.
    prompt: "login",
    max_age: "0",
    login_hint: email,
  }).toString();
  return url.toString();
}

/** Exchanges the code with Google and decides whether it proves a fresh sign-in of `email`. */
export async function verifyGoogleStepUp(code: string, pending: PendingStepUp, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env().GOOGLE_CLIENT_ID, client_secret: env().GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(), grant_type: "authorization_code" }),
  });
  if (!response.ok) return { ok: false, reason: "token_exchange" };
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  const payload = idToken?.split(".")[1];
  if (!payload) return { ok: false, reason: "no_id_token" };
  let claims: IdTokenClaims;
  try {
    // The token came from Google's token endpoint over TLS, authenticated with the client secret,
    // so its signature adds nothing (OpenID Connect Core §3.1.3.7); the claims are checked below.
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IdTokenClaims;
  } catch {
    return { ok: false, reason: "bad_id_token" };
  }
  return checkStepUpClaims(claims, { clientId: env().GOOGLE_CLIENT_ID, email, nonce: pending.nonce });
}
