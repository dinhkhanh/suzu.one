// KPI actuals in bulk (FR-PRF-02, FR-PLT-36): one line per person, KPI and period, as HR keeps
// them in a spreadsheet. HR only (`performance:manage`); managers use the entry grid. A re-import
// overwrites an open month's figure; a closed month refuses the whole file.
import "server-only";
import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { code, type Column, type ParsedRow, type Problem, templateCsv, text } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import { can, type Principal } from "../platform/rbac/policy";
import { coversMonth, type KpiFrequency, type KpiUnit, MONTH_KEY, parseMetricValue, periodFits, QUARTER_KEY, scoringMonthOf } from "./enums";
import { isKpiMonthClosed, saveActuals } from "./kpi-scores";
import { loadDirectory } from "./people";
import { canEnterActualsFor } from "./policy";

const period = (cell: string) => {
  const value = cell.trim().toUpperCase();
  return MONTH_KEY.test(value) || QUARTER_KEY.test(value) ? { ok: true as const, value } : { ok: false as const, code: "bad_kpi_period" };
};
// Kept as typed ("4,5") so that the preview reads like the file; the unit decides the scale at commit.
const figure = (cell: string) => (/^\d{1,15}(?:[.,]\d{1,3})*(?:[.,]\d{1,2})?$/.test(cell.trim().replace(/\s/g, "")) ? { ok: true as const, value: cell.trim().replace(/\s/g, "") } : { ok: false as const, code: "bad_kpi_value" });

export const kpiActualColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  kpiCode: { headers: ["Mã KPI", "KPI code"], required: true, parse: code(40), example: "ON_TIME_DELIVERY" } as Column<string>,
  period: { headers: ["Kỳ", "Period"], required: true, parse: period, example: "2027-01" } as Column<string>,
  actual: { headers: ["Thực đạt", "Actual"], required: true, parse: figure, example: "92,5" } as Column<string>,
  note: { headers: ["Ghi chú", "Note"], parse: text(500), example: "Theo báo cáo tháng của phòng" } as Column<string>,
};

export const kpiActualTemplate = () => templateCsv(kpiActualColumns);

type Row = ParsedRow<typeof kpiActualColumns>;
type Resolved = { row: Row; assignmentId: string; periodKey: string; actual: string; note: string | null };
type Importer = { principal: Principal };

/** Exported for the service tests; the import itself goes through `kpiActualImport`. */
export async function resolveKpiActualRows(rows: Row[], user: Importer, executor: Tx | ReturnType<typeof db> = db()): Promise<{ problems: Problem[]; resolved: Resolved[] }> {
  const problems: Problem[] = [];
  const resolved: Resolved[] = [];
  const headers = { code: kpiActualColumns.employeeCode.headers[0], kpi: kpiActualColumns.kpiCode.headers[0], period: kpiActualColumns.period.headers[0], actual: kpiActualColumns.actual.headers[0] };
  const [people, directory, kpis] = await Promise.all([listEmploymentFacts({ employeeCodes: rows.flatMap((row) => (row.values.employeeCode ? [row.values.employeeCode] : [])) }, executor), loadDirectory(executor), executor.select().from(schema.kpiDefinition)]);
  const byCode = new Map(people.flatMap((person) => (person.employeeCode ? [[person.employeeCode.toUpperCase(), person] as const] : [])));
  const kpiByCode = new Map(kpis.map((kpi) => [kpi.code.toUpperCase(), kpi]));
  const personIds = [...new Set(people.map((person) => person.personId))];
  const assignments = personIds.length === 0 ? [] : await executor.select().from(schema.kpiAssignment).where(inArray(schema.kpiAssignment.personId, personIds));
  const closed = new Map<string, boolean>();
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, kpiCode, period: periodKey, actual, note } = row.values;
    if (!employeeCode || !kpiCode || !periodKey || !actual) continue;
    const person = byCode.get(employeeCode);
    const context = person ? directory.get(person.personId) : undefined;
    // Someone outside the importer's reach — or the importer themself — looks exactly like someone who does not exist.
    if (!person || !context || !can(user.principal, "performance:manage", context) || !canEnterActualsFor(user.principal, context)) {
      problems.push({ row: row.row, column: headers.code, code: "person_not_found" });
      continue;
    }
    const kpi = kpiByCode.get(kpiCode);
    if (!kpi) {
      problems.push({ row: row.row, column: headers.kpi, code: "kpi_unknown", detail: kpiCode });
      continue;
    }
    if (!periodFits(kpi.frequency as KpiFrequency, periodKey)) {
      problems.push({ row: row.row, column: headers.period, code: kpi.frequency === "monthly" ? "kpi_period_must_be_month" : "kpi_period_must_be_quarter" });
      continue;
    }
    const month = scoringMonthOf(periodKey);
    const assignment = assignments.find((candidate) => candidate.personId === person.personId && candidate.kpiId === kpi.id && coversMonth(candidate, month));
    if (!assignment) {
      problems.push({ row: row.row, column: headers.kpi, code: "kpi_not_assigned", detail: `${kpiCode} · ${periodKey}` });
      continue;
    }
    const closedKey = `${assignment.entityId}:${month}`;
    if (!closed.has(closedKey)) closed.set(closedKey, await isKpiMonthClosed(assignment.entityId, month, executor));
    if (closed.get(closedKey)) problems.push({ row: row.row, column: headers.period, code: "kpi_month_closed", detail: month });
    if (parseMetricValue(kpi.unit as KpiUnit, actual) === null) problems.push({ row: row.row, column: headers.actual, code: "bad_kpi_value" });
    const key = `${assignment.id}:${periodKey}`;
    if (seen.has(key)) problems.push({ row: row.row, column: headers.kpi, code: "duplicate_in_file" });
    seen.add(key);
    resolved.push({ row, assignmentId: assignment.id, periodKey, actual, note: note ?? null });
  }
  return { problems, resolved };
}

export async function commitKpiActualRows(rows: Row[], tx: Tx, user: Importer & { person: { id: string } }): Promise<{ saved: number; unchanged: number; people: number }> {
  const { resolved } = await resolveKpiActualRows(rows, user, tx);
  const result = await saveActuals(user.person.id, resolved.map((item) => ({ assignmentId: item.assignmentId, periodKey: item.periodKey, actual: item.actual, notApplicable: false, note: item.note })), "import", tx);
  return { saved: result.saved, unchanged: result.unchanged, people: result.personIds.length };
}

export const kpiActualImport = defineImport({
  kind: "kpi_actuals",
  columns: kpiActualColumns,
  authorize: (user) => can(user.principal, "performance:manage"),
  validate: async (rows, user) => (await resolveKpiActualRows(rows, user)).problems,
  commit: (rows, tx, user) => commitKpiActualRows(rows, tx, user),
  onCommitted: () => revalidatePath("/performance", "layout"),
});
