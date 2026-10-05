// The ceiling on the assistant, counted (FR-AI-06, NFR-SEC-03) — and what the assistant cost.
//
// `admitAiUse` is the first line of every action that can reach a driver: `ai.ask` and the three
// `ai.draft.*`. It counts the call in Postgres, so every instance shares the count, and refuses
// before anything is retrieved, read or sent — a refused call never reaches a driver, on any
// driver. The refusal is an `ActionError` the form puts into the reader's language, and the call
// that crossed the line is audited: once per window, not once per retry.
import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { recordAudit } from "@/modules/platform/audit/service";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { AI_LIMITS, type AiLimitScope, type AiUseKind, bucketOf, isFirstRefusal, retryAfterSeconds, windowStartFor, withinLimit } from "./engine/limits";

const { aiMessage, aiUsageHit } = schema;

export type AiUseVerdict = { ok: true } | { ok: false; scope: AiLimitScope; retryAfterSeconds: number; /** True for the one call per window that crossed the line. */ first: boolean };

const SCOPES = ["day", "burst"] as const;

/**
 * Counts one use and says whether it is allowed. Both windows are counted in the same statement —
 * one row per (bucket, person, window), `hits = hits + 1` on conflict — so it cannot race and the
 * counts it returns already include this call. A refused call is counted too: a loop that keeps
 * asking does not earn its way back in.
 */
export async function countAiUse(kind: AiUseKind, personId: string, at: Date = new Date()): Promise<AiUseVerdict> {
  const rows = await db()
    .insert(aiUsageHit)
    .values(SCOPES.map((scope) => ({ bucket: bucketOf(kind, scope), personId, windowStart: windowStartFor(at, AI_LIMITS[bucketOf(kind, scope)]), hits: 1, lastAt: at })))
    .onConflictDoUpdate({ target: [aiUsageHit.bucket, aiUsageHit.personId, aiUsageHit.windowStart], set: { hits: sql`${aiUsageHit.hits} + 1`, lastAt: at } })
    .returning({ bucket: aiUsageHit.bucket, hits: aiUsageHit.hits });
  // The day first: when both are spent, "come back tomorrow" is the true answer, not "wait a minute".
  for (const scope of SCOPES) {
    const bucket = bucketOf(kind, scope);
    const hits = rows.find((row) => row.bucket === bucket)?.hits ?? 1;
    if (!withinLimit(hits, AI_LIMITS[bucket])) return { ok: false, scope, retryAfterSeconds: retryAfterSeconds(at, AI_LIMITS[bucket]), first: isFirstRefusal(hits, AI_LIMITS[bucket]) };
  }
  return { ok: true };
}

type Asker = Pick<CurrentUser, "userId" | "email" | "request"> & { person: Pick<CurrentUser["person"], "id" | "primaryEntityId"> };

/**
 * The door. Returns when the call is inside both windows; otherwise throws `ai_limit_day` or
 * `ai_limit_burst` (message keys under `assistant.errors` and `assistant.drafts`), having written
 * the audit entry if this is the call that crossed the line. Nothing about the question or the
 * draft is kept in that entry — only that the ceiling was reached, and which one.
 */
export async function admitAiUse(user: Asker, kind: AiUseKind, at: Date = new Date()): Promise<void> {
  const verdict = await countAiUse(kind, user.person.id, at);
  if (verdict.ok) return;
  if (verdict.first) {
    const limit = AI_LIMITS[bucketOf(kind, verdict.scope)];
    await recordAudit({
      action: `ai.${kind}.limit_reached`,
      actor: { userId: user.userId, personId: user.person.id, email: user.email },
      request: user.request,
      resource: { type: "person", id: user.person.id, entityId: user.person.primaryEntityId },
      summary: `${kind} limit reached (${verdict.scope})`,
      after: { scope: verdict.scope, max: limit.max, windowSeconds: limit.windowSeconds },
    });
  }
  throw new ActionError(verdict.scope === "day" ? "ai_limit_day" : "ai_limit_burst", { retryAfterSeconds: verdict.retryAfterSeconds });
}

/** Counted windows nobody can still be inside. Swept nightly, with the assistant's other housekeeping (`kb-embeddings`). */
export async function purgeAiUsageHits(before: Date): Promise<number> {
  // The database counts what went; the rows are not read back to be counted in JS.
  const result = (await db().delete(aiUsageHit).where(lt(aiUsageHit.windowStart, before))) as { count?: number; rowCount?: number } | undefined;
  // postgres-js answers with `count`, the PGlite of the service tests with `rowCount`.
  return result?.count ?? result?.rowCount ?? 0;
}

// ── What it cost ────────────────────────────────────────────────────────────────────────────

export type UsageByDay = { day: string; answers: number; modelAnswers: number; inputTokens: number; outputTokens: number };
export type UsageByPerson = { personId: string; fullName: string; answers: number; modelAnswers: number; inputTokens: number; outputTokens: number };
export type AssistantUsage = { days: number; total: Omit<UsageByDay, "day">; byDay: UsageByDay[]; byPerson: UsageByPerson[] };

export const USAGE_DAYS = 30;

/**
 * The assistant's answers and their tokens over the last `days` days: per Vietnamese day, and per
 * person. Counted and summed in SQL — the screen totals, it never reads a message. "Model answers"
 * are those a real model wrote; the rest came from the local driver or a personal tool and cost
 * nothing. The caller checks `canReadAssistantUsage`.
 */
export async function assistantUsage(days: number = USAGE_DAYS, now: Date = new Date()): Promise<AssistantUsage> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const figures = {
    answers: sql<number>`count(*)::int`,
    modelAnswers: sql<number>`count(*) filter (where ${aiMessage.inputTokens} > 0 or ${aiMessage.outputTokens} > 0)::int`,
    // bigint → float8: a month of tokens outgrows int4 long before it troubles a double.
    inputTokens: sql<number>`coalesce(sum(${aiMessage.inputTokens}), 0)::float8`,
    outputTokens: sql<number>`coalesce(sum(${aiMessage.outputTokens}), 0)::float8`,
  };
  const answered = and(eq(aiMessage.role, "assistant"), gte(aiMessage.createdAt, since));
  const day = sql<string>`to_char(${aiMessage.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;
  const [[total], byDay, byPerson] = await Promise.all([
    db().select(figures).from(aiMessage).where(answered),
    db().select({ day, ...figures }).from(aiMessage).where(answered).groupBy(day).orderBy(desc(day)),
    db()
      .select({ personId: aiMessage.personId, fullName: schema.person.fullName, ...figures })
      .from(aiMessage)
      .innerJoin(schema.person, eq(schema.person.id, aiMessage.personId))
      .where(answered)
      .groupBy(aiMessage.personId, schema.person.fullName)
      // The dearest first; among those who cost nothing, whoever asks most.
      .orderBy(desc(sql`coalesce(sum(${aiMessage.inputTokens}), 0) + coalesce(sum(${aiMessage.outputTokens}), 0)`), desc(sql`count(*)`), schema.person.fullName, aiMessage.personId)
      .limit(100),
  ]);
  return { days, total: total ?? { answers: 0, modelAnswers: 0, inputTokens: 0, outputTokens: 0 }, byDay, byPerson };
}
