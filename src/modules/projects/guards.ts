// The project layer's guards on what the work module does to a project (FR-PJM-03, 59), registered
// with the platform beside the tables (`schema.ts`) because work cannot import this module — and
// the scope lock the plan's own writers ask (FR-PJM-11). The rules are the pure engine's
// (`engine/gates.ts`); this file reads the facts they need, inside the caller's transaction.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { schema, type Tx } from "@/lib/db";
import type { ProjectStatusGuard, ProjectWorkGuard } from "@/modules/platform/project-guards/registry";
import { type GateFacts, type MonthlyQuota, monthlyQuotaChanged, restoredStatus, scopeLocked, statusRefusal } from "./engine/gates";

type Executor = Tx;

/** The plan's side of a project, read without making the plan: no row yet = the defaults a plan starts with. */
export async function gateFacts(tx: Executor, projectId: string): Promise<GateFacts | null> {
  const [row] = await tx
    .select({ clientId: schema.workProject.clientId, kind: schema.projectPlan.kind, briefStatus: schema.projectPlan.briefStatus, closedAt: schema.projectPlan.closedAt })
    .from(schema.workProject)
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
    .where(eq(schema.workProject.id, projectId))
    .limit(1);
  if (!row) return null;
  return { kind: row.kind ?? (row.clientId ? "client" : "internal"), briefApproved: row.briefStatus === "approved", closed: !!row.closedAt };
}

/**
 * Before the work module changes a project's status category. By hand: refused past the kick-off
 * gate, past the close-out and out of a closed project. Out of the archive: the project returns
 * closed if it was closed, planned if it has no approved brief, active otherwise.
 */
export const projectStatusGuard: ProjectStatusGuard = async (tx, change) => {
  const facts = await gateFacts(tx as Executor, change.projectId);
  if (!facts) return null;
  if (change.restoring) return { to: restoredStatus(facts) };
  const reason = statusRefusal(facts, change);
  return reason ? { refusal: { reason } } : null;
};

/** A closed project is read-only for work too: no new task, no state change, no time, until it is re-opened. */
export const projectWorkGuard: ProjectWorkGuard = async (tx, work) => {
  const [plan] = await (tx as Executor).select({ closedAt: schema.projectPlan.closedAt }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, work.projectId)).limit(1);
  return plan?.closedAt ? { reason: "project_closed", details: { action: work.action } } : null;
};

// ── The scope lock ──────────────────────────────────────────────────────────────────────────

/** Thrown by a direct edit of scope, hours or fee after the kick-off: the screen points to a change request. */
export const scopeLockedError = (what: "register" | "budget" | "fee" | "retainer") => new ActionError("scope_locked", { what });

/**
 * For the retainer's terms (`saveRetainer`): after the kick-off, once the retainer exists, its
 * monthly quota — the lines, the hours allowance, the monthly fee — changes through a change
 * request (`ChangeImpact.retainer`), not by saving the terms. The months it runs, the rollover rule
 * and the active switch stay direct. `before` null = the terms are being set for the first time.
 */
export function assertRetainerQuotaOpen(plan: { briefStatus: string }, before: MonthlyQuota | null, after: MonthlyQuota): void {
  if (before && scopeLocked(plan) && monthlyQuotaChanged(before, after)) throw scopeLockedError("retainer");
}
