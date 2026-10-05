// Acceptance — biên bản nghiệm thu (FR-PJM-55) — per client-facing milestone, per retainer month
// or for the whole project. The record snapshots the register (promised / delivered / accepted,
// with the delivery and publish links), the paper is generated from the document template library
// (`TM-NGHIEM-THU`, rendered with the documents engine and the entity's letterhead), and the life
// is draft → sent → signed (the signed scan, date and signer attached) → or void before signing.
//
// **The paper that was issued is the paper that is kept.** A draft is rendered from the template as
// it stands each time it is opened. When the record is sent — or signed without ever being sent —
// the PDF is rendered once and stored with the record's files (`generatedFileId`), and that file is
// what opens from then on: an edit of the template changes tomorrow's papers, never one a client
// already holds. Refreshing a sent, unsigned record issues it again and retires the earlier file.
//
// Signing hands finance a billing item (FR-PJM-56) in the same transaction: a billing milestone's
// or a retainer month's own item — made now if it was not yet — with the acceptance attached, or,
// for the whole project, the fee not yet billed by milestones and months.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import vi from "../../../messages/vi.json";
import { type LetterheadFields, listTemplates, renderDocumentPdf, renderTemplate } from "../documents/service";
import { findFile, softDeleteFile, type StoredFileRow, storeIncomingFile } from "../platform/files/service";
import { notify } from "../platform/notifications/service";
import { attachAcceptance, billMilestone, ensureBillingItem, financeOf, lockFee } from "./billing";
import { adapterLineLinks } from "./delivery-adapter";
import { type AcceptanceAction, acceptanceBody, acceptanceHasScope, acceptanceItems, acceptanceNext, acceptanceNumber, acceptanceRefreshable, type AcceptanceScope, type AcceptanceStatus, acceptanceTotals, linesInScope, projectFeeLeft, type ScopedLine, signedCorrectable } from "./engine/acceptance";
import type { BillingStatus } from "./engine/acceptance";
import { monthOf } from "./engine/retainer";
import { withLineStatus } from "./metrics";
import { ensurePlan, readPlan } from "./plans";
import { feeOfPeriod, retainerMonthLabel } from "./retainers";
import type { AcceptanceCorrection } from "./schema";
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
    // A milestone that bills the client is accepted before it bills (D27), so it may be the target
    // of a record even when it was not marked client-facing; a purely internal one may not.
    if (!milestone.isClientFacing && !milestone.isBilling) throw new ActionError("acceptance_milestone_internal");
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

export type NewAcceptance = AcceptanceTarget & { /** What is accepted, in the lead's words: required when the scope has no register lines, a remark otherwise. */ description?: string | null };

/**
 * A new record, numbered per project under the plan's lock, with the register as it stands now.
 * A scope with no register lines — a billing milestone on a project that keeps no register — is
 * not refused: it is accepted in words, and the record carries them. With neither lines nor words
 * there is nothing for the client to sign, and the answer says so.
 */
export async function createAcceptance(projectId: string, input: NewAcceptance, actorPersonId: string): Promise<AcceptanceRow> {
  await ensurePlan(projectId);
  // The snapshot is a reading of the register, taken before the numbering transaction opens.
  const target = await checkTarget(db(), projectId, input);
  const items = await snapshot(projectId, target);
  const description = input.description?.trim() || null;
  if (!acceptanceHasScope(items, description)) throw new ActionError("acceptance_empty");
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
      .values({ projectId, number: (top?.value ?? 0) + 1, ...target, items, description, createdByPersonId: actorPersonId })
      .returning();
    return row;
  });
}

/**
 * A record taken again from the register — the work moved on since it was made. A draft simply
 * takes the new reading. A paper that was sent and not yet signed is **issued again**: rendered
 * from the new reading and the template as it stands today, stored, and the earlier file retired
 * (soft-deleted, so it can still be found). A signed paper does not change.
 */
