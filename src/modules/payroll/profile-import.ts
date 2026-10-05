// Pay profiles in bulk (PAY-14, FR-PLT-36): every person's Statutory or Simple profile loaded from
// one spreadsheet, under the same rules as the pay file's form (SRS D18, FR-PAY-07).
//
// A first Statutory profile takes effect at once, as it does when typed; everything else — a Simple
// profile, a move between profiles — is proposed and waits for the owner. The owner reads the
// import's proposals together on the import's screen and approves them there in one go, each
// through `decideProfile` as if it had been approved alone (`approveProfileImport`). Only the
// proposals shown are approved.
//
// C&B over the entity. A person outside the importer's reach looks exactly like a person who does
// not exist.
import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts, listPayrollNames } from "@/modules/core-hr/service";
import { notify } from "@/modules/platform/notifications/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval } from "@/modules/platform/statutory/engine/versions";
import { code, type Column, day, oneOf, type ParsedRow, type Problem, templateCsv, text } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import type { ImportApproval } from "./salary-import";
import { canDecidePayRules, canManageCompensation, compensationReach } from "./policy";
import { withinReach } from "./reach";
import { checkProfileShape, decideProfile, type PayProfileRow, type ProfileInput } from "./profiles";

type Executor = Tx | ReturnType<typeof db>;

const yesNo = oneOf({ yes: ["có", "x", "1", "true", "yes", "y"], no: ["không", "0", "false", "no", "n"] });

export const profileColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  profile: { headers: ["Hồ sơ trả lương", "Pay profile"], required: true, parse: oneOf({ statutory: ["Đầy đủ", "Statutory"], simple: ["Đơn giản", "Simple"] }), example: "statutory" } as Column<"statutory" | "simple">,
  simpleBasis: { headers: ["Cơ sở", "Basis"], parse: oneOf({ probation: ["Thử việc"], internship: ["Thực tập"], service_contract: ["Hợp đồng dịch vụ", "CTV"], short_term: ["Ngắn hạn"], retiree: ["Nghỉ hưu"], other: ["Khác"] }), example: "" } as Column<PayProfileRow["simpleBasis"] & string>,
  validFrom: { headers: ["Hiệu lực từ", "Valid from"], required: true, parse: day, example: "2026-11-01" } as Column<IsoDate>,
  taxResidency: { headers: ["Cư trú thuế", "Tax residency"], parse: oneOf({ resident: ["Cư trú"], non_resident: ["Không cư trú"] }), example: "resident" } as Column<"resident" | "non_resident">,
  pitMethod: { headers: ["Cách tính thuế", "PIT method"], parse: oneOf({ progressive: ["Lũy tiến"], flat_without_contract: ["Khấu trừ theo tỷ lệ"], flat_non_resident: ["Không cư trú"] }), example: "progressive" } as Column<PayProfileRow["pitMethod"]>,
  pitCommitment: { headers: ["Cam kết 08", "Commitment form"], parse: yesNo, example: "không" } as Column<"yes" | "no">,
  insuranceExemption: { headers: ["Miễn bảo hiểm", "Insurance exemption"], parse: oneOf({ probation: ["Thử việc"], retiree: ["Nghỉ hưu"], insured_elsewhere: ["Đóng nơi khác"], foreigner: ["Người nước ngoài"], other: ["Khác"] }), example: "" } as Column<NonNullable<PayProfileRow["insuranceExemption"]>>,
  unionMember: { headers: ["Đoàn viên", "Union member"], parse: yesNo, example: "có" } as Column<"yes" | "no">,
  reviewDate: { headers: ["Ngày xem lại", "Review date"], parse: day, example: "" } as Column<IsoDate>,
  note: { headers: ["Ghi chú", "Note"], parse: text(500), example: "" } as Column<string>,
};

export const profileTemplate = () => templateCsv(profileColumns);

type Row = ParsedRow<typeof profileColumns>;
export const profileImportParams = z.object({ entityId: z.uuid() });
export type ProfileImportParams = z.output<typeof profileImportParams>;

