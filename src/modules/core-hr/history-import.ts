// Past work history in bulk (FR-PLT-36, DR-02) — the roll-out companion of the employee import:
// people already on the books, one row per period that is over. Every row goes through
// `recordPastAssignmentInTransaction`, the same code path as the form on the person's page, a
// person's rows oldest first. The check is that same write, rolled back: whatever the preview
// accepts is exactly what the commit will do.
import "server-only";
import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { POSITION_SPELLINGS, type PositionLevel, SENIORITY_SPELLINGS, type SeniorityLevel } from "@/lib/job-levels";
import { toSearchKey } from "@/lib/text";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { code, type Column, day, oneOf, type ParsedRow, type Problem, templateCsv, text } from "@/modules/platform/import/engine/table";
import { defineImport } from "@/modules/platform/import/service";
import { can } from "@/modules/platform/rbac/policy";
import { normalizeEmployeeCode } from "./engine/employee-code";
import { getPersonTargets, invalidatePositions, recordPastAssignmentInTransaction, type WorkforceType } from "./service";

const column = <Value>(definition: Column<Value>) => definition;
const optionalText = (headers: readonly [string, ...string[]], max: number, example = "") => column<string>({ headers, parse: text(max), example });

export const historyColumns = {
  employeeCode: column<string>({ headers: ["Mã nhân viên", "Employee code", "Mã NV"], required: true, parse: code(30), example: "SZM-0004" }),
  validFrom: column<string>({ headers: ["Từ ngày", "From"], required: true, parse: day, example: "01/03/2019" }),
  validTo: column<string>({ headers: ["Đến ngày", "To"], required: true, parse: day, example: "31/12/2020" }),
  departmentCode: column<string>({ headers: ["Phòng ban (mã)", "Department code", "Phòng ban"], parse: code(12), example: "VID" }),
  teamName: optionalText(["Nhóm", "Team"], 120),
  positionName: optionalText(["Chức vụ", "Position", "Vị trí", "Chức danh"], 120, "Dựng phim"),
  seniorityLevel: column<SeniorityLevel>({ headers: ["Cấp bậc", "Seniority level", "Job level"], parse: oneOf<SeniorityLevel>(SENIORITY_SPELLINGS), example: "Senior" }),
  positionLevel: column<PositionLevel>({ headers: ["Cấp vị trí", "Position level"], parse: oneOf<PositionLevel>(POSITION_SPELLINGS), example: "Executive" }),
  workforceType: column<WorkforceType>({
    headers: ["Loại lao động", "Workforce type"],
    parse: oneOf<WorkforceType>({ employee: ["Chính thức", "Nhân viên chính thức"], probation: ["Thử việc"], intern: ["Thực tập", "Thực tập sinh"], part_time: ["Bán thời gian", "Part-time"], collaborator: ["Cộng tác viên", "CTV", "Freelancer"], advisor: ["Cố vấn"] }),
    example: "Chính thức",
  }),
  manager: optionalText(["Quản lý trực tiếp (mã NV hoặc email)", "Manager (employee code or email)", "Quản lý trực tiếp", "Manager"], 200, "long.dang@suzu.group"),
  changeReason: optionalText(["Ghi chú", "Note", "Lý do"], 300, "Theo hồ sơ giấy"),
};

export const historyTemplate = () => templateCsv(historyColumns);

type Row = ParsedRow<typeof historyColumns>;
const header = (field: keyof typeof historyColumns) => historyColumns[field].headers[0];

// What the service's refusals are called in the import's problem list, and which column they are about.
const PROBLEMS: Record<string, [keyof typeof historyColumns, string]> = {
  assignment_period_reversed: ["validTo", "period_reversed"],
  assignment_not_ended: ["validTo", "not_ended"],
  assignment_before_employment_start: ["validFrom", "outside_employment"],
  assignment_after_employment_end: ["validTo", "outside_employment"],
  no_employment: ["employeeCode", "outside_employment"],
  assignment_covers_recorded_period: ["validFrom", "covers_recorded_period"],
  assignment_inside_recorded_period: ["validFrom", "inside_recorded_period"],
  assignment_moves_recorded_event: ["validTo", "moves_recorded_event"],
  assignment_conflict: ["validFrom", "covers_recorded_period"],
  unit_not_in_entity: ["departmentCode", "department_not_in_entity"],
  manager_is_self: ["manager", "manager_is_self"],
  manager_not_found: ["manager", "manager_not_found"],
};

/**
 * Writes the rows on `tx`, each in a savepoint so that one refused row does not stop the others
 * from being checked. Returns the problems, and what was written.
 */
