// Acceptance — biên bản nghiệm thu (FR-PJM-55) — per client-facing milestone, per retainer month
// or for the whole project. The record snapshots the register (promised / delivered / accepted,
// with the delivery and publish links), the paper is generated from the document template library
// (`TM-NGHIEM-THU`, rendered with the documents engine and the entity's letterhead), and the life
// is draft → sent → signed (the signed scan, date and signer attached) → or void before signing.
//
// Signing hands finance a billing item (FR-PJM-56) in the same transaction: a billing milestone's
// or a retainer month's own item — made now if it was not yet — with the acceptance attached, or,
// for the whole project, the fee not yet billed by milestones and months.
import "server-only";
import { and, asc, desc, eq, max, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type LetterheadFields, renderTemplate } from "../documents/service";
import { notify } from "../platform/notifications/service";
import { attachAcceptance, billMilestone, ensureBillingItem, financeOf, lockFee } from "./billing";
import { adapterLineLinks } from "./delivery-adapter";
import { acceptanceItems, acceptanceItemsText, type AcceptanceAction, acceptanceNext, acceptanceNumber, type AcceptanceScope, type AcceptanceStatus, acceptanceTotals, linesInScope, projectFeeLeft, type ScopedLine } from "./engine/acceptance";
import type { BillingStatus } from "./engine/acceptance";
import { withLineStatus } from "./metrics";
import { ensurePlan, readPlan } from "./plans";
import { feeOfPeriod, retainerMonthLabel } from "./retainers";
import { ACCEPTANCE_TEMPLATE_BODY, ACCEPTANCE_TEMPLATE_CODE } from "./seed";

export type AcceptanceRow = typeof schema.projectAcceptance.$inferSelect;

export const findAcceptance = async (acceptanceId: string): Promise<AcceptanceRow | undefined> => (await db().select().from(schema.projectAcceptance).where(eq(schema.projectAcceptance.id, acceptanceId)).limit(1))[0];

async function lockAcceptance(tx: Tx, acceptanceId: string): Promise<AcceptanceRow> {
  const [row] = await tx.select().from(schema.projectAcceptance).where(eq(schema.projectAcceptance.id, acceptanceId)).limit(1).for("update");
  if (!row) throw new ActionError("acceptance_not_found");
  return row;
}

// ── The snapshot ────────────────────────────────────────────────────────────────────────────

/** Every register line of the project, retainer months included, as the scope rule reads them. */
async function scopedLines(projectId: string): Promise<ScopedLine[]> {
  const lines = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, projectId)).orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt));
  return (await withLineStatus(lines)).map((line) => ({ id: line.id, title: line.title, milestoneId: line.milestoneId, retainerPeriodId: line.retainerPeriodId, cancelled: line.status === "cancelled", promised: line.promised, counts: line.counts, accepted: line.accepted }));
}

export type AcceptanceTarget = { scope: AcceptanceScope; milestoneId: string | null; retainerPeriodId: string | null };

/** The target must be this project's: a client-facing milestone, or one of its retainer's months. */
async function checkTarget(tx: Tx | ReturnType<typeof db>, projectId: string, target: AcceptanceTarget): Promise<AcceptanceTarget> {
  if (target.scope === "milestone") {
    const [milestone] = target.milestoneId ? await tx.select().from(schema.projectMilestone).where(eq(schema.projectMilestone.id, target.milestoneId)).limit(1) : [];
    if (milestone?.projectId !== projectId) throw new ActionError("milestone_not_found");
    if (!milestone.isClientFacing) throw new ActionError("acceptance_milestone_internal");
    return { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null };
  }
  if (target.scope === "retainer_period") {
    const [period] = target.retainerPeriodId
      ? await tx.select({ id: schema.projectRetainerPeriod.id, projectId: schema.projectRetainer.projectId }).from(schema.projectRetainerPeriod).innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId)).where(eq(schema.projectRetainerPeriod.id, target.retainerPeriodId)).limit(1)
      : [];
    if (period?.projectId !== projectId) throw new ActionError("retainer_period_not_found");
    return { scope: "retainer_period", milestoneId: null, retainerPeriodId: period.id };
  }
  return { scope: "project", milestoneId: null, retainerPeriodId: null };
}

async function snapshot(projectId: string, target: AcceptanceTarget) {
  const lines = linesInScope(await scopedLines(projectId), target.scope, target);
  const links = await adapterLineLinks(lines.map((line) => line.id));
  return acceptanceItems(lines, links);
}