export type ResolvedProfile = { input: ProfileInput; employmentId: string; entityId: string; fullName: string; /** A first Statutory profile: in force at once, like one typed on the pay file. */ first: boolean };

/** Every row checked the way `submitProfile` checks one, in two reads for the whole file. Exported for the tests. */
export async function resolveProfileRows(rows: Row[], user: { principal: Principal }, params: ProfileImportParams, executor: Executor = db()): Promise<{ problems: Problem[]; resolved: ResolvedProfile[] }> {
  const problems: Problem[] = [];
  const resolved: ResolvedProfile[] = [];
  const header = profileColumns.employeeCode.headers[0];
  if (!canManageCompensation(user.principal, { entityId: params.entityId })) return { problems: rows.map((row) => ({ row: row.row, column: header, code: "person_not_found" })), resolved };

  const facts = (await listEmploymentFacts({ entityIds: [params.entityId] }, executor)).filter((fact) => fact.entityId === params.entityId && fact.employmentId);
  const byCode = new Map(facts.flatMap((fact) => (fact.employeeCode ? [[fact.employeeCode.toUpperCase(), fact] as const] : [])));
  const employmentIds = facts.map((fact) => fact.employmentId!);
  const table = schema.payProfile;
  const existing = employmentIds.length > 0 ? await executor.select({ id: table.id, employmentId: table.employmentId, status: table.status, validFrom: table.validFrom, validTo: table.validTo }).from(table).where(and(inArray(table.employmentId, employmentIds), inArray(table.status, ["approved", "proposed"]))) : [];
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, profile, validFrom } = row.values;
    if (!employeeCode || !profile || !validFrom) continue;
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
    if (fact.startDate && validFrom < fact.startDate) {
      problems.push({ row: row.row, column: profileColumns.validFrom.headers[0], code: "outside_employment" });
      continue;
    }
    const versions = existing.filter((version) => version.employmentId === fact.employmentId);
    if (versions.some((version) => version.status === "proposed")) {
      problems.push({ row: row.row, column: header, code: "profile_proposal_open" });
      continue;
    }
    const approved = versions.filter((version) => version.status === "approved");
    const plan = planApproval(approved, validFrom);
    if (plan.kind === "rejected") {
      problems.push({ row: row.row, column: profileColumns.validFrom.headers[0], code: plan.reason });
      continue;
    }
    const taxResidency = row.values.taxResidency ?? "resident";
    const input: ProfileInput = {
      personId: fact.personId,
      profile,
      simpleBasis: profile === "simple" ? (row.values.simpleBasis ?? null) : null,
      reviewDate: profile === "simple" ? (row.values.reviewDate ?? null) : null,
      taxResidency,
      pitMethod: row.values.pitMethod ?? (taxResidency === "non_resident" ? "flat_non_resident" : "progressive"),
      pitCommitment: row.values.pitCommitment === "yes",
      insuranceExemption: row.values.insuranceExemption ?? null,
      unionMember: row.values.unionMember === "yes",
      validFrom,
      note: row.values.note ?? null,
    };
    try {
      checkProfileShape(input);
    } catch (error) {
      problems.push({ row: row.row, column: profileColumns.profile.headers[0], code: error instanceof ActionError ? error.message : "bad_choice" });
      continue;
    }
    resolved.push({ input, employmentId: fact.employmentId!, entityId: params.entityId, fullName: fact.fullName, first: approved.length === 0 && profile === "statutory" });
  }

  return { problems, resolved };
}

