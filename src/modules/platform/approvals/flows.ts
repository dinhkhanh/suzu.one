// Flows as configuration (FR-PLT-20, 21). A request type ships a default flow in code; a row in
// `approval_flow` replaces it — for one entity, or for the whole group when `entity_id` is null.
// Requests keep a snapshot of the flow they were submitted under, so an edit never touches
// requests already on their way.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { listEntities } from "../org/service";
import { ROLE_DEFINITIONS, ROLES } from "../rbac/roles";
import { type FlowDefinition, flowProblems } from "./engine/flow";

type Executor = Tx | ReturnType<typeof db>;
export type ApprovalFlowRow = typeof schema.approvalFlow.$inferSelect;

// Permissions a flow may name: the ones some role holds by name (the owners' "*" is the fallback).
const NAMED_PERMISSIONS = [...new Set(Object.values(ROLE_DEFINITIONS).flatMap((definition) => definition.permissions))].filter((permission) => permission !== "*") as string[];

export const approverRuleSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("line_manager") }),
  z.object({ rule: z.literal("department_head") }),
  z.object({ rule: z.literal("manager_level"), level: z.coerce.number().int().min(1).max(6) }),
  z.object({ rule: z.literal("permission"), permission: z.string().refine((value) => NAMED_PERMISSIONS.includes(value)) }),
  z.object({ rule: z.literal("role"), role: z.enum(ROLES) }),
  z.object({ rule: z.literal("person"), personId: z.uuid() }),
]);

// Also used by the request builder: a form field's "shown only when…" is the same idea, so a
// designer learns one shape (approvals/engine/flow.ts).
export const conditionSchema = z.object({
  field: z.string().trim().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.union([z.string().max(200), z.number()])).max(50)]),
});

export const flowDefinitionSchema = z.object({
  steps: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
        mode: z.enum(["any", "all"]),
        approvers: z.array(approverRuleSchema).min(1).max(6),
        condition: conditionSchema.optional(),
        parallel: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const APPROVER_RULES = ["line_manager", "department_head", "manager_level", "permission", "role", "person"] as const;
export const FLOW_PERMISSIONS = NAMED_PERMISSIONS;

// The saved flows are reference data read on every request filed and every approver preview: the
// whole table sits under one key in the shared cache, in a fixed order, and callers filter it here.
// `saveFlow` and `deleteFlow` drop it once committed; the TTL bounds a write behind the app's back.
const FLOWS_KEY = "approvals:flows";
/** After a write to `approval_flow` outside this file has committed. */
export const invalidateApprovalFlows = () => invalidate(FLOWS_KEY);

/** A transaction reads its own rows; the pool itself, or no executor at all, may be answered from the cache. */
const inTransaction = (executor: Executor | undefined): executor is Executor => !!executor && executor !== db();

async function allFlows(executor?: Executor): Promise<ApprovalFlowRow[]> {
  const read = (from: Executor) => from.select().from(schema.approvalFlow).orderBy(asc(schema.approvalFlow.requestType), asc(schema.approvalFlow.id));
  return inTransaction(executor) ? read(executor) : cached(FLOWS_KEY, TTL.reference, () => read(db()));
}

/** The flow a new request of this type follows: the entity's own, else the group's, else the default in code. */
export async function effectiveFlow(executor: Executor, requestType: string, entityId: string | null, fallback: FlowDefinition): Promise<{ flow: FlowDefinition; source: "entity" | "group" | "default" }> {
  const rows = (await allFlows(executor)).filter((row) => row.requestType === requestType && row.active && (row.entityId === null || row.entityId === entityId));
  const own = rows.find((row) => row.entityId !== null);
  const chosen = own ?? rows.find((row) => row.entityId === null);
  if (!chosen) return { flow: fallback, source: "default" };
  // Saved flows were validated; a row that no longer parses (a role was removed) must not strand requests.
  const parsed = flowDefinitionSchema.safeParse(chosen.definition);
  if (!parsed.success || flowProblems(parsed.data).length > 0) return { flow: fallback, source: "default" };
  return { flow: parsed.data, source: own ? "entity" : "group" };
}

export type FlowListRow = ApprovalFlowRow & { entityName: string | null };

/** By request type, the group's flow last (Postgres sorts a null name last), the entities' by name. */
export async function listFlows(): Promise<FlowListRow[]> {
  const [flows, entities] = await Promise.all([allFlows(), listEntities()]);
  const nameOf = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const rows = flows.map((flow) => ({ ...flow, entityName: flow.entityId ? (nameOf.get(flow.entityId) ?? null) : null }));
  const byName = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, "vi"));
  return rows.sort((a, b) => (a.requestType < b.requestType ? -1 : a.requestType > b.requestType ? 1 : 0) || byName(a.entityName, b.entityName) || a.id.localeCompare(b.id));
}

export async function getFlow(id: string): Promise<ApprovalFlowRow | null> {
  return (await allFlows()).find((row) => row.id === id) ?? null;
}

export type SaveFlowInput = { requestType: string; entityId: string | null; definition: FlowDefinition; active: boolean };

/** Creates the flow for (type, entity) or replaces it. */
export async function saveFlow(input: SaveFlowInput, actorPersonId: string): Promise<{ before: ApprovalFlowRow | null; after: ApprovalFlowRow }> {
  const problems = flowProblems(input.definition);
  if (problems.length > 0) throw new ActionError(`flow_${problems[0]}`);
  const named = input.definition.steps.flatMap((step) => step.approvers.flatMap((rule) => (rule.rule === "person" ? [rule.personId] : [])));
  if (named.length > 0) {
    const found = await db().select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, named), eq(schema.person.status, "active")));
    if (found.length !== new Set(named).size) throw new ActionError("flow_person_unknown");
  }
  const saved = await db().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.approvalFlow)
      .where(and(eq(schema.approvalFlow.requestType, input.requestType), input.entityId ? eq(schema.approvalFlow.entityId, input.entityId) : isNull(schema.approvalFlow.entityId)))
      .limit(1)
      .for("update");
    const values = { definition: input.definition, active: input.active, updatedByPersonId: actorPersonId, updatedAt: new Date() };
    const [after] = before
      ? await tx.update(schema.approvalFlow).set(values).where(eq(schema.approvalFlow.id, before.id)).returning()
      : await tx.insert(schema.approvalFlow).values({ requestType: input.requestType, entityId: input.entityId, ...values }).returning();
    return { before: before ?? null, after };
  });
  await invalidateApprovalFlows();
  return saved;
}

/** Back to the default: the next request of the type follows the group flow or the one in code. */
export async function deleteFlow(id: string): Promise<ApprovalFlowRow | null> {
  const [row] = await db().delete(schema.approvalFlow).where(eq(schema.approvalFlow.id, id)).returning();
  await invalidateApprovalFlows();
  return row ?? null;
}
