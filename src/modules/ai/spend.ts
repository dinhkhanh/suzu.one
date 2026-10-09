// What the assistant has spent, and whether it may spend more (SRS D35, FR-AGT-40…43).
//
// `admitModelCall` runs before every call to a model and `recordModelCall` after it; both are
// called by `gateway.ts` and by nothing else, so no driver can reach the network without being
// counted. The sums are read live from `ai_model_call` in one aggregate query — never cached: a
// stale budget is an overrun.
import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { loadViewer, type ViewerSource } from "@/modules/work/service";
import { type AiBand, type AiBudget, bandOf, budgetVerdict, crossedMonthWarning, vietnamDayStart, vietnamMonthStart } from "./engine/budget";
import { costMicroUsd, microUsdOf, type ModelUsage } from "./engine/pricing";
import type { AiNotice } from "./enums";

const { aiModelCall } = schema;

/** The ceilings as configured (D35): settings, so the owner changes them without a change of code. */
export function aiBudget(): AiBudget {
  const settings = env();
  return {
    monthMicroUsd: microUsdOf(settings.AI_MONTHLY_BUDGET_USD),
    dayMicroUsd: { everyone: microUsdOf(settings.AI_DAILY_BUDGET_USD_EVERYONE), lead: microUsdOf(settings.AI_DAILY_BUDGET_USD_LEADS), office: microUsdOf(settings.AI_DAILY_BUDGET_USD_OFFICE) },
  };
}

/** The month so far for everybody, and today so far for one person — one statement, summed in SQL. */
export async function spentSoFar(personId: string, at: Date = new Date()): Promise<{ monthMicroUsd: number; dayMicroUsd: number }> {
  const [row] = await spentSoFarQuery(personId, at);
  return { monthMicroUsd: Number(row?.monthMicroUsd ?? 0), dayMicroUsd: Number(row?.dayMicroUsd ?? 0) };
}

/** The statement behind `spentSoFar`, unrun — so a test can read the parameters it would send. */
export function spentSoFarQuery(personId: string, at: Date) {
  const month = vietnamMonthStart(at);
  const day = vietnamDayStart(at);
  return (
    db()
      .select({
        monthMicroUsd: sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}), 0)::float8`,
        // The filter is built with the column's own operators: a raw `${day}` would go to Postgres as
        // a JavaScript Date written as text, which PGlite reads and Postgres refuses.
        dayMicroUsd: sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}) filter (where ${and(eq(aiModelCall.personId, personId), gte(aiModelCall.createdAt, day))}), 0)::float8`,
      })
      .from(aiModelCall)
      // A day can begin before the month does only on the 1st, at the same instant: the month is the lower bound.
      .where(gte(aiModelCall.createdAt, month < day ? month : day))
  );
}

