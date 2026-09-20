// Year-to-date figures in bulk (FR-PAY-35, FR-PLT-36): what the previous method already paid and
// withheld in a year before the system took over, so the annual finalization covers the whole
// year and not only the months that were run here.
//
// C&B over the entity (`payroll:propose`). A person outside the importer's reach looks exactly
// like a person who does not exist. A re-import of the same year replaces the row rather than
// adding to it, so a corrected file can simply be uploaded again.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollFacts } from "@/modules/core-hr/service";
import { code, type Column, type ParsedRow, type Problem, templateCsv, text } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import { canManageCompensation } from "./policy";
import { saveYtd, type YtdFigures } from "./ytd";

/** Money as typed in a spreadsheet: "12.500.000", "12,500,000" or "12500000". Integer VND only. */
const vnd = (cell: string) => {
  const cleaned = cell.trim().replace(/[\s.,]/g, "");
  if (!/^-?\d{1,15}$/.test(cleaned)) return { ok: false as const, code: "bad_amount" };
  const value = Number(cleaned);
  return value < 0 ? { ok: false as const, code: "amount_negative" } : { ok: true as const, value };
};

const months = (cell: string) => {
  const value = Number(cell.trim());
  return Number.isInteger(value) && value >= 0 && value <= 12 ? { ok: true as const, value } : { ok: false as const, code: "bad_month_count" };
};

export const ytdColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  months: { headers: ["Số tháng", "Months"], required: true, parse: months, example: "6" } as Column<number>,
  taxableIncome: { headers: ["Thu nhập chịu thuế", "Taxable income"], required: true, parse: vnd, sensitive: true, example: "180000000" } as Column<number>,
  insuranceDeduction: { headers: ["Bảo hiểm được trừ", "Insurance deducted"], parse: vnd, sensitive: true, example: "18900000" } as Column<number>,
  personalDeduction: { headers: ["Giảm trừ bản thân", "Personal deduction"], parse: vnd, sensitive: true, example: "93000000" } as Column<number>,
  dependentDeduction: { headers: ["Giảm trừ người phụ thuộc", "Dependent deduction"], parse: vnd, sensitive: true, example: "0" } as Column<number>,
  otherDeductions: { headers: ["Giảm trừ khác", "Other deductions"], parse: vnd, sensitive: true, example: "0" } as Column<number>,
  assessableIncome: { headers: ["Thu nhập tính thuế", "Assessable income"], parse: vnd, sensitive: true, example: "68100000" } as Column<number>,
  taxWithheld: { headers: ["Thuế đã khấu trừ", "Tax withheld"], required: true, parse: vnd, sensitive: true, example: "3810000" } as Column<number>,
  note: { headers: ["Ghi chú", "Note"], parse: text(300), example: "Số liệu từ bảng lương cũ" } as Column<string>,
};

export const ytdTemplate = () => templateCsv(ytdColumns);

type Row = ParsedRow<typeof ytdColumns>;
type Resolved = { row: Row; personId: string; entityId: string; months: number; figures: YtdFigures; note: string | null };

export const ytdParams = z.object({ entityId: z.uuid(), year: z.coerce.number().int().min(2000).max(2100) });
export type YtdParams = z.output<typeof ytdParams>;

/** Exported for the tests; the import itself goes through `ytdImport`. */
export async function resolveYtdRows(rows: Row[], user: { principal: Parameters<typeof canManageCompensation>[0] }, params: YtdParams, executor: Tx | ReturnType<typeof db> = db()): Promise<{ problems: Problem[]; resolved: Resolved[] }> {
  const problems: Problem[] = [];
  const resolved: Resolved[] = [];
  const header = ytdColumns.employeeCode.headers[0];
  const facts = await listPayrollFacts({ entityIds: [params.entityId] }, `${params.year}-12`, executor);
  const byCode = new Map(facts.flatMap((fact) => (fact.employeeCode ? [[fact.employeeCode.toUpperCase(), fact] as const] : [])));
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, taxableIncome, taxWithheld } = row.values;
    if (!employeeCode || taxableIncome === null || taxWithheld === null) continue;
    const person = byCode.get(employeeCode);
    // Somebody of another entity, or outside the importer's reach, is simply not found here.
    if (!person || !canManageCompensation(user.principal, { entityId: params.entityId })) {
      problems.push({ row: row.row, column: header, code: "person_not_found" });
      continue;
    }
    if (seen.has(person.personId)) {
      problems.push({ row: row.row, column: header, code: "duplicate_person" });
      continue;
    }
    seen.add(person.personId);

    const figures: YtdFigures = {
      taxableIncome,
      insuranceDeduction: row.values.insuranceDeduction ?? 0,
      personalDeduction: row.values.personalDeduction ?? 0,
      dependentDeduction: row.values.dependentDeduction ?? 0,
      otherDeductions: row.values.otherDeductions ?? 0,
      assessableIncome: row.values.assessableIncome ?? 0,
      taxWithheld,
    };
    // A year that withheld tax on nothing is a typing mistake, not a filing.
    if (figures.taxWithheld > 0 && figures.taxableIncome === 0) problems.push({ row: row.row, column: ytdColumns.taxableIncome.headers[0], code: "tax_without_income" });

    resolved.push({ row, personId: person.personId, entityId: params.entityId, months: row.values.months ?? 0, figures, note: row.values.note ?? null });
  }

  return { problems, resolved };
}

export const ytdImport = defineImport({
  kind: "payroll_ytd",
  // A spreadsheet of people's pay: compensation tier, so it asks who you are again (FR-PLT-06).
  stepUp: true,
  columns: ytdColumns,
  params: ytdParams,
  authorize: (user, params) => !!params && canManageCompensation(user.principal, { entityId: params.entityId }),
  validate: async (rows, user, params) => (await resolveYtdRows(rows, user, params)).problems,
  commit: async (rows, tx, user, params, batchId) => {
    const { resolved } = await resolveYtdRows(rows, user, params, tx);
    for (const line of resolved) {
      const saved = await saveYtd(tx, { personId: line.personId, entityId: line.entityId, year: params.year, months: line.months, figures: line.figures, note: line.note }, user.person.id);
      if (batchId) await tx.update(schema.payrollYtd).set({ importBatchId: batchId }).where(eq(schema.payrollYtd.id, saved.id));
    }
    return { people: resolved.length, year: params.year };
  },
});
