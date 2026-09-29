// A project made from a won deal (CRM, FR-CRM-15): the plan the sale promised, written by this
// module inside the caller's transaction — the CRM decides what was sold (its engine/delivery.ts)
// and hands it here, so every write to a project table stays the projects module's own.
//
// What the sale sets: the project type, the fee (the one-off part of the accepted value — written
// once, at set-up; changing it afterwards stays with `pjm:commercial`, D26), the brief's objective,
// scope and client contacts, the deliverables register, the retainer's monthly scope and fee, the
// hours budget by role, and the account manager. A template's register is replaced by the sale's
// when the sale has lines: the quote is the promise.
import "server-only";
import { and, eq, inArray, isNull, notExists } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { schema, type Tx } from "@/lib/db";
import { invalidateMemberships } from "../work/service";
import type { ProjectKind } from "./engine/brief";
import { ensurePlan, type PlanRow } from "./plans";
import type { ClientContact, RetainerLineTemplate, RoleBudget } from "./schema";

export type SalePlanInput = {
  kind: Extract<ProjectKind, "client" | "retainer">;
  feeVnd: number | null;
  deliverables: RetainerLineTemplate[];
  retainer: { startMonth: string; endMonth: string | null; lines: RetainerLineTemplate[]; feePerMonthVnd: number | null; minutesPerMonth: number | null } | null;
  budgetByRole: RoleBudget[];
  brief: { objective: string; scopeIn: string; clientContacts: ClientContact[] };
  accountManagerPersonId: string | null;
  /** People who sold it and want to follow it: made viewers of the project (never more). */
  viewerPersonIds: readonly string[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Writes the sale's plan onto a project just made in `tx`. Returns the plan as it now stands. */
export async function applySalePlanIn(tx: Tx, projectId: string, sale: SalePlanInput): Promise<PlanRow> {
  const plan = await ensurePlan(projectId, tx);
  const [project] = await tx.select({ id: schema.workProject.id, clientId: schema.workProject.clientId, leadPersonId: schema.workProject.leadPersonId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project) throw new ActionError("project_not_found");

  if (sale.deliverables.length || sale.retainer?.lines.length) {
    // The template's lines give way to what was sold — only lines no task works towards yet, which
    // is every line of a project made a moment ago.
    await tx
      .delete(schema.projectDeliverable)
      .where(and(eq(schema.projectDeliverable.projectId, projectId), isNull(schema.projectDeliverable.retainerPeriodId), notExists(tx.select().from(schema.projectTaskLink).where(eq(schema.projectTaskLink.deliverableId, schema.projectDeliverable.id)))));
  }
  if (sale.deliverables.length) {
    await tx.insert(schema.projectDeliverable).values(sale.deliverables.map((line, index) => ({ projectId, title: line.title.slice(0, 200), quantity: Math.max(1, line.quantity), format: line.format, channel: line.channel, sortOrder: (index + 1) * 10 })));
  }

  if (sale.retainer) {
    if (!MONTH.test(sale.retainer.startMonth) || (sale.retainer.endMonth && (!MONTH.test(sale.retainer.endMonth) || sale.retainer.endMonth < sale.retainer.startMonth))) throw new ActionError("retainer_months_invalid");
    await tx
      .insert(schema.projectRetainer)
      .values({ projectId, clientId: project.clientId, startMonth: sale.retainer.startMonth, endMonth: sale.retainer.endMonth, lines: sale.retainer.lines, minutesPerMonth: sale.retainer.minutesPerMonth, feePerMonthVnd: sale.retainer.feePerMonthVnd, rollover: "reset", isActive: true })
      .onConflictDoNothing({ target: schema.projectRetainer.projectId });
  }

  const roles = sale.budgetByRole.filter((role) => role.role.trim() && role.minutes > 0);
  const brief = {
    ...plan.brief,
    objective: plan.brief.objective || sale.brief.objective,
    scopeIn: plan.brief.scopeIn || sale.brief.scopeIn,
    clientContacts: plan.brief.clientContacts?.length ? plan.brief.clientContacts : sale.brief.clientContacts,
  };
  await tx
    .update(schema.projectPlan)
    .set({
      kind: sale.kind,
      feeVnd: sale.feeVnd,
      brief,
      ...(roles.length ? { budgetByRole: roles, budgetMinutes: roles.reduce((sum, role) => sum + role.minutes, 0) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projectPlan.projectId, projectId));

  // People: the account manager takes the project's account-manager role (never the lead's), the
  // sellers follow it as viewers. Nobody already in the project is demoted.
  const touched: string[] = [];
  const members = await tx.select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, projectId));
  const roleOf = new Map(members.map((row) => [row.personId, row]));
  if (sale.accountManagerPersonId && sale.accountManagerPersonId !== project.leadPersonId) {
    const existing = roleOf.get(sale.accountManagerPersonId);
    if (existing) await tx.update(schema.workProjectMember).set({ role: "account_manager" }).where(eq(schema.workProjectMember.id, existing.id));
    else await tx.insert(schema.workProjectMember).values({ projectId, personId: sale.accountManagerPersonId, role: "account_manager" });
    await tx.update(schema.projectPlan).set({ accountManagerPersonId: sale.accountManagerPersonId }).where(eq(schema.projectPlan.projectId, projectId));
    touched.push(sale.accountManagerPersonId);
  }
  const viewers = [...new Set(sale.viewerPersonIds)].filter((personId) => !roleOf.has(personId) && personId !== sale.accountManagerPersonId);
  if (viewers.length) await tx.insert(schema.workProjectMember).values(viewers.map((personId) => ({ projectId, personId, role: "viewer" }))).onConflictDoNothing();
  touched.push(...viewers);
  if (touched.length) await invalidateMemberships(...touched);

  const [after] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  return after;
}

/**
 * A pitch is over when its deal is won or lost (FR-CRM-14): its project is done. Inside the caller's
 * transaction; a project already done or archived is left alone. The caller drops the work
 * directory's cache entry once the transaction commits.
 */
export async function finishPitchProjectIn(tx: Tx, projectId: string): Promise<boolean> {
  const rows = await tx
    .update(schema.workProject)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(schema.workProject.id, projectId), inArray(schema.workProject.status, ["planned", "active", "paused"])))
    .returning({ id: schema.workProject.id });
  return rows.length > 0;
}

/** A project's plan made a pitch (FR-CRM-14), inside the caller's transaction. */
export async function markPitchIn(tx: Tx, projectId: string): Promise<void> {
  await ensurePlan(projectId, tx);
  await tx.update(schema.projectPlan).set({ kind: "pitch", updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
}
