// Salary structures in bulk (PAY-14, FR-PLT-36): a company's salaries loaded from one spreadsheet
// instead of a change typed per person — and still approved by the owner.
//
// The import does not set anybody's salary. Each row becomes the same `salary_change` request the
// pay file's form makes (C&B proposes, the owner decides — SRS D17), sealed the same way and marked
// with the import it came in with. The owner then reads the whole import on one screen, every
// figure beside the one it replaces, and approves it there in one go: each request is still decided
// by the owner through the approval engine, one by one, with its own decision number and audit row.
// What the owner has not seen on that screen is never approved by it (`approveSalaryImport` takes
// the ids that were shown).
//
// C&B over the entity. A person outside the importer's reach looks exactly like a person who does
// not exist.
import "server-only";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts, listPayrollNames } from "@/modules/core-hr/service";
import { can, entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { planApproval } from "@/modules/platform/statutory/engine/versions";
import { getParameter } from "@/modules/platform/statutory/service";
import vi from "../../../messages/vi.json";
import { code, type Column, day, type ParsedRow, type Problem, templateCsv, text } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import { resolveCatalogue } from "./components";
import { SALARY_CHANGE_REASONS, type SalaryChangeReason, type SalaryTerms, salaryTermsSchema } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { canDecideSalaryChange, canManageCompensation, compensationReach } from "./policy";
import { type EntityReach, withinReach } from "./reach";
import { BASE_SALARY_CODE, type CheckedSalaryChange, decideSalaryChange, fileSalaryChange, salaryChangeRequest, type SalaryChangePayload, unseal } from "./salaries";

type Executor = Tx | ReturnType<typeof db>;

/** Money as typed in a spreadsheet: "12.500.000", "12,500,000" or "12500000". Integer VND only. */
const vnd = (cell: string) => {
  const cleaned = cell.trim().replace(/[\s.,]/g, "");
  if (!/^-?\d{1,15}$/.test(cleaned)) return { ok: false as const, code: "bad_amount" };
  const value = Number(cleaned);
  return value < 0 ? { ok: false as const, code: "amount_negative" } : { ok: true as const, value };
};

/** "ALW_MEAL=730000; ALW_PHONE=200000" — each allowance by its catalogue code, the amount in VND. */
const allowanceList = (cell: string) => {
  const lines: { code: string; amount: number }[] = [];
  for (const part of cell.split(/[;\n]/).map((piece) => piece.trim()).filter(Boolean)) {
    const match = /^([A-Za-z][A-Za-z0-9_]{1,39})\s*[=:]\s*([\d.,\s]+)$/.exec(part);
    const amount = match ? vnd(match[2]) : null;
    if (!match || !amount?.ok) return { ok: false as const, code: "bad_allowances" };
    lines.push({ code: match[1].toUpperCase(), amount: amount.value });
  }
  return { ok: true as const, value: lines };
};

const percent = (cell: string) => {
  const value = Number(cell.trim().replace(/%$/, ""));
  return Number.isInteger(value) && value >= 1 && value <= 100 ? { ok: true as const, value } : { ok: false as const, code: "bad_number" };
};

const reasonNames = vi.payroll.salaries.reasons as Record<SalaryChangeReason, string>;
const reason = (cell: string) => {
  const wanted = cell.trim().toLowerCase();
  const found = SALARY_CHANGE_REASONS.find((value) => value === wanted || reasonNames[value]?.toLowerCase() === wanted);
  return found ? { ok: true as const, value: found } : { ok: false as const, code: "bad_choice" };
};

export const salaryColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  validFrom: { headers: ["Hiệu lực từ", "Valid from"], required: true, parse: day, example: "2026-11-01" } as Column<IsoDate>,
  reason: { headers: ["Lý do", "Reason"], parse: reason, example: "initial" } as Column<SalaryChangeReason>,
  baseSalary: { headers: ["Lương cơ bản", "Base salary"], required: true, parse: vnd, sensitive: true, example: "20000000" } as Column<number>,
  insuranceSalary: { headers: ["Lương đóng bảo hiểm", "Insurance salary"], parse: vnd, sensitive: true, example: "20000000" } as Column<number>,
  allowances: { headers: ["Phụ cấp", "Allowances"], parse: allowanceList, sensitive: true, example: "ALW_MEAL=730000; ALW_PHONE=200000" } as Column<{ code: string; amount: number }[]>,
  probationPercent: { headers: ["Tỷ lệ lương thử việc (%)", "Probation pay (%)"], parse: percent, example: "" } as Column<number>,
  note: { headers: ["Ghi chú", "Note"], parse: text(500), example: "Lương khi chuyển sang hệ thống" } as Column<string>,
};

