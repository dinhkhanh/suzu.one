import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { normalizeEmail } from "./sign-in-policy";

/**
 * Signs a person out everywhere by deleting their database sessions (ADR-03). `getCurrentUser`
 * already refuses an offboarded person on their next request; this also removes the rows, so a
 * copied cookie is worth nothing even if the person's status is ever changed back.
 */
export async function revokeSessionsOf(email: string | null, executor: Tx | ReturnType<typeof db> = db()): Promise<number> {
  if (!email) return 0;
  const users = await executor.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, normalizeEmail(email)));
  if (users.length === 0) return 0;
  const removed = await executor.delete(schema.session).where(inArray(schema.session.userId, users.map((user) => user.id))).returning({ id: schema.session.id });
  return removed.length;
}
