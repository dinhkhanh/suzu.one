// Salary structures (FR-PAY-01) and the salary change flow (FR-PAY-04).
//
// Amounts exist in exactly two places, both encrypted: `salary_structure.terms_enc` and the
// `payload_enc` of a `salary_change` approval request. The request's clear payload, its summary,
// the notifications the approval engine sends, the timeline event and every audit row carry the
// reason and the dates — never a figure.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { listEmploymentFacts, recordPayEvent } from "@/modules/core-hr/service";
import { decideRequest, defineRequestType, getRequest, listRequestsAbout, type RequestView, resubmitRequest, submitRequest, withdrawRequest } from "@/modules/platform/approvals/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { planApproval } from "@/modules/platform/statutory/engine/versions";
import vi from "../../../messages/vi.json";
import { resolveCatalogue } from "./components";
import { type SalaryChangeReason, type SalaryTerms, salaryTermsSchema } from "./enums";
import { salaryChangeContext, salaryTermsContext } from "./field-contexts";
import { canDecideSalaryChange, canManageCompensation, canViewCompensationOf, compensationReach } from "./policy";
import { listProfileHistory, type PayProfileRow } from "./profiles";
import { withinReach } from "./reach";

type Executor = Tx | ReturnType<typeof db>;
type Viewer = { personId: string; principal: Principal };
export type SalaryStructureRow = typeof schema.salaryStructure.$inferSelect;
export type SalaryStructureView = Omit<SalaryStructureRow, "termsEnc"> & { terms: SalaryTerms };

/** The component that carries the base salary; every other `structure` component is an allowance. */
export const BASE_SALARY_CODE = "BASE";

const openTerms = (row: SalaryStructureRow): SalaryStructureView => {
  const { termsEnc, ...rest } = row;
  return { ...rest, terms: salaryTermsSchema.parse(JSON.parse(fieldCipher().decrypt(termsEnc, salaryTermsContext(row.id)))) };
};

const inForce = (table: typeof schema.salaryStructure, from: IsoDate, to: IsoDate) => and(lte(table.validFrom, to), or(isNull(table.validTo), gte(table.validTo, from)));

// ── For payroll's own use-cases (no authorization inside) ───────────────────────────────────

/** Every structure of an entity's people that overlaps the period, decrypted — a run pro-rates across a mid-month change. */
export async function listStructuresBetween(entityId: string, from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<SalaryStructureView[]> {
  const table = schema.salaryStructure;
  const rows = await executor.select().from(table).where(and(eq(table.entityId, entityId), inForce(table, from, to))).orderBy(table.personId, table.validFrom);
  return rows.map(openTerms);
}

export async function getStructureOn(personId: string, date: IsoDate, executor: Executor = db()): Promise<SalaryStructureView | null> {
  const table = schema.salaryStructure;
  const [row] = await executor.select().from(table).where(and(eq(table.personId, personId), inForce(table, date, date))).limit(1);
  return row ? openTerms(row) : null;
}

/**
 * "One month's salary" for a set of entities on one day — what the year-end bonus multiplies
 * (FR-PAY-21). Narrow on purpose: one figure per person and nothing else, so the bonus use-case
 * never has to open a whole salary file. Somebody with no structure in force is simply absent from
 * the map, and their bonus line records `no_salary` rather than guessing at zero.
 *
 * `baseComponentCode` is the scheme's, not a constant here: "BASE" is the base salary, and any
 * other code is looked up among the structure's allowances.
 *
 * Stays inside payroll — it is not exported from `service.ts`, and no figure leaves the module.
 */
export async function listBaseSalariesOn(entityIds: readonly string[], date: IsoDate, baseComponentCode: string, executor: Executor = db()): Promise<Map<string, number>> {
  if (entityIds.length === 0) return new Map();
  const table = schema.salaryStructure;
  const rows = await executor.select().from(table).where(and(inArray(table.entityId, [...entityIds]), inForce(table, date, date))).orderBy(table.personId, table.validFrom);
  const salaries = new Map<string, number>();
  for (const row of rows) {
    const terms = openTerms(row).terms;
    const amount = baseComponentCode === BASE_SALARY_CODE ? terms.baseSalary : (terms.allowances.find((line) => line.code === baseComponentCode)?.amount ?? null);
    // Ordered by validFrom, so the latest structure in force on the day wins.
    if (amount !== null) salaries.set(row.personId, amount);
  }
  return salaries;
}

// ── Screens ─────────────────────────────────────────────────────────────────────────────────

export type SalaryOverviewRow = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  entityId: string | null;
  departmentId: string | null;
  workforceType: string;
  profile: PayProfileRow["profile"] | null;
  simpleBasis: PayProfileRow["simpleBasis"];
  structure: { id: string; validFrom: IsoDate; baseSalary: number; insuranceSalary: number; allowancesTotal: number } | null;
  hasOpenChange: boolean;
};