export const salaryTemplate = () => templateCsv(salaryColumns);

type Row = ParsedRow<typeof salaryColumns>;
export const salaryImportParams = z.object({ entityId: z.uuid() });
export type SalaryImportParams = z.output<typeof salaryImportParams>;

/**
 * Every row checked the way the pay file's form checks one change — a person of the entity with an
 * employment, no change already waiting for them, a start no earlier than the employment's or the
 * structure in force, allowances from the catalogue, a probation share no lower than the law's — in
 * a handful of reads for the whole file. Exported for the tests; the import goes through `salaryImport`.
 */
export async function resolveSalaryRows(rows: Row[], user: { principal: Principal }, params: SalaryImportParams, executor: Executor = db()): Promise<{ problems: Problem[]; resolved: CheckedSalaryChange[] }> {
  const problems: Problem[] = [];
  const resolved: CheckedSalaryChange[] = [];
  const header = salaryColumns.employeeCode.headers[0];
  if (!canManageCompensation(user.principal, { entityId: params.entityId })) return { problems: rows.map((row) => ({ row: row.row, column: header, code: "person_not_found" })), resolved };

  const facts = (await listEmploymentFacts({ entityIds: [params.entityId] }, executor)).filter((fact) => fact.entityId === params.entityId && fact.employmentId);
  const byCode = new Map(facts.flatMap((fact) => (fact.employeeCode ? [[fact.employeeCode.toUpperCase(), fact] as const] : [])));
  const named = rows.flatMap((row) => (row.values.employeeCode && byCode.get(row.values.employeeCode) ? [byCode.get(row.values.employeeCode)!] : []));
  const dates = [...new Set([todayInVietnam(), ...rows.flatMap((row) => (row.values.validFrom ? [row.values.validFrom] : []))])];
  const requests = schema.approvalRequest;
  const structures = schema.salaryStructure;
  const [open, standing, catalogues, limits] = await Promise.all([
    named.length > 0
      ? executor.selectDistinct({ personId: requests.subjectPersonId }).from(requests).where(and(eq(requests.type, salaryChangeRequest.type), inArray(requests.status, ["pending", "returned"]), inArray(requests.subjectPersonId, named.map((fact) => fact.personId))))
      : [],
    named.length > 0 ? executor.select({ id: structures.id, employmentId: structures.employmentId, validFrom: structures.validFrom, validTo: structures.validTo }).from(structures).where(and(inArray(structures.employmentId, named.map((fact) => fact.employmentId!)), isNull(structures.voidedAt))) : [],
    // The catalogue is the shared cached table; a salary may name a component in force on its start or today.
    Promise.all(dates.map((date) => resolveCatalogue(params.entityId, date, executor === db() ? undefined : executor))),
    Promise.all(dates.map((date) => getParameter("probation.limits", date, executor === db() ? undefined : executor).catch(() => null))),
  ]);
  const waiting = new Set(open.map((row) => row.personId));
  const allowed = new Set(catalogues.flat().filter((component) => component.source === "structure" && component.kind === "earning" && component.code !== BASE_SALARY_CODE).map((component) => component.code));
  const minimumOn = new Map(dates.map((date, index) => [date, limits[index]?.minimumPayPercent ?? 100]));
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, validFrom, baseSalary } = row.values;
    if (!employeeCode || !validFrom || baseSalary === null) continue;
    const fact = byCode.get(employeeCode);
    if (!fact) {
      problems.push({ row: row.row, column: header, code: "person_not_found" });
      continue;
    }
    if (seen.has(fact.personId)) {
      problems.push({ row: row.row, column: header, code: "duplicate_person" });
      continue;
    }
    seen.add(fact.personId);
    if (waiting.has(fact.personId)) {
      problems.push({ row: row.row, column: header, code: "salary_change_open" });
      continue;
    }
    if (fact.startDate && validFrom < fact.startDate) {
      problems.push({ row: row.row, column: salaryColumns.validFrom.headers[0], code: "outside_employment" });
      continue;
    }
    const existing = standing.filter((structure) => structure.employmentId === fact.employmentId);
    const plan = planApproval(existing, validFrom);
    if (plan.kind === "rejected") {
      problems.push({ row: row.row, column: salaryColumns.validFrom.headers[0], code: plan.reason });
      continue;
    }
    const allowances = (row.values.allowances ?? []).filter((line) => line.amount > 0);
    const unknown = allowances.filter((line) => !allowed.has(line.code));
    if (unknown.length > 0) {
      problems.push({ row: row.row, column: salaryColumns.allowances.headers[0], code: "allowance_unknown", detail: unknown.map((line) => line.code).join(", ") });
      continue;
    }
    const probationPercent = row.values.probationPercent ?? null;
    if (probationPercent !== null && probationPercent < 100 && probationPercent < (minimumOn.get(validFrom) ?? 100)) {
      problems.push({ row: row.row, column: salaryColumns.probationPercent.headers[0], code: "probation_below_minimum" });
      continue;
    }
    const terms = salaryTermsSchema.safeParse({ baseSalary, insuranceSalary: row.values.insuranceSalary ?? baseSalary, allowances, ...(probationPercent !== null && probationPercent < 100 ? { probationPercent } : {}) });
    if (!terms.success) {
      problems.push({ row: row.row, column: salaryColumns.allowances.headers[0], code: "bad_allowances" });
      continue;
    }
    resolved.push({ personId: fact.personId, entityId: params.entityId, employmentId: fact.employmentId!, validFrom, reason: row.values.reason ?? "adjustment", initial: existing.length === 0, terms: terms.data, note: row.values.note ?? null });
  }

  return { problems, resolved };
}