/** A new record, numbered per project under the plan's lock, with the register as it stands now. */
export async function createAcceptance(projectId: string, input: AcceptanceTarget, actorPersonId: string): Promise<AcceptanceRow> {
  await ensurePlan(projectId);
  // The snapshot is a reading of the register, taken before the numbering transaction opens.
  const target = await checkTarget(db(), projectId, input);
  const items = await snapshot(projectId, target);
  if (items.length === 0) throw new ActionError("acceptance_empty");
  return db().transaction(async (tx) => {
    await tx.select({ id: schema.projectPlan.projectId }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).for("update");
    // One whole-project record at a time (void it to start again): two of them would each bill
    // "the fee not yet billed", and the client would be invoiced the remainder twice.
    if (target.scope === "project") {
      const [open] = await tx.select({ id: schema.projectAcceptance.id }).from(schema.projectAcceptance).where(and(eq(schema.projectAcceptance.projectId, projectId), eq(schema.projectAcceptance.scope, "project"), ne(schema.projectAcceptance.status, "void"))).limit(1);
      if (open) throw new ActionError("acceptance_project_exists");
    }
    const [top] = await tx.select({ value: max(schema.projectAcceptance.number) }).from(schema.projectAcceptance).where(eq(schema.projectAcceptance.projectId, projectId));
    const [row] = await tx
      .insert(schema.projectAcceptance)
      .values({ projectId, number: (top?.value ?? 0) + 1, ...target, items, createdByPersonId: actorPersonId })
      .returning();
    return row;
  });
}

/** A draft taken again from the register — the work moved on since it was made. Sent or signed papers do not change. */
export async function refreshAcceptance(acceptanceId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  const found = await findAcceptance(acceptanceId);
  if (!found) throw new ActionError("acceptance_not_found");
  const items = await snapshot(found.projectId, { scope: found.scope as AcceptanceScope, milestoneId: found.milestoneId, retainerPeriodId: found.retainerPeriodId });
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    if (before.status !== "draft") throw new ActionError("acceptance_locked");
    const [after] = await tx.update(schema.projectAcceptance).set({ items, updatedAt: new Date() }).where(eq(schema.projectAcceptance.id, acceptanceId)).returning();
    return { before, after };
  });
}

// ── Its life ────────────────────────────────────────────────────────────────────────────────

async function move(tx: Tx, row: AcceptanceRow, action: AcceptanceAction, values: Partial<typeof schema.projectAcceptance.$inferInsert> = {}): Promise<AcceptanceRow> {
  const next = acceptanceNext(row.status as AcceptanceStatus, action);
  if (!next) throw new ActionError("acceptance_wrong_status");
  const [after] = await tx
    .update(schema.projectAcceptance)
    .set({ ...values, status: next, updatedAt: new Date() })
    .where(eq(schema.projectAcceptance.id, row.id))
    .returning();
  return after;
}

export async function sendAcceptance(acceptanceId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    return { before, after: await move(tx, before, "send", { sentAt: new Date() }) };
  });
}

export async function voidAcceptance(acceptanceId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    return { before, after: await move(tx, before, "void") };
  });
}

export type Signature = { signedFileId: string; signedOn: IsoDate; signedByClient: string };

