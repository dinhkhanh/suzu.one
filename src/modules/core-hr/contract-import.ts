// Labour contracts in bulk (FR-PLT-36, CHR-02) — for roll-out, where every contract on paper would
// otherwise be typed in one at a time. One row per contract of a person already on the books; each
// goes through `createContract`, the same code path and the same legal checks as the form, into the
// employment running on its first day. The check is that same write, rolled back. Pay terms are not
// imported: they are compensation tier and are entered by hand by those who may read them.
import "server-only";
import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { type Column, day, oneOf, type ParsedRow, type Problem, templateCsv, text } from "@/modules/platform/import/engine/table";
import { defineImport } from "@/modules/platform/import/service";
import { can } from "@/modules/platform/rbac/policy";
import type { ContractType, JobCategory } from "./engine/contract-rules";
import { normalizeEmployeeCode } from "./engine/employee-code";
import { createContract } from "./records";
import { getPersonTargets } from "./service";

const column = <Value>(definition: Column<Value>) => definition;

export const contractColumns = {
  employeeCode: column<string>({ headers: ["Mã nhân viên", "Employee code", "Mã NV"], required: true, parse: text(30), example: "SZM-0004" }),
  number: column<string>({ headers: ["Số hợp đồng", "Contract number", "Số HĐ"], required: true, parse: text(60), example: "08/2024/HĐLĐ-SZM" }),
  type: column<ContractType>({
    headers: ["Loại hợp đồng", "Contract type"],
    required: true,
    parse: oneOf<ContractType>({
      probation: ["Thử việc", "HĐ thử việc", "Probation"],
      fixed_term: ["Xác định thời hạn", "HĐLĐ xác định thời hạn", "Có thời hạn", "Fixed term", "Fixed-term"],
      indefinite: ["Không xác định thời hạn", "HĐLĐ không xác định thời hạn", "Vô thời hạn", "Indefinite"],
      service: ["Dịch vụ", "Hợp đồng dịch vụ", "Service"],
      internship: ["Thực tập", "Internship"],
      nda: ["Bảo mật", "Cam kết bảo mật", "NDA"],
      appendix: [],
    }),
    example: "Xác định thời hạn",
  }),
  jobCategory: column<JobCategory>({
    headers: ["Nhóm công việc (thử việc)", "Job category"],
    parse: oneOf<JobCategory>({ manager: ["Quản lý", "Manager"], professional: ["Chuyên môn", "Cao đẳng trở lên", "Professional"], intermediate: ["Trung cấp", "Intermediate"], other: ["Khác", "Other"] }),
    example: "",
  }),
  signDate: column<string>({ headers: ["Ngày ký", "Signed on"], parse: day, example: "28/06/2024" }),
  startDate: column<string>({ headers: ["Từ ngày", "From"], required: true, parse: day, example: "01/07/2024" }),
  endDate: column<string>({ headers: ["Đến ngày", "To"], parse: day, example: "30/06/2025" }),
  note: column<string>({ headers: ["Ghi chú", "Note"], parse: text(500), example: "" }),
};

export const contractTemplate = () => templateCsv(contractColumns);

type Row = ParsedRow<typeof contractColumns>;
const header = (field: keyof typeof contractColumns) => contractColumns[field].headers[0];

// What the contract rules' refusals are called in the problem list, and which column they are about.
const PROBLEMS: Record<string, [keyof typeof contractColumns, string]> = {
  contract_number_taken: ["number", "contract_number_taken"],
  contract_overlap: ["startDate", "contract_overlap"],
  contract_end_before_start: ["endDate", "contract_rule"],
  contract_indefinite_has_end: ["endDate", "contract_rule"],
  contract_end_required: ["endDate", "contract_rule"],
  contract_fixed_term_too_long: ["endDate", "contract_rule"],
  contract_must_be_indefinite: ["type", "contract_rule"],
  contract_job_category_required: ["jobCategory", "contract_rule"],
  contract_probation_too_long: ["endDate", "contract_rule"],
  contract_probation_repeated: ["type", "contract_rule"],
  contract_appendix_needs_parent: ["type", "contract_rule"],
  contract_parent_not_found: ["type", "contract_rule"],
  no_employment: ["employeeCode", "person_not_found"],
};