export const salaryImport = defineImport({
  kind: "payroll_salary",
  // A spreadsheet of people's pay: compensation tier, so it asks who you are again (FR-PLT-06).
  stepUp: true,
  columns: salaryColumns,
  params: salaryImportParams,
  // Staging names the entity; committing is first asked without it (the framework re-asks with the
  // batch's own entity inside the transaction), so there the question is "C&B anywhere at all".
  authorize: (user, params) => (params ? canManageCompensation(user.principal, { entityId: params.entityId }) : can(user.principal, "payroll:propose")),
  validate: async (rows, user, params) => (await resolveSalaryRows(rows, user, params)).problems,
  commit: async (rows, tx, user, params, batchId) => {
    const { problems, resolved } = await resolveSalaryRows(rows, user, params, tx);
    // Something changed between staging and committing (a change filed by hand meanwhile): nothing lands.
    if (problems.length > 0) throw new ActionError("import_stale");
    // One request per person, each through the approval engine like a change typed on the pay file.
    for (const change of resolved) await fileSalaryChange(tx, user.person.id, { ...change, importBatchId: batchId ?? null });
    return { requests: resolved.length };
  },
});

// ── Reading and approving an import (the owner) ─────────────────────────────────────────────

export type SalaryImportLine = {
  requestId: string;
  personId: string;
  fullName: string;
  employeeCode: string | null;
  entityId: string;
  status: string;
  payload: SalaryChangePayload;
  proposed: SalaryTerms;
  /** The structure it replaces: in force the day before it starts. */
  current: SalaryTerms | null;
  note: string | null;
};

export type SalaryImportView = { batchId: string; lines: SalaryImportLine[]; pending: number; canApprove: boolean };

/**
 * One import's requests with every figure beside the one it replaces — what the owner reads before
 * approving it. Only requests of entities the viewer is trusted with figures in; null = nothing to see.
 */