/** The billing item the signature earns, made or found, with this acceptance attached. */
async function billSigned(tx: Tx, row: AcceptanceRow, number: string, actorPersonId: string): Promise<string | null> {
  if (row.scope === "milestone" && row.milestoneId) {
    const [milestone] = await tx.select().from(schema.projectMilestone).where(eq(schema.projectMilestone.id, row.milestoneId)).limit(1);
    if (milestone?.isBilling) {
      // Nothing when a whole-project acceptance billed the fee already (`billMilestone`).
      const billed = await billMilestone(tx, milestone, actorPersonId);
      if (billed) await attachAcceptance(tx, billed.item.id, row.id);
      return billed?.item.id ?? null;
    }
    // A client-facing milestone that is not a billing one still ends in a signature finance should
    // know about: an item without an amount, which finance prices at invoicing or waives.
    return (await ensureBillingItem(tx, { projectId: row.projectId, source: "acceptance", acceptanceId: row.id, milestoneId: milestone?.id ?? null, description: `${number} · ${milestone?.name ?? ""}`, reference: number, amountVnd: null, createdByPersonId: actorPersonId })).item.id;
  }
  if (row.scope === "retainer_period" && row.retainerPeriodId) {
    const period = await feeOfPeriod(tx, row.retainerPeriodId);
    const { item } = await ensureBillingItem(tx, { projectId: row.projectId, source: "retainer", retainerPeriodId: row.retainerPeriodId, description: retainerMonthLabel(period?.month ?? ""), amountVnd: period?.feeVnd ?? null, createdByPersonId: actorPersonId });
    await attachAcceptance(tx, item.id, row.id);
    return item.id;
  }
  // The remainder is read under the plan's lock, which a milestone billing at the same moment waits for.
  await lockFee(tx, row.projectId);
  const [plan] = await tx.select({ feeVnd: schema.projectPlan.feeVnd }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, row.projectId)).limit(1);
  const billed = await tx.select({ amountVnd: schema.projectBillingItem.amountVnd, status: schema.projectBillingItem.status }).from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, row.projectId));
  const amountVnd = projectFeeLeft(plan?.feeVnd ?? null, billed.map((item) => ({ amountVnd: item.amountVnd, status: item.status as BillingStatus })));
  return (await ensureBillingItem(tx, { projectId: row.projectId, source: "acceptance", acceptanceId: row.id, description: number, reference: number, amountVnd, createdByPersonId: actorPersonId })).item.id;
}

/**
 * The client signed: the scan, the date and who signed are recorded, finance gets its item, and
 * the lead, the account manager and finance of the entity hear it — all in one transaction.
 */
export async function signAcceptance(acceptanceId: string, signature: Signature, actorPersonId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow; billingItemId: string | null }> {
  if (signature.signedOn > todayInVietnam()) throw new ActionError("acceptance_signed_in_future");
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    const after = await move(tx, before, "sign", { signedFileId: signature.signedFileId, signedOn: signature.signedOn, signedByClient: signature.signedByClient });
    const [project] = await tx.select({ name: schema.workProject.name, entityId: schema.workProject.entityId }).from(schema.workProject).where(eq(schema.workProject.id, after.projectId)).limit(1);
    const plan = await ensurePlan(after.projectId, tx);
    const number = acceptanceNumber(plan.jobNumber, after.number);
    const billingItemId = await billSigned(tx, after, number, actorPersonId);
    const leads = await tx.select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, after.projectId), eq(schema.workProjectMember.role, "lead")));
    const recipients = [...new Set([...leads.map((row) => row.personId), plan.accountManagerPersonId, ...(await financeOf(tx, project?.entityId ?? null))].filter((id): id is string => !!id && id !== actorPersonId))];
    await notify({ recipients, kind: "projects.acceptance_signed", params: { number, project: project?.name ?? "" }, link: `/projects/${after.projectId}/acceptance` }, tx);
    return { before, after, billingItemId };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type AcceptanceView = AcceptanceRow & { code: string; targetName: string | null; totals: ReturnType<typeof acceptanceTotals>; authorName: string | null };

/** A project's acceptance records, newest first. Nothing on them is money. */
export async function listAcceptances(projectId: string): Promise<AcceptanceView[]> {
  const plan = (await readPlan(projectId)) ?? { jobNumber: null };
  const rows = await db()
    .select({ acceptance: schema.projectAcceptance, milestoneName: schema.projectMilestone.name, month: schema.projectRetainerPeriod.month, authorName: schema.person.fullName })
    .from(schema.projectAcceptance)
    .leftJoin(schema.projectMilestone, eq(schema.projectMilestone.id, schema.projectAcceptance.milestoneId))
    .leftJoin(schema.projectRetainerPeriod, eq(schema.projectRetainerPeriod.id, schema.projectAcceptance.retainerPeriodId))
    .leftJoin(schema.person, eq(schema.person.id, schema.projectAcceptance.createdByPersonId))
    .where(eq(schema.projectAcceptance.projectId, projectId))
    .orderBy(desc(schema.projectAcceptance.number));
  return rows.map(({ acceptance, milestoneName, month, authorName }) => ({ ...acceptance, code: acceptanceNumber(plan.jobNumber, acceptance.number), targetName: milestoneName ?? month ?? null, totals: acceptanceTotals(acceptance.items), authorName }));
}

