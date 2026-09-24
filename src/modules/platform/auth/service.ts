import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { type Preferences, preferencesOf } from "./preferences";
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

const PREFERENCE_COLUMNS = { locale: schema.user.locale, theme: schema.user.theme };

/**
 * Changes the language or the theme on an account (owner's decision 2026-09-24). Only the keys
 * given change; the rest stay as they were. Returns both states for the audit entry.
 */
export async function updatePreferences(userId: string, changes: Partial<Preferences>): Promise<{ before: Preferences; after: Preferences }> {
  const [current] = await db().select(PREFERENCE_COLUMNS).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  const [updated] = await db().update(schema.user).set({ ...changes, updatedAt: new Date() }).where(eq(schema.user.id, userId)).returning(PREFERENCE_COLUMNS);
  return { before: preferencesOf(current), after: preferencesOf(updated) };
}