/**
 * The C&B salary list. Who appears is decided **in SQL** by the entities the viewer manages
 * compensation in (`payroll:propose`): a line manager's or department head's reach is empty, so
 * the query returns nothing for them however they call it.
 */
export async function listSalaryOverview(principal: Principal, filter: { entityId?: string | null; search?: string | null } = {}, today: IsoDate = todayInVietnam(), executor: Executor = db()): Promise<SalaryOverviewRow[]> {
  const reach = compensationReach(principal);
  const search = filter.search?.trim() ? `%${toSearchKey(filter.search)}%` : null;
  const table = schema.salaryStructure;
  // One query: each person with, beside them, the latest employment's code, the structure in force
  // (its own entity in reach too: pay set by another entity stays with that entity's C&B), the pay
  // profile in force and whether a salary change is open. The terms stay encrypted until below.
  const employment = executor.select({ employeeCode: schema.employment.employeeCode }).from(schema.employment).where(eq(schema.employment.personId, schema.person.id)).orderBy(desc(schema.employment.startDate)).limit(1).as("employment");
  const structure = executor
    .select({ id: table.id, validFrom: table.validFrom, termsEnc: table.termsEnc })
    .from(table)
    .where(and(eq(table.personId, schema.person.id), withinReach(table.entityId, reach), inForce(table, today, today)))
    .limit(1)
    .as("structure");
  const profiles = schema.payProfile;
  const profile = executor
    .select({ profile: profiles.profile, simpleBasis: profiles.simpleBasis })
    .from(profiles)
    .where(and(eq(profiles.personId, schema.person.id), eq(profiles.status, "approved"), lte(profiles.validFrom, today), or(isNull(profiles.validTo), gte(profiles.validTo, today))))
    .limit(1)
    .as("profile");
  const requests = schema.approvalRequest;
  const people = await executor
    .select({
      id: schema.person.id,
      fullName: schema.person.fullName,
      entityId: schema.person.primaryEntityId,
      departmentId: schema.person.departmentId,
      workforceType: schema.person.workforceType,
      employeeCode: employment.employeeCode,
      structureId: structure.id,
      structureValidFrom: structure.validFrom,
      termsEnc: structure.termsEnc,
      profile: profile.profile,
      simpleBasis: profile.simpleBasis,
      hasOpenChange: sql<boolean>`exists (select 1 from ${requests} where ${requests.type} = ${salaryChangeRequest.type} and ${requests.subjectPersonId} = ${schema.person.id} and ${requests.status} in ('pending', 'returned'))`,
    })
    .from(schema.person)
    .leftJoinLateral(employment, sql`true`)
    .leftJoinLateral(structure, sql`true`)
    .leftJoinLateral(profile, sql`true`)
    .where(and(withinReach(schema.person.primaryEntityId, reach), inArray(schema.person.status, ["preboarding", "active", "suspended"]), filter.entityId ? eq(schema.person.primaryEntityId, filter.entityId) : undefined, search ? ilike(schema.person.searchName, search) : undefined))
    .orderBy(sql`substring(${schema.person.searchName} from '[^ ]+$') || ' ' || ${schema.person.searchName}`);

  return people.map((row) => {
    const terms = row.structureId && row.termsEnc ? salaryTermsSchema.parse(JSON.parse(fieldCipher().decrypt(row.termsEnc, salaryTermsContext(row.structureId)))) : null;
    return {
      personId: row.id,
      fullName: row.fullName,
      employeeCode: row.employeeCode ?? null,
      entityId: row.entityId,
      departmentId: row.departmentId,
      workforceType: row.workforceType,
      profile: row.profile ?? null,
      simpleBasis: row.simpleBasis ?? null,
      structure: terms && row.structureId && row.structureValidFrom ? { id: row.structureId, validFrom: row.structureValidFrom, baseSalary: terms.baseSalary, insuranceSalary: terms.insuranceSalary, allowancesTotal: terms.allowances.reduce((sum, line) => sum + line.amount, 0) } : null,
      hasOpenChange: !!row.hasOpenChange,
    };
  });
}