/** Signed milestones and months, for the page to say what is left to accept. */
export async function signedTargets(projectId: string): Promise<{ milestoneIds: Set<string>; periodIds: Set<string> }> {
  const rows = await db().select({ milestoneId: schema.projectAcceptance.milestoneId, retainerPeriodId: schema.projectAcceptance.retainerPeriodId }).from(schema.projectAcceptance).where(and(eq(schema.projectAcceptance.projectId, projectId), ne(schema.projectAcceptance.status, "void")));
  return { milestoneIds: new Set(rows.flatMap((row) => (row.milestoneId ? [row.milestoneId] : []))), periodIds: new Set(rows.flatMap((row) => (row.retainerPeriodId ? [row.retainerPeriodId] : []))) };
}

// ── The paper ───────────────────────────────────────────────────────────────────────────────

export type AcceptanceWords = { /** What to call the paper when the template library has no name for it. */ title: string; scope: Record<AcceptanceScope, string>; promised: string; delivered: string; accepted: string; totals: (totals: { promised: number; delivered: number; accepted: number }) => string };
export type AcceptanceDocument = { title: string; number: string; text: string; missing: string[]; letterhead: LetterheadFields };

const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");

/**
 * The biên bản as text on the entity's letterhead, from the library's `TM-NGHIEM-THU` (or, before
 * the seed has run, the same starter wording). The caller has checked the reader may open the
 * project. The entity's own name, address, tax code and representative win over the template's.
 */
export async function acceptanceDocument(acceptance: AcceptanceRow, words: AcceptanceWords): Promise<AcceptanceDocument> {
  // A record exists only under a plan that was made for it (`createAcceptance`); the fallback is for type safety.
  const plan = (await readPlan(acceptance.projectId)) ?? { jobNumber: null };
  const [[project], [template]] = await Promise.all([
    db()
      .select({ name: schema.workProject.name, clientName: schema.workClient.name, entity: schema.entity })
      .from(schema.workProject)
      .leftJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
      .leftJoin(schema.entity, eq(schema.entity.id, schema.workProject.entityId))
      .where(eq(schema.workProject.id, acceptance.projectId))
      .limit(1),
    db().select().from(schema.documentTemplate).where(and(eq(schema.documentTemplate.code, ACCEPTANCE_TEMPLATE_CODE), eq(schema.documentTemplate.isActive, true))).limit(1),
  ]);
  const entity = project?.entity;
  const own = Object.fromEntries(Object.entries({ companyName: entity?.legalName, address: entity?.address, taxCode: entity?.taxCode, representative: entity?.legalRepresentative }).filter(([, value]) => !!value)) as LetterheadFields;
  const letterhead: LetterheadFields = { ...(template?.letterhead ?? {}), ...own };
  const number = acceptanceNumber(plan.jobNumber, acceptance.number);
  const [target] = acceptance.milestoneId
    ? await db().select({ name: schema.projectMilestone.name }).from(schema.projectMilestone).where(eq(schema.projectMilestone.id, acceptance.milestoneId)).limit(1)
    : acceptance.retainerPeriodId
      ? await db().select({ name: schema.projectRetainerPeriod.month }).from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.id, acceptance.retainerPeriodId)).limit(1)
      : [undefined];
  const context: Record<string, string> = {
    "company.name": letterhead.companyName ?? "",
    "company.address": letterhead.address ?? "",
    "company.taxCode": letterhead.taxCode ?? "",
    "company.phone": letterhead.phone ?? "",
    "company.representative": letterhead.representative ?? "",
    "company.representativeTitle": letterhead.representativeTitle ?? "",
    "document.number": number,
    "document.date": formatDay(acceptance.signedOn ?? todayInVietnam()),
    "document.place": letterhead.place ?? "",
    "project.name": project?.name ?? "",
    "project.jobNumber": plan.jobNumber ?? "",
    "client.name": project?.clientName ?? "",
    "acceptance.scope": [words.scope[acceptance.scope as AcceptanceScope], target?.name].filter(Boolean).join(" — "),
    "acceptance.items": acceptanceItemsText(acceptance.items, words),
    "acceptance.totals": words.totals(acceptanceTotals(acceptance.items)),
  };
  const { text, missing } = renderTemplate(template?.body ?? ACCEPTANCE_TEMPLATE_BODY, context);
  return { title: template?.name ?? words.title, number, text, missing, letterhead };
}