export async function refreshAcceptance(acceptanceId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  const found = await findAcceptance(acceptanceId);
  if (!found) throw new ActionError("acceptance_not_found");
  if (!acceptanceRefreshable(found.status as AcceptanceStatus)) throw new ActionError("acceptance_locked");
  const items = await snapshot(found.projectId, { scope: found.scope as AcceptanceScope, milestoneId: found.milestoneId, retainerPeriodId: found.retainerPeriodId });
  if (!acceptanceHasScope(items, found.description)) throw new ActionError("acceptance_empty");
  const paper = found.status === "sent" ? await storePaper({ ...found, items }) : null;
  const result = await keepingPaper(paper, () =>
    db().transaction(async (tx) => {
      const before = await lockAcceptance(tx, acceptanceId);
      // Sent, signed or voided while the register was being read: the reading is for another record now.
      if (before.status !== found.status) throw new ActionError("acceptance_changed");
      const [after] = await tx
        .update(schema.projectAcceptance)
        .set({ items, ...(paper ? { generatedFileId: paper } : {}), updatedAt: new Date() })
        .where(eq(schema.projectAcceptance.id, acceptanceId))
        .returning();
      return { before, after };
    }),
  );
  if (paper && result.before.generatedFileId) await softDeleteFile(result.before.generatedFileId);
  return result;
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

/**
 * Sent to the client: the paper is issued now — rendered once from the record and the template as
 * they stand, stored, and kept as `generatedFileId`. The file is written before the row moves, so
 * a record is never "sent" without the paper that was sent; a move that fails takes the file back.
 */
export async function sendAcceptance(acceptanceId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  const found = await findAcceptance(acceptanceId);
  if (!found) throw new ActionError("acceptance_not_found");
  if (!acceptanceNext(found.status as AcceptanceStatus, "send")) throw new ActionError("acceptance_wrong_status");
  const paper = await storePaper(found);
  return keepingPaper(paper, () =>
    db().transaction(async (tx) => {
      const before = await lockAcceptance(tx, acceptanceId);
      // Refreshed in the moment between: the paper just rendered is of the reading before.
      if (before.updatedAt.getTime() !== found.updatedAt.getTime()) throw new ActionError("acceptance_changed");
      return { before, after: await move(tx, before, "send", { sentAt: new Date(), generatedFileId: paper }) };
    }),
  );
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
  const found = await findAcceptance(acceptanceId);
  // Signed in the meeting without ever being "sent": the paper is issued now, dated the day it was
  // signed. One that was sent keeps the paper it was sent with — a signed record is never rendered again.
  const paper = found && !found.generatedFileId && acceptanceNext(found.status as AcceptanceStatus, "sign") ? await storePaper({ ...found, signedOn: signature.signedOn }) : null;
  const result = await keepingPaper(paper, () => signIn(acceptanceId, signature, actorPersonId, paper));
  // Sent by somebody else in the moment between: that paper stands, this one goes.
  if (paper && result.after.generatedFileId !== paper) await softDeleteFile(paper);
  return result;
}

function signIn(acceptanceId: string, signature: Signature, actorPersonId: string, paper: string | null): Promise<{ before: AcceptanceRow; after: AcceptanceRow; billingItemId: string | null }> {
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    const after = await move(tx, before, "sign", { signedFileId: signature.signedFileId, signedOn: signature.signedOn, signedByClient: signature.signedByClient, ...(paper && !before.generatedFileId ? { generatedFileId: paper } : {}) });
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

export type SignatureCorrection = { /** A new scan, when the wrong one was attached; null keeps the one on record. */ signedFileId: string | null; signedOn: IsoDate; signedByClient: string; reason: string };

/**
 * Corrects what was recorded about a signature — the scan, the signer's name, the day — with a
 * reason. The record stays signed and its items stay as the client signed them; what it said
 * before is kept on the record (`corrections`), and an earlier scan stays in its files, so the
 * history can be read and the old scan still opened. Refused once finance has invoiced the item
 * this signature earned: the invoice quotes the record, and from then it does not move. Voiding is
 * untouched: a signed record still cannot be voided.
 */
export async function correctSignedAcceptance(acceptanceId: string, correction: SignatureCorrection, actorPersonId: string): Promise<{ before: AcceptanceRow; after: AcceptanceRow }> {
  if (correction.signedOn > todayInVietnam()) throw new ActionError("acceptance_signed_in_future");
  return db().transaction(async (tx) => {
    const before = await lockAcceptance(tx, acceptanceId);
    const billing = await tx.select({ status: schema.projectBillingItem.status }).from(schema.projectBillingItem).where(eq(schema.projectBillingItem.acceptanceId, acceptanceId));
    if (before.status !== "signed") throw new ActionError("acceptance_wrong_status");
    if (!signedCorrectable(before.status, billing.map((item) => item.status as BillingStatus))) throw new ActionError("acceptance_invoiced");
    const values = { signedFileId: correction.signedFileId ?? before.signedFileId, signedOn: correction.signedOn, signedByClient: correction.signedByClient };
    if (values.signedFileId === before.signedFileId && values.signedOn === before.signedOn && values.signedByClient === before.signedByClient) throw new ActionError("acceptance_correction_empty");
    const corrections = [...before.corrections, { at: new Date().toISOString(), byPersonId: actorPersonId, reason: correction.reason, before: { signedFileId: before.signedFileId, signedOn: before.signedOn, signedByClient: before.signedByClient } }];
    const [after] = await tx
      .update(schema.projectAcceptance)
      .set({ ...values, corrections, updatedAt: new Date() })
      .where(eq(schema.projectAcceptance.id, acceptanceId))
      .returning();
    return { before, after };
  });
}

/** Is this file one of the record's scans — the one on record, or one a correction replaced? */
export const isScanOf = (acceptance: Pick<AcceptanceRow, "signedFileId" | "corrections">, fileId: string): boolean => acceptance.signedFileId === fileId || acceptance.corrections.some((correction) => correction.before.signedFileId === fileId);

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type AcceptanceView = AcceptanceRow & { code: string; targetName: string | null; totals: ReturnType<typeof acceptanceTotals>; authorName: string | null; /** The corrections of the signed record, oldest first, each with who made it. */ history: (AcceptanceCorrection & { byName: string | null })[] };

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
  // Who corrected what: the names of every corrector on the page in one query.
  const correctorIds = [...new Set(rows.flatMap(({ acceptance }) => acceptance.corrections.map((correction) => correction.byPersonId)))];
  const correctors = correctorIds.length ? await db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, correctorIds)) : [];
  const nameOf = new Map(correctors.map((person) => [person.id, person.name]));
  return rows.map(({ acceptance, milestoneName, month, authorName }) => ({
    ...acceptance,
    code: acceptanceNumber(plan.jobNumber, acceptance.number),
    targetName: milestoneName ?? month ?? null,
    totals: acceptanceTotals(acceptance.items),
    authorName,
    history: acceptance.corrections.map((correction) => ({ ...correction, byName: nameOf.get(correction.byPersonId) ?? null })),
  }));
}

