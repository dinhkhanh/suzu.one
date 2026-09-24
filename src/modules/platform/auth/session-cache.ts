// The session row and its account in the shared cache (personal tier, src/lib/cache): every
// request needs them, and they change only at sign-in, sign-out, step-up, impersonation and a
// preference change — each of which drops the entry, so revocation stays immediate (FR-PLT-05)
// without a Postgres round trip per page. The entry is named by a hash of the session token,
// never by the token; the stored session carries no token at all (`session.ts` puts the cookie's
// back), so a copy of the cache is worth nothing.
import "server-only";
import { createHash } from "node:crypto";
import { eq, type SQL } from "drizzle-orm";
import { invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;

export const sessionKey = (token: string) => `auth:session:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;

/** The token before the signature in Better Auth's session cookie (`token.signature`), unverified: it only names the entry. */
export function tokenOfCookie(cookie: string | null | undefined): string | null {
  const token = cookie?.split(".")[0];
  return token ? token : null;
}

/** After the rows behind these tokens changed or went. */
export const invalidateSessionTokens = (tokens: readonly string[]) => invalidate(...tokens.map(sessionKey));

/** After a direct write to `session` (or its `user`): drops the entries of every session matched. */
export async function invalidateSessionsWhere(where: SQL, executor: Executor = db()): Promise<void> {
  const rows = await executor.select({ token: schema.session.token }).from(schema.session).where(where);
  await invalidateSessionTokens(rows.map((row) => row.token));
}

export const invalidateSession = (sessionId: string, executor?: Executor) => invalidateSessionsWhere(eq(schema.session.id, sessionId), executor);
export const invalidateSessionsOfUser = (userId: string, executor?: Executor) => invalidateSessionsWhere(eq(schema.session.userId, userId), executor);