/** The month's spend up to `at` — the statement the 80 % warning reads, unrun. */
export function monthToDateQuery(at: Date) {
  return db()
    .select({ month: sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}), 0)::float8` })
    .from(aiModelCall)
    .where(and(gte(aiModelCall.createdAt, vietnamMonthStart(at)), lte(aiModelCall.createdAt, at)));
}

/** The band a person's daily allowance is taken from (D35). */
export async function bandOfAsker(asker: ModelAsker): Promise<AiBand> {
  const viewer = await loadViewer(asker);
  const leadsWork = [...viewer.teamRoles.values()].some((role) => role === "lead") || [...viewer.projectRoles.values()].some((role) => role === "lead" || role === "account_manager");
  return bandOf(asker.principal, leadsWork);
}

export type ModelAsker = ViewerSource;

export type { AiNotice };

export type Admission = { ok: true } | { ok: false; notice: AiNotice };

/** The door before every model call. */
export async function admitModelCall(asker: ModelAsker, at: Date = new Date()): Promise<Admission> {
  const settings = env();
  if (settings.AI_AGENT_ENABLED === "off") return { ok: false, notice: "off" };
  if (!settings.ANTHROPIC_API_KEY) return { ok: false, notice: "no_key" };
  const [spent, band] = await Promise.all([spentSoFar(asker.person.id, at), bandOfAsker(asker)]);
  const verdict = budgetVerdict(spent, band, aiBudget());
  return verdict.ok ? { ok: true } : { ok: false, notice: verdict.reason };
}

export type ModelCallRecord = { personId: string; turnId?: string | null; purpose: string; tier: string; model: string; usage: ModelUsage; stopReason: string | null };

/**
 * Writes down one call and its price. When this call carries the month across 80 % of the budget,
 * the owners are told — once: exactly one call sees the month before it below the line and the
 * month after it above. Returns what the call cost.
 */
export async function recordModelCall(record: ModelCallRecord, at: Date = new Date()): Promise<number> {
  const cost = costMicroUsd(record.model, record.usage);
  // The row keeps every cache write in one count; the hour's dearer share is in the cost.
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = record.usage;
  await db()
    .insert(aiModelCall)
    .values({
      personId: record.personId,
      turnId: record.turnId ?? null,
      purpose: record.purpose,
      tier: record.tier,
      model: record.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costMicroUsd: cost,
      stopReason: record.stopReason,
      createdAt: at,
    });
  const budget = aiBudget().monthMicroUsd;
  if (cost > 0 && budget > 0) {
    const [row] = await monthToDateQuery(at);
    const after = Number(row?.month ?? 0);
    if (crossedMonthWarning(after - cost, after, budget)) {
      const owners = await listOwnerPersonIds();
      if (owners.length) await notify({ recipients: owners, kind: "system.ai_budget_warning", params: { spent: (after / 1_000_000).toFixed(2), budget: (budget / 1_000_000).toFixed(2) }, link: "/assistant/unanswered?show=usage" });
    }
  }
  return cost;
}

// ── What it cost, for the owner's screen ───────────────────────────────────────────────────

export type SpendByModel = { model: string; tier: string; calls: number; costMicroUsd: number };
export type SpendSummary = { monthMicroUsd: number; budget: AiBudget; byModel: SpendByModel[] };

/** The month so far against the budget, and which models it went to. Counted and summed in SQL. */
export async function spendSummary(at: Date = new Date()): Promise<SpendSummary> {
  const month = vietnamMonthStart(at);
  const cost = sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}), 0)::float8`;
  const byModel = await db()
    .select({ model: aiModelCall.model, tier: aiModelCall.tier, calls: sql<number>`count(*)::int`, costMicroUsd: cost })
    .from(aiModelCall)
    .where(gte(aiModelCall.createdAt, month))
    .groupBy(aiModelCall.model, aiModelCall.tier)
    .orderBy(desc(cost), aiModelCall.model, aiModelCall.tier);
  const rows = byModel.map((row) => ({ ...row, costMicroUsd: Number(row.costMicroUsd) }));
  return { monthMicroUsd: rows.reduce((total, row) => total + row.costMicroUsd, 0), budget: aiBudget(), byModel: rows };
}

/** What each person's calls cost since `since`, keyed by person — for the usage table. */
export async function costByPersonSince(since: Date): Promise<Map<string, number>> {
  const rows = await db()
    .select({ personId: aiModelCall.personId, costMicroUsd: sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}), 0)::float8` })
    .from(aiModelCall)
    .where(and(gte(aiModelCall.createdAt, since), sql`${aiModelCall.personId} is not null`))
    .groupBy(aiModelCall.personId);
  return new Map(rows.map((row) => [row.personId as string, Number(row.costMicroUsd)]));
}

/** What the calls cost per Vietnamese day since `since`, keyed "YYYY-MM-DD" — for the usage table. */
export async function costByDaySince(since: Date): Promise<Map<string, number>> {
  const day = sql<string>`to_char(${aiModelCall.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;
  const rows = await db()
    .select({ day, costMicroUsd: sql<number>`coalesce(sum(${aiModelCall.costMicroUsd}), 0)::float8` })
    .from(aiModelCall)
    .where(gte(aiModelCall.createdAt, since))
    .groupBy(day);
  return new Map(rows.map((row) => [row.day, Number(row.costMicroUsd)]));
}
