// Approve straight from a notification (FR-PLT-24).
//
// The link carries a one-shot key. It is deliberately **not** a credential: opening it signs
// nothing and proves nothing. The page it leads to requires a signed-in session, requires that
// session to belong to the person the token names, and then runs the owning module's ordinary
// decide action — which checks, as always, that it really is that person's turn. A forwarded email
// therefore buys an attacker nothing at all; the token only saves the approver three clicks.
//
// The token is hashed at rest, expires, and is spent the first time it is redeemed.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;
export type ApprovalActionTokenRow = typeof schema.approvalActionToken.$inferSelect;

/** Long enough that guessing is hopeless, short enough to sit in an email without wrapping. */
const TOKEN_BYTES = 32;
export const TOKEN_TTL_HOURS = 72;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * A fresh key for one person to approve one request. Returns the *path* to put in the message;
 * the token itself is never stored, only its hash.
 */
export async function issueActionToken(executor: Executor, requestId: string, personId: string, now: Date = new Date()): Promise<{ token: string; path: string }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await executor.insert(schema.approvalActionToken).values({
    requestId,
    personId,
    action: "approve",
    tokenHash: hashOf(token),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000),
  });
  return { token, path: `/approvals/act/${token}` };
}

export type TokenLookup = { ok: true; row: ApprovalActionTokenRow } | { ok: false; reason: "unknown" | "expired" | "used" };

/** What a token is worth right now. Never says *why* to anyone but the page, which says it once. */
export async function findActionToken(token: string, now: Date = new Date()): Promise<TokenLookup> {
  const hash = hashOf(token);
  const [row] = await db().select().from(schema.approvalActionToken).where(eq(schema.approvalActionToken.tokenHash, hash)).limit(1);
  // Constant-time on the hash as well: the lookup is indexed, but the comparison should not leak.
  if (!row || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, row };
}

/**
 * Spends the token. The update is the claim: two clicks on the same link race here, and exactly
 * one of them wins — so the decide action runs once even if the approver is impatient.
 */
export async function spendActionToken(tokenId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db()
    .update(schema.approvalActionToken)
    .set({ usedAt: now })
    .where(and(eq(schema.approvalActionToken.id, tokenId), isNull(schema.approvalActionToken.usedAt)))
    .returning({ id: schema.approvalActionToken.id });
  return rows.length === 1;
}

/** Tokens of a request that is no longer waiting for this person — spent so they cannot be replayed. */
export async function voidActionTokens(executor: Executor, requestId: string): Promise<void> {
  await executor.update(schema.approvalActionToken).set({ usedAt: new Date() }).where(and(eq(schema.approvalActionToken.requestId, requestId), isNull(schema.approvalActionToken.usedAt)));
}

/** Housekeeping: an expired token has nothing left to say. */
export async function purgeExpiredActionTokens(now: Date = new Date()): Promise<number> {
  const rows = await db().delete(schema.approvalActionToken).where(lt(schema.approvalActionToken.expiresAt, now)).returning({ id: schema.approvalActionToken.id });
  return rows.length;
}
