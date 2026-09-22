// The pay component catalogue (FR-PAY-02) and its governance (FR-PLT-39): C&B proposes a version,
// the owner decides, approved versions of one code in one scope never overlap.
import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval } from "@/modules/platform/statutory/engine/versions";
import { checkComponentDraft, pickCatalogue } from "./engine/catalogue";

type Executor = Tx | ReturnType<typeof db>;
export type PayComponentRow = typeof schema.payComponent.$inferSelect;

export type ComponentInput = Pick<PayComponentRow, "entityId" | "code" | "name" | "nameEn" | "kind" | "category" | "source" | "taxTreatment" | "exemptCap" | "subjectToInsurance" | "proration" | "roundingRule" | "formula" | "sortOrder" | "note"> & { validFrom: IsoDate };

// The catalogue is rules, not pay, and changes a few times a year: every version of every component
// lives in the shared cache (src/lib/cache) and dates are resolved here, so an entry never depends
// on "today". Each write below drops it once committed. Inside a transaction, pass it: the rows
// come from there, not the cache.
const COMPONENTS_CACHE = "payroll:components";
const COMPONENTS_TTL = 60 * 60;
const readsCache = (executor?: Executor) => !executor || executor === db();

const readVersions = (executor: Executor) => executor.select().from(schema.payComponent).orderBy(asc(schema.payComponent.sortOrder), asc(schema.payComponent.code), desc(schema.payComponent.validFrom), desc(schema.payComponent.createdAt));

/** Every version of every component, newest first within a code. Rules, not pay: readable by anyone with a payroll role. */
export async function listComponentVersions(executor?: Executor): Promise<PayComponentRow[]> {
  return readsCache(executor) ? cached(COMPONENTS_CACHE, COMPONENTS_TTL, () => readVersions(db())) : readVersions(executor!);
}

/** The catalogue an entity's payroll uses on `date`: approved versions in force, the entity's own over the group's. */
export async function resolveCatalogue(entityId: string | null, date: IsoDate, executor?: Executor): Promise<PayComponentRow[]> {
  const approved = readsCache(executor) ? (await listComponentVersions()).filter((row) => row.status === "approved") : await executor!.select().from(schema.payComponent).where(eq(schema.payComponent.status, "approved"));
  return pickCatalogue(approved, entityId, date);
}

/**
 * The exact component versions a past run used (`CalculationContext.componentVersionIds`), in
 * catalogue order — so a recomputed month reads its lines by the rules that made them.
 */
export async function resolveCatalogueVersions(versionIds: readonly string[], executor?: Executor): Promise<PayComponentRow[]> {
  if (versionIds.length === 0) return [];
  const wanted = new Set(versionIds);
  // A version never changes once written, so the cached table answers — unless it lacks one.
  const fromCache = readsCache(executor) ? (await listComponentVersions()).filter((row) => wanted.has(row.id)) : [];
  const rows = fromCache.length === wanted.size ? fromCache : await (executor ?? db()).select().from(schema.payComponent).where(inArray(schema.payComponent.id, [...versionIds]));
  if (rows.length !== new Set(versionIds).size) throw new ActionError("component_version_missing");
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export async function proposeComponent(input: ComponentInput, actorPersonId: string): Promise<PayComponentRow> {
  const catalogue = await resolveCatalogue(input.entityId, input.validFrom);
  const problem = checkComponentDraft(input, catalogue.map((row) => row.code));
  // The formula's text is a rule, not pay, so saying where it went wrong gives nothing away.
  if (problem) throw new ActionError(`component_${problem.code}`, problem.formulaError ? { formula: { code: problem.formulaError.code, position: problem.formulaError.position, subject: problem.formulaError.subject } } : undefined);
  // A code means one thing: the same kind and source in every version, so old payslips stay readable.
  const [sibling] = await db().select().from(schema.payComponent).where(and(eq(schema.payComponent.code, input.code), eq(schema.payComponent.status, "approved"))).limit(1);
  if (sibling && (sibling.kind !== input.kind || sibling.source !== input.source)) throw new ActionError("component_kind_fixed");

  const [created] = await db().insert(schema.payComponent).values({ ...input, proposedByPersonId: actorPersonId }).returning();
  await invalidate(COMPONENTS_CACHE);
  await notify({ recipients: await listOwnerPersonIds(), kind: "payroll.rule_proposed", params: { rule: `${created.code} — ${created.name}`, validFrom: created.validFrom }, link: "/payroll/components" });
  return created;
}

/** The owner's decision (SRS D17). Approving ends the version in force the day before. */
export async function decideComponent(id: string, decision: "approve" | "reject", actorPersonId: string): Promise<{ before: PayComponentRow; after: PayComponentRow }> {
  const result = await db().transaction(async (tx) => {
    const table = schema.payComponent;
    const [before] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!before || before.status !== "proposed") throw new ActionError("proposal_not_found");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() };
    if (decision === "reject") {
      const [after] = await tx.update(table).set({ status: "rejected", ...decided }).where(eq(table.id, id)).returning();
      return { before, after };
    }
    const approved = await tx.select().from(table).where(and(eq(table.code, before.code), before.entityId ? eq(table.entityId, before.entityId) : isNull(table.entityId), eq(table.status, "approved"))).for("update");
    const plan = planApproval(approved, before.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`rule_${plan.reason}`);
    if (plan.kind === "succeed") await tx.update(table).set({ validTo: plan.closeOn, updatedAt: new Date() }).where(eq(table.id, plan.closeId));
    const [after] = await tx.update(table).set({ status: "approved", ...decided }).where(eq(table.id, id)).returning();
    return { before, after };
  });
  await invalidate(COMPONENTS_CACHE);
  return result;
}