async function applyRows(rows: Row[], tx: Tx, user: CurrentUser): Promise<{ problems: Problem[]; periods: number; adjusted: number }> {
  const problems: Problem[] = [];
  const flag = (row: number, field: keyof typeof historyColumns, problem: string) => problems.push({ row, column: header(field), code: problem });

  const codes = [...new Set(rows.flatMap(({ values }) => [values.employeeCode, values.manager && !values.manager.includes("@") ? normalizeEmployeeCode(values.manager) : null]).filter((value): value is string => !!value))];
  const emails = [...new Set(rows.flatMap(({ values }) => (values.manager?.includes("@") ? [values.manager.toLowerCase()] : [])))];
  const [employments, byEmail, units] = await Promise.all([
    codes.length ? tx.select({ personId: schema.employment.personId, employeeCode: schema.employment.employeeCode }).from(schema.employment).where(inArray(schema.employment.employeeCode, codes)) : [],
    emails.length ? tx.select({ id: schema.person.id, workEmail: schema.person.workEmail }).from(schema.person).where(inArray(schema.person.workEmail, emails)) : [],
    tx.select({ id: schema.orgUnit.id, code: schema.orgUnit.code, name: schema.orgUnit.name, parentId: schema.orgUnit.parentId, path: schema.orgUnit.path }).from(schema.orgUnit),
  ]);
  // Codes are unique per entity only: one that two people share names nobody.
  const peopleByCode = new Map<string, Set<string>>();
  for (const row of employments) peopleByCode.set(row.employeeCode, (peopleByCode.get(row.employeeCode) ?? new Set()).add(row.personId));
  const personOf = (value: string) => {
    const found = peopleByCode.get(normalizeEmployeeCode(value));
    return found?.size === 1 ? [...found][0] : null;
  };
  const targets = await getPersonTargets([...new Set(rows.flatMap(({ values }) => (values.employeeCode ? [personOf(values.employeeCode)] : [])).filter((id): id is string => !!id))], tx);
  const departments = new Map(units.flatMap((unit) => (unit.code ? [[unit.code, unit] as const] : [])));

  const resolved: { row: Row; personId: string }[] = [];
  for (const row of rows) {
    const personId = row.values.employeeCode ? personOf(row.values.employeeCode) : null;
    const target = personId ? targets.get(personId) : undefined;
    // Someone outside the importer's reach looks exactly like someone who does not exist.
    if (!personId || !target || !can(user.principal, "person:manage", target)) flag(row.row, "employeeCode", "person_not_found");
    else resolved.push({ row, personId });
  }
  // A person's periods oldest first: each then carves its days off the row the roll-out import left.
  resolved.sort((a, b) => a.personId.localeCompare(b.personId) || a.row.values.validFrom!.localeCompare(b.row.values.validFrom!) || a.row.row - b.row.row);

  let periods = 0;
  let adjusted = 0;
  for (const { row, personId } of resolved) {
    const { values } = row;
    const target = targets.get(personId)!;
    const department = values.departmentCode ? departments.get(values.departmentCode) : undefined;
    if (values.departmentCode && !department) {
      flag(row.row, "departmentCode", "department_not_found");
      continue;
    }
    const unit = values.teamName ? units.find((candidate) => candidate.parentId === department?.id && toSearchKey(candidate.name) === toSearchKey(values.teamName!)) : department;
    if (values.teamName && !unit) {
      flag(row.row, "teamName", "team_not_found");
      continue;
    }
    if (unit && !can(user.principal, "person:manage", { entityId: target.entityId, unitPath: unit.path })) {
      flag(row.row, "departmentCode", "out_of_reach");
      continue;
    }
    let managerId: string | null = null;
    if (values.manager) {
      managerId = values.manager.includes("@") ? (byEmail.find((person) => person.workEmail === values.manager!.toLowerCase())?.id ?? null) : personOf(values.manager);
      if (!managerId) {
        flag(row.row, "manager", "manager_not_found");
        continue;
      }
    }

    try {
      const written = await tx.transaction((savepoint) =>
        recordPastAssignmentInTransaction(
          savepoint as unknown as Tx,
          personId,
          {
            validFrom: values.validFrom!,
            validTo: values.validTo!,
            changeReason: values.changeReason,
            placement: { workforceType: values.workforceType ?? "employee", branchId: null, orgUnitId: unit?.id ?? null, positionName: values.positionName, seniorityLevel: values.seniorityLevel, positionLevel: values.positionLevel, managerId, dottedManagerId: null, workLocation: null },
          },
          user.person.id,
        ),
      );
      periods++;
      if (written.shortened || written.delayed) adjusted++;
    } catch (error) {
      const refusal = error instanceof ActionError ? error.message : constraintOf(error) === "assignment_primary_no_overlap" ? "assignment_conflict" : null;
      const problem = refusal ? PROBLEMS[refusal] : undefined;
      if (!problem) throw error;
      flag(row.row, problem[0], problem[1]);
    }
  }
  return { problems, periods, adjusted };
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
export async function checkHistoryRows(rows: Row[], user: CurrentUser): Promise<Problem[]> {
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

export const historyImport = defineImport({
  kind: "work_history",
  columns: historyColumns,
  // Anyone who may manage people somewhere; whom exactly is checked per row.
  authorize: (user) => can(user.principal, "person:manage"),
  validate: checkHistoryRows,
  commit: async (rows, tx, user) => {
    const { problems, periods, adjusted } = await applyRows(rows, tx, user);
    if (problems.length) throw new ActionError("import_stale");
    return { periods, adjusted };
  },
  onCommitted: async () => {
    // A row may have named a new position.
    await invalidatePositions();
    revalidatePath("/people", "layout");
  },
});