export type SalaryFile = {
  person: { personId: string; fullName: string; employeeCode: string | null; entityId: string | null; employmentId: string | null; startDate: IsoDate | null; workforceType: string };
  /** Newest first. */
  structures: SalaryStructureView[];
  profiles: PayProfileRow[];
  /** Open and past change requests — for C&B; the person sees only what took effect. */
  requests: { id: string; status: string; summary: string; createdAt: Date; link: string | null }[];
  canManage: boolean;
};

/** One person's pay file. null = not yours to see (the page answers 404 either way, whether or not the person exists). */
export async function getSalaryFile(viewer: Viewer, personId: string): Promise<SalaryFile | null> {
  const [facts] = await listEmploymentFacts({ personIds: [personId] });
  if (!facts || !canViewCompensationOf(viewer.principal, { personId, entityId: facts.entityId })) return null;
  const canManage = canManageCompensation(viewer.principal, { entityId: facts.entityId });
  const [rows, profiles, requests] = await Promise.all([
    db().select().from(schema.salaryStructure).where(eq(schema.salaryStructure.personId, personId)).orderBy(desc(schema.salaryStructure.validFrom)),
    listProfileHistory(personId),
    canManage ? listRequestsAbout(salaryChangeRequest.type, personId) : Promise.resolve([]),
  ]);
  return {
    person: { personId, fullName: facts.fullName, employeeCode: facts.employeeCode, entityId: facts.entityId, employmentId: facts.employmentId, startDate: facts.startDate, workforceType: facts.workforceType },
    structures: rows.map(openTerms),
    profiles: canManage ? profiles : profiles.filter((row) => row.status === "approved"),
    requests: requests.map((request) => ({ id: request.id, status: request.status, summary: request.summary, createdAt: request.createdAt, link: request.link })),
    canManage,
  };
}

// ── The salary change request ───────────────────────────────────────────────────────────────

export const salaryChangeRequest = defineRequestType({
  type: "salary_change",
  // SRS D17: C&B proposes, the owner decides. An entity may configure another flow (a CEO step);
  // whoever it names must still pass `canDecideSalaryChange` to see a figure or to answer.
  flow: { steps: [{ key: "owner", mode: "any", approvers: [{ rule: "role", role: "owner" }] }] },
  canView: (viewer, subject) => !!subject && canManageCompensation(viewer, subject),
  // A salary is read before it is signed: never from the inbox in bulk.
  bulkApprovable: () => false,
});

/** The clear payload: what kind of change, from when. No amounts — they are in `payload_enc`. */
export type SalaryChangePayload = { reason: SalaryChangeReason; validFrom: IsoDate; employmentId: string; initial: boolean };
type SealedSalaryChange = { terms: SalaryTerms; note: string | null };

export type SalaryChangeInput = { personId: string; validFrom: IsoDate; reason: SalaryChangeReason; terms: SalaryTerms; note: string | null };

const reasonLabel = createTranslator({ locale: "vi", messages: vi, namespace: "payroll.salaries.reasons" });
const day = (date: IsoDate) => date.split("-").reverse().join("/");
const summaryOf = (input: { reason: SalaryChangeReason; validFrom: IsoDate }) => `${reasonLabel(input.reason)} — hiệu lực ${day(input.validFrom)}`;