export const profileImport = defineImport({
  kind: "payroll_profile",
  stepUp: true,
  columns: profileColumns,
  params: profileImportParams,
  // Staging names the entity; committing is first asked without it (the framework re-asks with the
  // batch's own entity inside the transaction), so there the question is "C&B anywhere at all".
  authorize: (user, params) => (params ? canManageCompensation(user.principal, { entityId: params.entityId }) : can(user.principal, "payroll:propose")),
  validate: async (rows, user, params) => (await resolveProfileRows(rows, user, params)).problems,
  commit: async (rows, tx, user, params, batchId) => {
    const { problems, resolved } = await resolveProfileRows(rows, user, params, tx);
    if (problems.length > 0) throw new ActionError("import_stale");
    const now = new Date();
    if (resolved.length > 0) {
      await tx.insert(schema.payProfile).values(
        resolved.map(({ input: { personId, ...values }, employmentId, entityId, first }) => ({
          ...values,
          personId,
          employmentId,
          entityId,
          importBatchId: batchId ?? null,
          proposedByPersonId: user.person.id,
          status: first ? ("approved" as const) : ("proposed" as const),
          ...(first ? { decidedAt: now } : {}),
        })),
      );
    }
    const proposed = resolved.filter((line) => !line.first).length;
    // One notice for the import, not one per person: the owner reads it on the import's screen.
    if (proposed > 0 && batchId) await notify({ recipients: await listOwnerPersonIds(tx), kind: "payroll.profile_import_proposed", params: { count: proposed }, link: `/payroll/salaries/imports/${batchId}` }, tx);
    return { approved: resolved.length - proposed, proposed };
  },
});

// ── Reading and approving an import (the owner) ─────────────────────────────────────────────

export type ProfileImportLine = PayProfileRow & { fullName: string; employeeCode: string | null };

/** One import's profiles, within the entities the viewer manages compensation in. Empty = nothing to see. */
export async function listProfileImport(principal: Principal, batchId: string, executor: Executor = db()): Promise<ProfileImportLine[]> {
  // Filtered in SQL: a viewer never loads a profile of an entity whose pay they do not manage.
  const rows = await executor
    .select()
    .from(schema.payProfile)
    .where(and(eq(schema.payProfile.importBatchId, batchId), canDecidePayRules(principal) ? undefined : withinReach(schema.payProfile.entityId, compensationReach(principal))))
    .orderBy(schema.payProfile.createdAt);
  const names = new Map((await listPayrollNames(rows.map((row) => row.personId), executor)).map((name) => [name.personId, name]));
  return rows.map((row) => ({ ...row, fullName: names.get(row.personId)?.fullName ?? "—", employeeCode: names.get(row.personId)?.employeeCode ?? null }));
}

/** Profile imports with proposals still waiting, within the entities the viewer manages — counted in SQL. */
export async function listPendingProfileImports(principal: Principal, executor: Executor = db()): Promise<{ batchId: string; entityId: string; pending: number; createdAt: Date }[]> {
  const table = schema.payProfile;
  const rows = await executor
    .select({ batchId: table.importBatchId, entityId: sql<string>`min(${table.entityId}::text)`, pending: sql<number>`count(*)::int`, createdAt: sql<Date>`min(${table.createdAt})`.mapWith(table.createdAt) })
    .from(table)
    .where(and(isNotNull(table.importBatchId), eq(table.status, "proposed"), withinReach(table.entityId, compensationReach(principal))))
    .groupBy(table.importBatchId)
    .orderBy(sql`min(${table.createdAt}) desc`);
  return rows.map((row) => ({ ...row, batchId: row.batchId! }));
}

/** The owner approves the import's proposals shown to them, each through `decideProfile`. */
export async function approveProfileImport(actorPersonId: string, batchId: string, profileIds: readonly string[], executor: Executor = db()): Promise<ImportApproval> {
  const table = schema.payProfile;
  const waiting = await executor
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.importBatchId, batchId), eq(table.status, "proposed"), inArray(table.id, [...profileIds])))
    .orderBy(table.validFrom);
  const result: ImportApproval = { approved: 0, failed: [] };
  for (const { id } of waiting) {
    try {
      await decideProfile(id, "approve", actorPersonId);
      result.approved += 1;
    } catch (error) {
      result.failed.push({ requestId: id, error: error instanceof ActionError ? error.message : "generic" });
    }
  }
  return result;
}
