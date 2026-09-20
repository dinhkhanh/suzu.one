// The existing method's figures in bulk (FR-PAY-38): the accountant's spreadsheet for a month,
// so the system's own run can be held against it person by person.
//
// C&B over the entity. A person outside the entity looks exactly like a person who does not
// exist. Re-importing a month replaces what it covers, so a corrected spreadsheet is simply
// uploaded again — and any explanation already written for a difference that has now changed
// stops covering it (see `parallel.ts`).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollFacts } from "@/modules/core-hr/service";
import { code, type Column, type ParsedRow, type Problem, templateCsv, text } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import type { ReferenceFigures } from "./parallel";
import { saveReference } from "./parallel";
import { canManageCompensation } from "./policy";

const vnd = (cell: string) => {
  const cleaned = cell.trim().replace(/[\s.,]/g, "");
  return /^-?\d{1,15}$/.test(cleaned) ? { ok: true as const, value: Number(cleaned) } : { ok: false as const, code: "bad_amount" };
};

export const parallelColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  gross: { headers: ["Tổng thu nhập", "Gross"], required: true, parse: vnd, sensitive: true, example: "25000000" } as Column<number>,
  employeeInsurance: { headers: ["Bảo hiểm (NLĐ)", "Employee insurance"], parse: vnd, sensitive: true, example: "2625000" } as Column<number>,
  unionDues: { headers: ["Đoàn phí", "Union dues"], parse: vnd, sensitive: true, example: "0" } as Column<number>,
  pit: { headers: ["Thuế TNCN", "PIT"], parse: vnd, sensitive: true, example: "310000" } as Column<number>,
  otherDeductions: { headers: ["Khấu trừ khác", "Other deductions"], parse: vnd, sensitive: true, example: "0" } as Column<number>,
  net: { headers: ["Thực nhận", "Net"], required: true, parse: vnd, sensitive: true, example: "22065000" } as Column<number>,
  note: { headers: ["Ghi chú", "Note"], parse: text(300), example: "Theo bảng lương Excel tháng 8" } as Column<string>,
};

export const parallelTemplate = () => templateCsv(parallelColumns);

type Row = ParsedRow<typeof parallelColumns>;
type Resolved = { personId: string; figures: ReferenceFigures; note: string | null };

export const parallelParams = z.object({ entityId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type ParallelParams = z.output<typeof parallelParams>;

/** Exported for the tests; the import itself goes through `parallelImport`. */
export async function resolveParallelRows(rows: Row[], user: { principal: Parameters<typeof canManageCompensation>[0] }, params: ParallelParams, executor: Tx | ReturnType<typeof db> = db()): Promise<{ problems: Problem[]; resolved: Resolved[] }> {
  const problems: Problem[] = [];
  const resolved: Resolved[] = [];
  const header = parallelColumns.employeeCode.headers[0];
  const facts = await listPayrollFacts({ entityIds: [params.entityId] }, params.month, executor);
  const byCode = new Map(facts.flatMap((fact) => (fact.employeeCode ? [[fact.employeeCode.toUpperCase(), fact] as const] : [])));
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, gross, net } = row.values;
    if (!employeeCode || gross === null || net === null) continue;
    const person = byCode.get(employeeCode);
    if (!person || !canManageCompensation(user.principal, { entityId: params.entityId })) {
      problems.push({ row: row.row, column: header, code: "person_not_found" });
      continue;
    }
    if (seen.has(person.personId)) {
      problems.push({ row: row.row, column: header, code: "duplicate_person" });
      continue;
    }
    seen.add(person.personId);

    const figures: ReferenceFigures = {
      gross,
      employeeInsurance: row.values.employeeInsurance ?? 0,
      unionDues: row.values.unionDues ?? 0,
      pit: row.values.pit ?? 0,
      otherDeductions: row.values.otherDeductions ?? 0,
      net,
    };
    // The spreadsheet must at least agree with itself before it is used to judge the system.
    const expected = figures.gross - figures.employeeInsurance - figures.unionDues - figures.pit - figures.otherDeductions;
    if (expected !== figures.net) problems.push({ row: row.row, column: parallelColumns.net.headers[0], code: "reference_does_not_balance", severity: "warning" });

    resolved.push({ personId: person.personId, figures, note: row.values.note ?? null });
  }

  return { problems, resolved };
}

export const parallelImport = defineImport({
  kind: "payroll_parallel",
  columns: parallelColumns,
  params: parallelParams,
  authorize: (user, params) => !!params && canManageCompensation(user.principal, { entityId: params.entityId }),
  validate: async (rows, user, params) => (await resolveParallelRows(rows, user, params)).problems,
  commit: async (rows, tx, user, params, batchId) => {
    const { resolved } = await resolveParallelRows(rows, user, params, tx);
    for (const line of resolved) {
      const saved = await saveReference(tx, { entityId: params.entityId, month: params.month, personId: line.personId, figures: line.figures, note: line.note }, user.person.id);
      if (batchId) await tx.update(schema.payrollParallelReference).set({ importBatchId: batchId }).where(eq(schema.payrollParallelReference.id, saved.id));
    }
    return { people: resolved.length, month: Number(params.month.slice(5)) };
  },
});