export type AcceptanceWaiting = { scope: AcceptanceScope; milestoneId: string | null; retainerPeriodId: string | null; /** The milestone's name or the retainer month; null for the project as a whole. */ name: string | null };

/**
 * What still waits for a signed biên bản nghiệm thu — the owner's decision of 2026-09-23 (Q22):
 * **every client project and every retainer month** is accepted before it is billed. "Client work"
 * is a project with a client on it, whatever its kind; internal work needs no acceptance and gets
 * `null` here.
 *
 * Waiting, on client work: every milestone the client is shown or billed for — `isClientFacing` or
 * `isBilling`, the same two doors `billMilestone` and the paper use, so that a billing milestone
 * nobody marked client-facing still shows here instead of billing in silence — every retainer month
 * that is over, without a signed record; and, where the project has neither, the project as a whole.
 * A signed whole-project record accepts everything under it — it bills the fee that the milestones
 * and the months left unbilled — so nothing waits behind it.
 */
export async function awaitingAcceptance(projectId: string, today: IsoDate = todayInVietnam()): Promise<AcceptanceWaiting[] | null> {
  const [project] = await db().select({ clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project?.clientId) return null;
  const [signed, milestones, periods] = await Promise.all([
    db().select({ scope: schema.projectAcceptance.scope, milestoneId: schema.projectAcceptance.milestoneId, retainerPeriodId: schema.projectAcceptance.retainerPeriodId }).from(schema.projectAcceptance).where(and(eq(schema.projectAcceptance.projectId, projectId), eq(schema.projectAcceptance.status, "signed"))),
    db().select({ id: schema.projectMilestone.id, name: schema.projectMilestone.name }).from(schema.projectMilestone).where(and(eq(schema.projectMilestone.projectId, projectId), or(eq(schema.projectMilestone.isClientFacing, true), eq(schema.projectMilestone.isBilling, true)))).orderBy(asc(schema.projectMilestone.dueDate)),
    db().select({ id: schema.projectRetainerPeriod.id, month: schema.projectRetainerPeriod.month, status: schema.projectRetainerPeriod.status }).from(schema.projectRetainerPeriod).innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId)).where(eq(schema.projectRetainer.projectId, projectId)).orderBy(asc(schema.projectRetainerPeriod.month)),
  ]);
  if (signed.some((row) => row.scope === "project")) return [];
  const milestoneIds = new Set(signed.flatMap((row) => (row.milestoneId ? [row.milestoneId] : [])));
  const periodIds = new Set(signed.flatMap((row) => (row.retainerPeriodId ? [row.retainerPeriodId] : [])));
  const month = monthOf(today);
  const waiting: AcceptanceWaiting[] = [
    ...milestones.filter((milestone) => !milestoneIds.has(milestone.id)).map((milestone) => ({ scope: "milestone" as const, milestoneId: milestone.id, retainerPeriodId: null, name: milestone.name })),
    // A month still running is not late: it is accepted once it is over and its work is delivered.
    ...periods.filter((period) => !periodIds.has(period.id) && (period.status === "closed" || period.month < month)).map((period) => ({ scope: "retainer_period" as const, milestoneId: null, retainerPeriodId: period.id, name: period.month })),
  ];
  if (waiting.length === 0 && milestones.length === 0 && periods.length === 0) return [{ scope: "project", milestoneId: null, retainerPeriodId: null, name: null }];
  return waiting;
}