async function checkTerms(executor: Executor, entityId: string, input: SalaryChangeInput) {
  const terms = salaryTermsSchema.safeParse(input.terms);
  if (!terms.success) throw new ActionError("salary_terms_invalid");
  // A salary may have started before the catalogue did (people hired long before go-live): a
  // component in force on the effective date or today will do — payroll only ever runs from go-live on.
  const catalogue = [...(await resolveCatalogue(entityId, input.validFrom, executor)), ...(await resolveCatalogue(entityId, todayInVietnam(), executor))];
  const allowed = new Set(catalogue.filter((component) => component.source === "structure" && component.kind === "earning" && component.code !== BASE_SALARY_CODE).map((component) => component.code));
  const unknown = terms.data.allowances.filter((line) => !allowed.has(line.code)).map((line) => line.code);
  // Codes are catalogue entries, not pay: naming the unknown one is safe.
  if (unknown.length) throw new ActionError("salary_allowance_unknown", { codes: unknown });
  return { ...terms.data, allowances: terms.data.allowances.filter((line) => line.amount > 0) };
}

async function plan(executor: Executor, employmentId: string, validFrom: IsoDate) {
  const existing = await executor.select().from(schema.salaryStructure).where(eq(schema.salaryStructure.employmentId, employmentId));
  const result = planApproval(existing, validFrom);
  if (result.kind === "rejected") throw new ActionError(`salary_${result.reason}`);
  return { result, initial: existing.length === 0 };
}

export async function submitSalaryChange(actorPersonId: string, input: SalaryChangeInput) {
  return db().transaction(async (tx) => {
    const [facts] = await listEmploymentFacts({ personIds: [input.personId] }, tx);
    if (!facts?.employmentId || !facts.entityId) throw new ActionError("person_without_employment");
    if (facts.startDate && input.validFrom < facts.startDate) throw new ActionError("salary_before_employment");
    const [open] = await tx.select({ id: schema.approvalRequest.id }).from(schema.approvalRequest).where(and(eq(schema.approvalRequest.type, salaryChangeRequest.type), eq(schema.approvalRequest.subjectPersonId, input.personId), inArray(schema.approvalRequest.status, ["pending", "returned"]))).limit(1);
    if (open) throw new ActionError("salary_change_open");

    const terms = await checkTerms(tx, facts.entityId, input);
    const { initial } = await plan(tx, facts.employmentId, input.validFrom);
    const reason: SalaryChangeReason = initial ? "initial" : input.reason === "initial" ? "adjustment" : input.reason;
    const id = randomUUID();
    const payload: SalaryChangePayload = { reason, validFrom: input.validFrom, employmentId: facts.employmentId, initial };
    const sealed: SealedSalaryChange = { terms, note: input.note };
    const { request, approverIds } = await submitRequest(tx, salaryChangeRequest, {
      id,
      entityId: facts.entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: input.personId,
      summary: summaryOf(payload),
      payload,
      payloadEnc: fieldCipher().encrypt(JSON.stringify(sealed), salaryChangeContext(id)),
      link: (requestId) => `/payroll/salaries/changes/${requestId}`,
      // Flow conditions may look at the kind of change, never at an amount.
      conditionData: { reason, initial },
    });
    return { request, payload, approverIds, entityId: facts.entityId };
  });
}

/** C&B's corrected proposal after it was sent back. */
export async function resubmitSalaryChange(actorPersonId: string, requestId: string, input: SalaryChangeInput) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, salaryChangeRequest.type))).limit(1);
    if (!row?.subjectPersonId || !row.entityId || row.subjectPersonId !== input.personId) throw new ActionError("approval_not_found");
    const before = row.payload as SalaryChangePayload;
    const terms = await checkTerms(tx, row.entityId, input);
    const { initial } = await plan(tx, before.employmentId, input.validFrom);
    const payload: SalaryChangePayload = { ...before, reason: initial ? "initial" : input.reason === "initial" ? "adjustment" : input.reason, validFrom: input.validFrom, initial };
    const { request } = await resubmitRequest(tx, salaryChangeRequest, requestId, actorPersonId, { summary: summaryOf(payload), payload, payloadEnc: fieldCipher().encrypt(JSON.stringify({ terms, note: input.note } satisfies SealedSalaryChange), salaryChangeContext(requestId)) });
    return { request, payload, entityId: row.entityId };
  });
}

