// Signing a demo person in without Google: the suite writes the `user` and `session` rows Better
// Auth would have written after the OAuth round trip, and hands the browser the signed cookie.
// Everything after the cookie is the app's own: `getCurrentUser` reads the session, finds the
// person by email, refuses a suspended or unknown one, and loads their grants.
//
// What this skips — Google's hosted-domain claim and the allow-list on sign-in — is the sign-in
// policy, which `sign-in-policy.test.ts` covers case by case.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { WELCOME_LATER_COOKIE } from "../../src/modules/platform/shell/welcome";
import { sql } from "./db";

/** Better Auth's cookie on plain http (on https it carries the `__Secure-` prefix). */
const COOKIE = "better-auth.session_token";

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("e2e: BETTER_AUTH_SECRET is not set — the cookie must be signed with the server's secret");
  return value;
}

/** `token.signature`, URL-encoded — what Better Auth's `signCookieValue` writes. */
export function signedCookie(token: string): string {
  const signature = createHmac("sha256", secret()).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export type SignInOptions = {
  /** Proved who they are just now (FR-PLT-06): compensation screens and payroll actions open without the Google round trip. */
  steppedUp?: boolean;
  /**
   * Shows the first-sign-in guide. Off by default: the guide is a modal that opens for anyone who
   * has not finished it — every demo person — and would sit over the page a journey clicks on. It
   * is put off the way its own "Later" button does, with a cookie naming this session.
   */
  welcome?: boolean;
};

/**
 * Signs `email` in on `context`: an account for the address (English, so the suite reads one
 * language), a fresh session, and its cookie. Returns the session id.
 */
export async function signIn(context: BrowserContext, email: string, options: SignInOptions = {}): Promise<string> {
  const db = sql();
  const domain = email.split("@")[1] ?? "";
  const [account] = await db<{ id: string }[]>`
    insert into "user" (id, name, email, email_verified, hosted_domain, locale)
    values (${randomUUID()}, ${email}, ${email}, true, ${domain}, 'en')
    on conflict (email) do update set locale = 'en'
    returning id`;
  const token = randomBytes(24).toString("base64url");
  const sessionId = randomUUID();
  await db`
    insert into session (id, token, user_id, expires_at, ip_address, user_agent, reauth_at)
    values (${sessionId}, ${token}, ${account.id}, now() + interval '1 day', '127.0.0.1', 'playwright', ${options.steppedUp ? new Date() : null})`;
  await context.addCookies([
    { name: COOKIE, value: signedCookie(token), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ...(options.welcome ? [] : [{ name: WELCOME_LATER_COOKIE, value: sessionId, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" as const }]),
  ]);
  return sessionId;
}