export async function getSalaryImport(viewer: { personId: string; principal: Principal }, batchId: string, executor: Executor = db()): Promise<SalaryImportView | null> {
  const requests = schema.approvalRequest;
  const structures = schema.salaryStructure;
  // Each request with, beside it, the structure in force the day before it would start — one query.
  const current = executor
    .select({ id: structures.id, termsEnc: structures.termsEnc })
    .from(structures)
    .where(and(eq(structures.personId, requests.subjectPersonId), isNull(structures.voidedAt), lt(structures.validFrom, sql`(${requests.payload} ->> 'validFrom')::date`)))
    .orderBy(desc(structures.validFrom))
    .limit(1)
    .as("current");
  const rows = await executor
    .select({ request: requests, currentId: current.id, currentEnc: current.termsEnc })
    .from(requests)
    .leftJoinLateral(current, sql`true`)
    // Filtered in SQL: the entities where the viewer is trusted with salary figures (`canDecideSalaryChange`).
    .where(and(eq(requests.type, salaryChangeRequest.type), sql`${requests.payload} ->> 'importBatchId' = ${batchId}`, withinReach(requests.entityId, salaryDeciderReach(viewer.principal))))
    .orderBy(requests.createdAt);
  // The same question again, row by row, before anything is decrypted.
  const visible = rows.filter(({ request }) => request.entityId && request.subjectPersonId && canDecideSalaryChange(viewer.principal, { entityId: request.entityId }));
  if (visible.length === 0) return null;
  const names = new Map((await listPayrollNames(visible.map(({ request }) => request.subjectPersonId!), executor)).map((name) => [name.personId, name]));
  const lines = visible.map(({ request, currentId, currentEnc }): SalaryImportLine => {
    const sealed = unseal(request);
    return {
      requestId: request.id,
      personId: request.subjectPersonId!,
      fullName: names.get(request.subjectPersonId!)?.fullName ?? "—",
      employeeCode: names.get(request.subjectPersonId!)?.employeeCode ?? null,
      entityId: request.entityId!,
      status: request.status,
      payload: request.payload as SalaryChangePayload,
      proposed: sealed.terms,
      current: currentId && currentEnc ? salaryTermsSchema.parse(JSON.parse(fieldCipher().decrypt(currentEnc, salaryTermsContext(currentId)))) : null,
      note: sealed.note,
    };
  });
  const pending = lines.filter((line) => line.status === "pending").length;
  return { batchId, lines, pending, canApprove: pending > 0 && can(viewer.principal, "payroll:rules") };
}

/** Where `canDecideSalaryChange` holds — the owner's rules, the CEO's signature or C&B — as one reach for SQL. */
function salaryDeciderReach(principal: Principal): EntityReach {
  const reaches = [entityReach(principal, "payroll:rules"), entityReach(principal, "payroll:approve"), compensationReach(principal)];
  if (reaches.some((reach) => reach.all)) return { all: true };
  return { all: false, entityIds: [...new Set(reaches.flatMap((reach) => (reach.all ? [] : reach.entityIds)))] };
}

export type ImportApproval = { approved: number; failed: { requestId: string; error: string }[] };

/**
 * The owner approves an import they have just read. Only the ids shown to them are approved, and
 * only while they are still waiting and belong to this import; each is decided through
 * `decideSalaryChange` — the approval engine says whose turn it is, the structure is applied, the
 * decision gets its number — exactly as if it had been opened and approved alone.
 */
export async function approveSalaryImport(actor: { personId: string; principal: Principal }, batchId: string, requestIds: readonly string[], executor: Executor = db()): Promise<ImportApproval> {
  const requests = schema.approvalRequest;
  const waiting = await executor
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.type, salaryChangeRequest.type), eq(requests.status, "pending"), inArray(requests.id, [...requestIds]), sql`${requests.payload} ->> 'importBatchId' = ${batchId}`))
    .orderBy(requests.createdAt);
  const result: ImportApproval = { approved: 0, failed: [] };
  // One decision after another: each is its own transaction, so one refusal does not undo the others.
  for (const { id } of waiting) {
    try {
      const { outcome } = await decideSalaryChange(actor, id, { action: "approve", comment: null });
      if (outcome === "approved") result.approved += 1;
    } catch (error) {
      result.failed.push({ requestId: id, error: error instanceof ActionError ? error.message : "generic" });
    }
  }
  return result;
}

export type PendingImport = { batchId: string; entityId: string; pending: number; total: number; createdAt: Date };

/** Salary imports with requests still waiting, within the entities the viewer manages — counted in SQL. */
export async function listPendingSalaryImports(principal: Principal, executor: Executor = db()): Promise<PendingImport[]> {
  const requests = schema.approvalRequest;
  const batch = sql<string>`${requests.payload} ->> 'importBatchId'`;
  const rows = await executor
    .select({ batchId: batch, entityId: sql<string>`min(${requests.entityId}::text)`, pending: sql<number>`count(*) filter (where ${requests.status} = 'pending')::int`, total: sql<number>`count(*)::int`, createdAt: sql<Date>`min(${requests.createdAt})`.mapWith(requests.createdAt) })
    .from(requests)
    .where(and(eq(requests.type, salaryChangeRequest.type), sql`${batch} is not null`, withinReach(requests.entityId, compensationReach(principal))))
    .groupBy(batch)
    .having(sql`count(*) filter (where ${requests.status} = 'pending') > 0`)
    .orderBy(sql`min(${requests.createdAt}) desc`);
  return rows;
}