/** Signed milestones and months, for the page to say what is left to accept. */
export async function signedTargets(projectId: string): Promise<{ milestoneIds: Set<string>; periodIds: Set<string> }> {
  const rows = await db().select({ milestoneId: schema.projectAcceptance.milestoneId, retainerPeriodId: schema.projectAcceptance.retainerPeriodId }).from(schema.projectAcceptance).where(and(eq(schema.projectAcceptance.projectId, projectId), ne(schema.projectAcceptance.status, "void")));
  return { milestoneIds: new Set(rows.flatMap((row) => (row.milestoneId ? [row.milestoneId] : []))), periodIds: new Set(rows.flatMap((row) => (row.retainerPeriodId ? [row.retainerPeriodId] : []))) };
}

// ── The paper ───────────────────────────────────────────────────────────────────────────────

export type AcceptanceWords = { /** What to call the paper when the template library has no name for it. */ title: string; scope: Record<AcceptanceScope, string>; promised: string; delivered: string; accepted: string; totals: (totals: { promised: number; delivered: number; accepted: number }) => string; /** The summary line of a record made of words alone. */ described: string };
export type AcceptanceDocument = { title: string; number: string; text: string; missing: string[]; letterhead: LetterheadFields; /** The project's entity: whose files the stored paper belongs to. */ entityId: string | null };

const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");

/**
 * The biên bản as text on the entity's letterhead, from the library's `TM-NGHIEM-THU` (or, before
 * the seed has run, the same starter wording). The caller has checked the reader may open the
 * project. The entity's own name, address, tax code and representative win over the template's.
 */
export async function acceptanceDocument(acceptance: AcceptanceRow, words: AcceptanceWords): Promise<AcceptanceDocument> {
  // A record exists only under a plan that was made for it (`createAcceptance`); the fallback is for type safety.
  const plan = (await readPlan(acceptance.projectId)) ?? { jobNumber: null };
  // The template comes from the documents module's cached library (reference data), not a query of its own.
  const [[project], templates] = await Promise.all([
    db()
      .select({ name: schema.workProject.name, clientName: schema.workClient.name, entity: schema.entity })
      .from(schema.workProject)
      .leftJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
      .leftJoin(schema.entity, eq(schema.entity.id, schema.workProject.entityId))
      .where(eq(schema.workProject.id, acceptance.projectId))
      .limit(1),
    listTemplates(),
  ]);
  const template = templates.find((row) => row.code === ACCEPTANCE_TEMPLATE_CODE && row.isActive);
  const entity = project?.entity;
  const own = Object.fromEntries(Object.entries({ companyName: entity?.legalName, address: entity?.address, taxCode: entity?.taxCode, representative: entity?.legalRepresentative }).filter(([, value]) => !!value)) as LetterheadFields;
  const letterhead: LetterheadFields = { ...(template?.letterhead ?? {}), ...own };
  const number = acceptanceNumber(plan.jobNumber, acceptance.number);
  const [target] = acceptance.milestoneId
    ? await db().select({ name: schema.projectMilestone.name }).from(schema.projectMilestone).where(eq(schema.projectMilestone.id, acceptance.milestoneId)).limit(1)
    : acceptance.retainerPeriodId
      ? await db().select({ name: schema.projectRetainerPeriod.month }).from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.id, acceptance.retainerPeriodId)).limit(1)
      : [undefined];
  const body = acceptanceBody(acceptance.items, acceptance.description, words);
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
    "acceptance.items": body.items,
    "acceptance.totals": body.totals,
  };
  const { text, missing } = renderTemplate(template?.body ?? ACCEPTANCE_TEMPLATE_BODY, context);
  return { title: template?.name ?? words.title, number, text, missing, letterhead, entityId: entity?.id ?? null };
}