export async function withdrawSalaryChange(actorPersonId: string, requestId: string) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select({ id: schema.approvalRequest.id }).from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, salaryChangeRequest.type))).limit(1);
    if (!row) throw new ActionError("approval_not_found");
    return withdrawRequest(tx, requestId, actorPersonId);
  });
}

const unseal = (request: { id: string; payloadEnc: string | null }): SealedSalaryChange => {
  if (!request.payloadEnc) throw new ActionError("approval_not_found");
  const sealed = JSON.parse(fieldCipher().decrypt(request.payloadEnc, salaryChangeContext(request.id))) as SealedSalaryChange;
  return { terms: salaryTermsSchema.parse(sealed.terms), note: sealed.note ?? null };
};

async function nextDecisionNumber(tx: Tx, entityId: string, year: string): Promise<string> {
  const [entity] = await tx.select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1);
  const suffix = `/${year}/QĐL-${entity?.code ?? "X"}`;
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.salaryStructure).where(and(eq(schema.salaryStructure.entityId, entityId), like(schema.salaryStructure.decisionNumber, `%${suffix}`)));
  return `${String(count + 1).padStart(3, "0")}${suffix}`;
}

/**
 * The approver's answer. Whose turn it is comes from the approval engine; on top of that the
 * approver must be someone payroll trusts with figures over this entity (`canDecideSalaryChange`)
 * — a flow that names a line manager does not make the line manager an approver of pay.
 * Approval applies the change in the same transaction: the structure in force ends the day
 * before, the new one starts, the decision gets its number, the timeline gets its event.
 */
export async function decideSalaryChange(actor: Viewer, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, salaryChangeRequest.type))).limit(1).for("update");
    if (!row?.subjectPersonId || !row.entityId) throw new ActionError("approval_not_found");
    if (!canDecideSalaryChange(actor.principal, { entityId: row.entityId })) throw new ActionError("forbidden");
    const payload = row.payload as SalaryChangePayload;

    const { request, before, outcome } = await decideRequest(tx, salaryChangeRequest, requestId, actor.personId, { action: decision.action, comment: decision.comment });
    let structureId: string | null = null;
    if (outcome === "approved") {
      const { terms } = unseal(row);
      const { result } = await plan(tx, payload.employmentId, payload.validFrom);
      if (result.kind === "succeed") await tx.update(schema.salaryStructure).set({ validTo: result.closeOn, updatedAt: new Date() }).where(eq(schema.salaryStructure.id, result.closeId));
      structureId = randomUUID();
      await tx.insert(schema.salaryStructure).values({
        id: structureId,
        personId: row.subjectPersonId,
        employmentId: payload.employmentId,
        entityId: row.entityId,
        validFrom: payload.validFrom,
        termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(structureId)),
        reason: payload.reason,
        approvalRequestId: requestId,
        decisionNumber: await nextDecisionNumber(tx, row.entityId, todayInVietnam().slice(0, 4)),
        decidedByPersonId: actor.personId,
        createdByPersonId: row.requesterPersonId,
      });
      // The first structure comes with the hire, which already has its own event and obligations.
      if (!payload.initial) await recordPayEvent(tx, { type: "salary_change", personId: row.subjectPersonId, employmentId: payload.employmentId, entityId: row.entityId, effectiveDate: payload.validFrom, reason: payload.reason, details: {}, approvalRequestId: requestId }, actor.personId);
    }
    return { request, before, outcome, payload, entityId: row.entityId, subjectPersonId: row.subjectPersonId, structureId };
  });
}

