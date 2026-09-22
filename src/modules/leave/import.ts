// Opening balances in bulk (FR-LVE-07, FR-PLT-36): what each person had left on the day the
// ledger starts. One `opening` row per person, type and year; the accrual job then leaves out the
// months such a balance already contains. The ledger must reconcile with this file (Phase 2 exit).
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { code, type Column, day, integer, type ParsedRow, type Problem, templateCsv, text } from "@/modules/platform/import/engine/table";
import { defineImport } from "@/modules/platform/import/service";
import { can } from "@/modules/platform/rbac/policy";
import { postEntry } from "./ledger";
import { allLeaveTypes, leaveTypesOf } from "./types";

// "7", "7.5", "7,5" → "7.5": kept as days so that the preview reads like the file; the commit turns
// it into hundredths of a day. Balances may be negative (leave taken in advance).
const days = (cell: string) => {
  const match = /^(-?)(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(cell.trim());
  if (!match) return { ok: false as const, code: "bad_days" };
  const centi = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
  return { ok: true as const, value: String((match[1] ? -centi : centi) / 100) };
};

export const openingBalanceColumns = {
  employeeCode: { headers: ["Mã nhân viên", "Employee code"], required: true, parse: code(24), example: "SZM-0004" } as Column<string>,
  typeCode: { headers: ["Loại phép (mã)", "Leave type code"], required: true, parse: code(24), example: "ANNUAL" } as Column<string>,
  year: { headers: ["Năm", "Year"], required: true, parse: integer, example: "2026" } as Column<number>,
  days: { headers: ["Số ngày còn lại", "Days remaining"], required: true, parse: days, example: "7,5" } as Column<string>,
  asOf: { headers: ["Tính đến ngày", "As at"], parse: day, example: "2026-01-01" } as Column<string>,
  note: { headers: ["Ghi chú", "Note"], parse: text(200), example: "Chuyển từ bảng theo dõi phép 2025" } as Column<string>,
};

export const openingBalanceTemplate = () => templateCsv(openingBalanceColumns);

type Row = ParsedRow<typeof openingBalanceColumns>;
type Resolved = { row: Row; personId: string; entityId: string | null; leaveTypeId: string; asOf: string };

/** Exported for the service tests; the import itself goes through `openingBalanceImport`. */
export async function resolveOpeningRows(rows: Row[], user: { principal: Parameters<typeof can>[0] }, executor: Tx | ReturnType<typeof db> = db()): Promise<{ problems: Problem[]; resolved: Resolved[] }> {
  const problems: Problem[] = [];
  const resolved: Resolved[] = [];
  const headers = { code: openingBalanceColumns.employeeCode.headers[0], type: openingBalanceColumns.typeCode.headers[0], year: openingBalanceColumns.year.headers[0], asOf: openingBalanceColumns.asOf.headers[0] };
  const [people, allTypes] = await Promise.all([listEmploymentFacts({ employeeCodes: rows.flatMap((row) => (row.values.employeeCode ? [row.values.employeeCode] : [])) }, executor), allLeaveTypes(executor)]);
  const byCode = new Map(people.flatMap((person) => (person.employeeCode ? [[person.employeeCode.toUpperCase(), person] as const] : [])));
  const typesByEntity = new Map<string | null, ReturnType<typeof leaveTypesOf>>();
  const seen = new Set<string>();

  for (const row of rows) {
    const { employeeCode, typeCode, year, asOf } = row.values;
    if (!employeeCode || !typeCode || year === null) continue;
    if (year < 2000 || year > 2100) problems.push({ row: row.row, column: headers.year, code: "bad_year" });
    const person = byCode.get(employeeCode);
    // Someone outside the importer's reach looks exactly like someone who does not exist.
    if (!person || !can(user.principal, "leave:manage", person)) {
      problems.push({ row: row.row, column: headers.code, code: "person_not_found" });
      continue;
    }
    if (!typesByEntity.has(person.entityId)) typesByEntity.set(person.entityId, leaveTypesOf(allTypes, person.entityId, { includeInactive: true }));
    const type = typesByEntity.get(person.entityId)!.find((candidate) => candidate.code === typeCode);
    if (!type) problems.push({ row: row.row, column: headers.type, code: "leave_type_not_found" });
    else if (!type.tracksBalance) problems.push({ row: row.row, column: headers.type, code: "leave_type_keeps_no_balance" });
    if (asOf && Number(asOf.slice(0, 4)) !== year) problems.push({ row: row.row, column: headers.asOf, code: "as_of_outside_year" });
    const key = `${person.personId}:${typeCode}:${year}`;
    if (seen.has(key)) problems.push({ row: row.row, column: headers.code, code: "duplicate_in_file" });
    seen.add(key);
    if (type?.tracksBalance) resolved.push({ row, personId: person.personId, entityId: person.entityId, leaveTypeId: type.id, asOf: asOf ?? `${year}-01-01` });
  }

  // One opening balance per person, type and year: a second one would double the balance.
  if (resolved.length > 0) {
    const existing = await executor
      .select({ personId: schema.leaveLedgerEntry.personId, leaveTypeId: schema.leaveLedgerEntry.leaveTypeId, leaveYear: schema.leaveLedgerEntry.leaveYear })
      .from(schema.leaveLedgerEntry)
      .where(and(eq(schema.leaveLedgerEntry.kind, "opening"), inArray(schema.leaveLedgerEntry.personId, [...new Set(resolved.map((item) => item.personId))])));
    for (const item of resolved) {
      if (existing.some((entry) => entry.personId === item.personId && entry.leaveTypeId === item.leaveTypeId && entry.leaveYear === item.row.values.year)) problems.push({ row: item.row.row, column: headers.code, code: "opening_exists" });
    }
  }
  return { problems, resolved };
}

export const openingBalanceImport = defineImport({
  kind: "leave_opening_balances",
  columns: openingBalanceColumns,
  authorize: (user) => can(user.principal, "leave:manage"),
  validate: async (rows, user) => (await resolveOpeningRows(rows, user)).problems,
  commit: (rows, tx, user) => commitOpeningRows(rows, tx, user),
  onCommitted: () => revalidatePath("/leave", "layout"),
});

export async function commitOpeningRows(rows: Row[], tx: Tx, user: { principal: Parameters<typeof can>[0]; person: { id: string } }): Promise<{ posted: number; totalCenti: number }> {
  {
    const { resolved } = await resolveOpeningRows(rows, user, tx);
    let posted = 0;
    let totalCenti = 0;
    for (const item of resolved) {
      const { year, note } = item.row.values;
      const amount = Math.round(Number(item.row.values.days) * 100);
      const entry = await postEntry(tx, { personId: item.personId, entityId: item.entityId, leaveTypeId: item.leaveTypeId, leaveYear: year!, kind: "opening", amountCenti: amount, effectiveDate: item.asOf, sourceKey: `opening:${item.personId}:${item.leaveTypeId}:${year}`, reason: note ?? "Số dư đầu kỳ (nhập từ tệp)", createdByPersonId: user.person.id });
      if (entry) {
        posted++;
        totalCenti += amount;
      }
    }
    // The file's total, so that HR can tick it against the spreadsheet.
    return { posted, totalCenti };
  }
}