// ── The paper that is kept ──────────────────────────────────────────────────────────────────

// The stored paper is filed where the signed scan is: the record's own files, at the scan's tier
// (`commercial-actions.ts` begins the scan's upload with the same two).
const PAPER_OWNER = "project_acceptance";
const PAPER_TIER = "personal" as const;

// The paper that is kept is the one the client signs, so its words are Vietnamese whoever presses
// "send" — from the messages, never a literal here (FR-PLT-02).
const paperWord = createTranslator({ locale: "vi", messages: vi, namespace: "projects.acceptance" });
const documentWord = createTranslator({ locale: "vi", messages: vi, namespace: "documents" });
const ISSUED_WORDS: AcceptanceWords = {
  title: paperWord("documentTitle"),
  scope: { milestone: paperWord("scopes.milestone"), retainer_period: paperWord("scopes.retainer_period"), project: paperWord("scopes.project") },
  promised: paperWord("promised"),
  delivered: paperWord("delivered"),
  accepted: paperWord("accepted"),
  totals: (totals) => paperWord("totals", totals),
  described: paperWord("described"),
};

/** Renders the paper as the record stands and stores it through the files module. Returns the file's id. */
async function storePaper(acceptance: AcceptanceRow): Promise<string> {
  const document = await acceptanceDocument(acceptance, ISSUED_WORDS);
  const bytes = renderDocumentPdf({ title: document.title, number: document.number, text: document.text, letterhead: document.letterhead, footer: documentWord("pdfFooter", { number: document.number }), today: todayInVietnam() });
  const file = await storeIncomingFile({ ownerType: PAPER_OWNER, ownerId: acceptance.id, entityId: document.entityId, tier: PAPER_TIER }, { fileName: `${document.number.replaceAll("/", "_")}.pdf`, bytes });
  return file.id;
}

/** Runs the step that records a paper just stored; a step that fails takes the file back with it. */
async function keepingPaper<Result>(paper: string | null, step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (paper) await softDeleteFile(paper);
    throw error;
  }
}

/**
 * The stored paper of a sent or signed record — the file that opens instead of a fresh rendering.
 * null for a draft (rendered live) and for a void record. A record sent or signed before papers
 * were kept has none yet: it is issued on this first opening, and that file is the paper from then
 * on. The update takes only a row that still has no file, so two readers opening it at once keep
 * one paper between them.
 */
export async function issuedPaper(acceptance: AcceptanceRow): Promise<StoredFileRow | null> {
  if (acceptance.status !== "sent" && acceptance.status !== "signed") return null;
  if (acceptance.generatedFileId) return (await findFile(acceptance.generatedFileId)) ?? null;
  const paper = await storePaper(acceptance);
  const [kept] = await db().update(schema.projectAcceptance).set({ generatedFileId: paper }).where(and(eq(schema.projectAcceptance.id, acceptance.id), isNull(schema.projectAcceptance.generatedFileId))).returning({ id: schema.projectAcceptance.id });
  if (kept) return (await findFile(paper)) ?? null;
  await softDeleteFile(paper);
  const again = await findAcceptance(acceptance.id);
  return again?.generatedFileId ? ((await findFile(again.generatedFileId)) ?? null) : null;
}