export type SalaryChangeView = RequestView & {
  payload: SalaryChangePayload;
  /** The proposed terms and the terms they replace — only for someone payroll trusts with figures. */
  figures: { proposed: SalaryTerms; current: SalaryTerms | null; note: string | null } | null;
  canResubmit: boolean;
};

export async function getSalaryChange(viewer: Viewer, requestId: string): Promise<SalaryChangeView | null> {
  const view = await getRequest(viewer, salaryChangeRequest, requestId);
  if (!view || !view.request.entityId) return null;
  const where = { entityId: view.request.entityId };
  const payload = view.request.payload as SalaryChangePayload;
  const trusted = canManageCompensation(viewer.principal, where) || canDecideSalaryChange(viewer.principal, where);
  let figures: SalaryChangeView["figures"] = null;
  if (trusted && view.request.payloadEnc) {
    const sealed = unseal(view.request);
    const current = view.request.subjectPersonId ? await getStructureOn(view.request.subjectPersonId, new Date(Date.parse(`${payload.validFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)) : null;
    figures = { proposed: sealed.terms, current: current?.terms ?? null, note: sealed.note };
  }
  return { ...view, payload, figures, canDecide: view.canDecide && canDecideSalaryChange(viewer.principal, where), canResubmit: view.isRequester && view.request.status === "returned" && canManageCompensation(viewer.principal, where) };
}

// ── The decision document ───────────────────────────────────────────────────────────────────

export type SalaryDecision = { structure: SalaryStructureView; previous: SalaryStructureView | null; personName: string; employeeCode: string | null; entity: { legalName: string; address: string | null; legalRepresentative: string | null; code: string }; decidedAt: Date; decidedByName: string | null; componentNames: Record<string, string> };

/** "Quyết định điều chỉnh lương", generated from the structure (FR-PAY-04). For the person themselves and C&B. */
export async function getSalaryDecision(viewer: Viewer, structureId: string): Promise<SalaryDecision | null> {
  const [row] = await db().select().from(schema.salaryStructure).where(eq(schema.salaryStructure.id, structureId)).limit(1);
  if (!row || !canViewCompensationOf(viewer.principal, { personId: row.personId, entityId: row.entityId })) return null;
  const [[facts], [entity], [previous], catalogue, [decider]] = await Promise.all([
    listEmploymentFacts({ personIds: [row.personId] }),
    db().select().from(schema.entity).where(eq(schema.entity.id, row.entityId)).limit(1),
    db().select().from(schema.salaryStructure).where(and(eq(schema.salaryStructure.employmentId, row.employmentId), lte(schema.salaryStructure.validFrom, row.validFrom), sql`${schema.salaryStructure.id} <> ${row.id}`)).orderBy(desc(schema.salaryStructure.validFrom)).limit(1),
    resolveCatalogue(row.entityId, row.validFrom),
    row.decidedByPersonId ? db().select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, row.decidedByPersonId)).limit(1) : Promise.resolve([]),
  ]);
  if (!facts || !entity) return null;
  return {
    structure: openTerms(row),
    previous: previous ? openTerms(previous) : null,
    personName: facts.fullName,
    employeeCode: facts.employeeCode,
    entity: { legalName: entity.legalName, address: entity.address, legalRepresentative: entity.legalRepresentative, code: entity.code },
    decidedAt: row.createdAt,
    decidedByName: decider?.name ?? null,
    componentNames: Object.fromEntries(catalogue.map((component) => [component.code, component.name])),
  };
}

/** Where a salary change request sits — for the actions' authorization. null = no such request (answered like a refusal). */
export async function salaryChangeEntity(requestId: string): Promise<{ entityId: string; requesterPersonId: string } | null> {
  const [row] = await db().select({ entityId: schema.approvalRequest.entityId, requesterPersonId: schema.approvalRequest.requesterPersonId }).from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, salaryChangeRequest.type))).limit(1);
  return row?.entityId ? { entityId: row.entityId, requesterPersonId: row.requesterPersonId } : null;
}