/** Writes the rows on `tx`, each in a savepoint, oldest first per person (the fixed-term count depends on order). */
async function applyRows(rows: Row[], tx: Tx, user: CurrentUser): Promise<{ problems: Problem[]; contracts: number }> {
  const problems: Problem[] = [];
  const flag = (row: number, field: keyof typeof contractColumns, problem: string) => problems.push({ row, column: header(field), code: problem });

  const codes = [...new Set(rows.flatMap(({ values }) => (values.employeeCode ? [normalizeEmployeeCode(values.employeeCode)] : [])))];
  const employments = codes.length ? await tx.select({ personId: schema.employment.personId, employeeCode: schema.employment.employeeCode }).from(schema.employment).where(inArray(schema.employment.employeeCode, codes)) : [];
  // Codes are unique per entity only: one that two people share names nobody.
  const peopleByCode = new Map<string, Set<string>>();
  for (const row of employments) peopleByCode.set(row.employeeCode, (peopleByCode.get(row.employeeCode) ?? new Set()).add(row.personId));
  const personOf = (value: string) => {
    const found = peopleByCode.get(normalizeEmployeeCode(value));
    return found?.size === 1 ? [...found][0] : null;
  };
  const targets = await getPersonTargets([...new Set(rows.flatMap(({ values }) => (values.employeeCode ? [personOf(values.employeeCode)] : [])).filter((id): id is string => !!id))], tx);

  const resolved: { row: Row; personId: string }[] = [];
  for (const row of rows) {
    const personId = row.values.employeeCode ? personOf(row.values.employeeCode) : null;
    const target = personId ? targets.get(personId) : undefined;
    // Someone outside the importer's reach looks exactly like someone who does not exist.
    if (!personId || !target || !can(user.principal, "person:manage", target)) flag(row.row, "employeeCode", "person_not_found");
    else resolved.push({ row, personId });
  }
  resolved.sort((a, b) => a.personId.localeCompare(b.personId) || a.row.values.startDate!.localeCompare(b.row.values.startDate!) || a.row.row - b.row.row);

  let contracts = 0;
  for (const { row, personId } of resolved) {
    const { values } = row;
    try {
      await tx.transaction((savepoint) =>
        createContract(
          personId,
          { number: values.number!, type: values.type!, parentContractId: null, jobCategory: values.jobCategory, signDate: values.signDate, startDate: values.startDate!, endDate: values.endDate, salaryTerms: null, note: values.note },
          user.person.id,
          savepoint as unknown as Tx,
        ),
      );
      contracts++;
    } catch (error) {
      const refusal = error instanceof ActionError ? error.message : constraintOf(error) === "contract_entity_number_key" ? "contract_number_taken" : null;
      const problem = refusal ? PROBLEMS[refusal] : undefined;
      if (!problem) throw error;
      flag(row.row, problem[0], problem[1]);
    }
  }
  return { problems, contracts };
}

function constraintOf(error: unknown): string | null {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const details = cause as { constraint_name?: string; constraint?: string };
    if (details.constraint_name ?? details.constraint) return details.constraint_name ?? details.constraint ?? null;
  }
  return null;
}

const DRY_RUN = Symbol("dry run");

/** The check: every row written as the commit would, then rolled back. Exported for the tests. */
export async function checkContractRows(rows: Row[], user: CurrentUser): Promise<Problem[]> {
  let problems: Problem[] = [];
  try {
    await db().transaction(async (tx) => {
      problems = (await applyRows(rows, tx, user)).problems;
      throw DRY_RUN;
    });
  } catch (error) {
    if (error !== DRY_RUN) throw error;
  }
  return problems;
}

export const contractImport = defineImport({
  kind: "contracts",
  columns: contractColumns,
  // Anyone who may manage people somewhere; whom exactly is checked per row.
  authorize: (user) => can(user.principal, "person:manage"),
  validate: checkContractRows,
  commit: async (rows, tx, user) => {
    const { problems, contracts } = await applyRows(rows, tx, user);
    if (problems.length) throw new ActionError("import_stale");
    return { contracts };
  },
  onCommitted: async () => {
    revalidatePath("/people", "layout");
  },
});
