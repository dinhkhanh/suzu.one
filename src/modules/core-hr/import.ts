// Employees in bulk (FR-PLT-36) — the data migration out of HR's spreadsheet. New people only:
// someone already on the books is a problem row, not an update. Every row goes through the same
// code path as the hire form; the restricted cells are encrypted while the batch waits for its
// commit (the import framework's `sensitive` columns) and masked in the preview.
import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { toSearchKey } from "@/lib/text";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { emailDomain } from "@/modules/platform/auth/sign-in-policy";
import { invalidatePeople } from "@/modules/platform/people/service";
import { code, type Column, day, email, oneOf, type ParsedRow, type Problem, templateCsv, text } from "@/modules/platform/import/engine/table";
import { defineImport } from "@/modules/platform/import/service";
import { can } from "@/modules/platform/rbac/policy";
import { todayInVietnam } from "@/lib/dates";
import { normalizeEmployeeCode } from "./engine/employee-code";
import { normalizeIdNumber } from "./field-contexts";
import { nationalIdsOnFile, updateSensitiveFields } from "./records";
import { hireInTransaction, invalidatePositions, type WorkforceType } from "./service";

const column = <Value>(definition: Column<Value>) => definition;
const optionalText = (headers: readonly [string, ...string[]], max: number, example = "") => column<string>({ headers, parse: text(max), example });
const sensitive = (headers: readonly [string, ...string[]], max: number, example = "") => column<string>({ headers, parse: text(max), sensitive: true, example });

export const employeeColumns = {
  employeeCode: column<string>({ headers: ["Mã nhân viên", "Employee code", "Mã NV"], parse: code(30), example: "" }),
  fullName: column<string>({ headers: ["Họ và tên", "Full name", "Họ tên"], required: true, parse: text(120), example: "Nguyễn Văn An" }),
  workEmail: column<string>({ headers: ["Email công việc", "Work email", "Email"], parse: email, example: "an.nguyen@suzu.group" }),
  entityCode: column<string>({ headers: ["Pháp nhân (mã)", "Entity code", "Công ty"], required: true, parse: code(12), example: "SZM" }),
  departmentCode: column<string>({ headers: ["Phòng ban (mã)", "Department code", "Phòng ban"], parse: code(12), example: "VID" }),
  teamName: optionalText(["Nhóm", "Team"], 120),
  positionName: optionalText(["Chức danh", "Position", "Vị trí"], 120, "Dựng phim"),
  jobLevel: optionalText(["Cấp bậc", "Job level"], 60),
  workforceType: column<WorkforceType>({
    headers: ["Loại lao động", "Workforce type"],
    parse: oneOf<WorkforceType>({ employee: ["Chính thức", "Nhân viên chính thức"], probation: ["Thử việc"], intern: ["Thực tập", "Thực tập sinh"], part_time: ["Bán thời gian", "Part-time"], collaborator: ["Cộng tác viên", "CTV", "Freelancer"], advisor: ["Cố vấn"] }),
    example: "Chính thức",
  }),
  startDate: column<string>({ headers: ["Ngày vào làm", "Start date"], required: true, parse: day, example: "01/03/2024" }),
  seniorityDate: column<string>({ headers: ["Ngày tính thâm niên", "Seniority date"], parse: day, example: "" }),
  manager: optionalText(["Quản lý trực tiếp (mã NV hoặc email)", "Manager (employee code or email)", "Quản lý trực tiếp", "Manager"], 200, "long.dang@suzu.group"),
  dateOfBirth: column<string>({ headers: ["Ngày sinh", "Date of birth"], parse: day, example: "15/08/1996" }),
  gender: column<"male" | "female" | "other">({ headers: ["Giới tính", "Gender"], parse: oneOf({ male: ["Nam"], female: ["Nữ"], other: ["Khác"] }), example: "Nam" }),
  maritalStatus: column<"single" | "married" | "divorced" | "widowed">({ headers: ["Tình trạng hôn nhân", "Marital status"], parse: oneOf({ single: ["Độc thân"], married: ["Đã kết hôn", "Kết hôn"], divorced: ["Ly hôn"], widowed: ["Góa"] }), example: "" }),
  nationality: optionalText(["Quốc tịch", "Nationality"], 60, "Việt Nam"),
  // Format the phone column as text in Excel, or the leading zero is lost before the file gets here.
  phone: optionalText(["Số điện thoại", "Phone", "Điện thoại"], 30, "0901234567"),
  personalEmail: column<string>({ headers: ["Email cá nhân", "Personal email"], parse: email, example: "" }),
  permanentAddress: optionalText(["Địa chỉ thường trú", "Permanent address"], 300),
  currentAddress: optionalText(["Nơi ở hiện tại", "Current address"], 300),
  nationalId: sensitive(["Số CCCD", "Citizen ID", "CCCD", "CMND"], 40, "079201001234"),
  nationalIdIssuedOn: column<string>({ headers: ["Ngày cấp CCCD", "ID issue date"], parse: day, sensitive: true, example: "" }),
  nationalIdIssuedAt: sensitive(["Nơi cấp CCCD", "ID issued by"], 200),
  taxCode: sensitive(["Mã số thuế", "Tax code", "MST"], 40),
  socialInsuranceNumber: sensitive(["Số sổ BHXH", "Social insurance number", "Số BHXH"], 40),
  bankName: optionalText(["Ngân hàng", "Bank"], 120, "Vietcombank"),
  bankAccountNumber: sensitive(["Số tài khoản", "Bank account number", "STK"], 40),
  bankAccountHolder: optionalText(["Chủ tài khoản", "Account holder"], 120),
};

export const employeeTemplate = () => templateCsv(employeeColumns);

type Row = ParsedRow<typeof employeeColumns>;
type ManagerLink = { kind: "none" } | { kind: "row"; row: number } | { kind: "person"; personId: string } | { kind: "missing" };

const header = (field: keyof typeof employeeColumns) => employeeColumns[field].headers[0];
const looksLikeEmail = (value: string) => value.includes("@");

/**
 * Who each row's "manager" cell points at: another row of the file (the manager may sit further
 * down), someone already on the books, or nobody we can find. Codes are per entity, so a code is
 * looked for in the row's own entity first. Pure.
 */
export function linkManagers(rows: readonly Row[], existing: { personId: string; workEmail: string | null; employeeCode: string | null; entityCode: string | null }[]): Map<number, ManagerLink> {
  const links = new Map<number, ManagerLink>();
  for (const { row, values } of rows) {
    const reference = values.manager?.trim();
    if (!reference) {
      links.set(row, { kind: "none" });
      continue;
    }
    if (looksLikeEmail(reference)) {
      const wanted = reference.toLowerCase();
      const inFile = rows.find((candidate) => candidate.values.workEmail === wanted);
      const onBooks = existing.find((candidate) => candidate.workEmail === wanted);
      links.set(row, inFile ? { kind: "row", row: inFile.row } : onBooks ? { kind: "person", personId: onBooks.personId } : { kind: "missing" });
      continue;
    }
    const wanted = normalizeEmployeeCode(reference);
    const sameEntityFirst = <Candidate>(candidates: Candidate[], entityOf: (candidate: Candidate) => string | null) => candidates.find((candidate) => entityOf(candidate) === values.entityCode) ?? candidates[0];
    const inFile = sameEntityFirst(rows.filter((candidate) => candidate.values.employeeCode === wanted), (candidate) => candidate.values.entityCode);
    const onBooks = sameEntityFirst(existing.filter((candidate) => candidate.employeeCode === wanted), (candidate) => candidate.entityCode);
    links.set(row, inFile ? { kind: "row", row: inFile.row } : onBooks ? { kind: "person", personId: onBooks.personId } : { kind: "missing" });
  }
  return links;
}

// Takes the executor: the commit runs inside the import's transaction.
async function loadReferences(executor: Tx | ReturnType<typeof db> = db()) {
  const [entities, units, people] = await Promise.all([
    executor.select().from(schema.entity),
    executor.select().from(schema.orgUnit),
    executor
      .select({ personId: schema.person.id, workEmail: schema.person.workEmail, employeeCode: schema.employment.employeeCode, entityCode: schema.entity.code })
      .from(schema.person)
      .leftJoin(schema.employment, eq(schema.employment.personId, schema.person.id))
      .leftJoin(schema.entity, eq(schema.entity.id, schema.employment.entityId)),
  ]);
  // Departments are matched by code, teams by name inside the department they sit in.
  return { entities: new Map(entities.map((row) => [row.code, row])), departments: new Map(units.flatMap((row) => (row.code ? [[row.code, row] as const] : []))), units, people };
}

type UnitRef = { id: string; name: string; parentId: string | null; path: string[] };
const findTeam = (units: UnitRef[], parentId: string | undefined, name: string): UnitRef | undefined => units.find((unit) => unit.parentId === parentId && toSearchKey(unit.name) === toSearchKey(name));

async function validate(rows: Row[], user: CurrentUser): Promise<Problem[]> {
  const problems: Problem[] = [];
  const flag = (row: number, field: keyof typeof employeeColumns, problem: string) => problems.push({ row, column: header(field), code: problem });
  const { entities, departments, units, people } = await loadReferences();
  const emailsOnBooks = new Set(people.flatMap((person) => (person.workEmail ? [person.workEmail] : [])));
  const codesOnBooks = new Set(people.flatMap((person) => (person.employeeCode ? [`${person.entityCode}:${person.employeeCode}`] : [])));
  const idsOnBooks = await nationalIdsOnFile(rows.flatMap(({ values }) => (values.nationalId ? [values.nationalId] : [])));

  const seen = { email: new Set<string>(), code: new Set<string>(), nationalId: new Set<string>() };
  const once = (set: Set<string>, key: string) => (set.has(key) ? false : (set.add(key), true));

  for (const { row, values } of rows) {
    const entity = values.entityCode ? entities.get(values.entityCode) : undefined;
    const department = values.departmentCode ? departments.get(values.departmentCode) : undefined;
    if (values.entityCode && !entity?.isActive) flag(row, "entityCode", "entity_not_found");
    if (values.departmentCode && !department) flag(row, "departmentCode", "department_not_found");
    else if (department && entity && department.entityId !== null && department.entityId !== entity.id) flag(row, "departmentCode", "department_not_in_entity");
    const team = values.teamName ? findTeam(units, department?.id, values.teamName) : undefined;
    if (values.teamName && !team) flag(row, "teamName", "team_not_found");
    // The importer's authority is checked row by row: entity HR cannot slip people into another entity.
    if (entity && !can(user.principal, "person:manage", { entityId: entity.id, unitPath: (team ?? department)?.path ?? [] })) flag(row, "entityCode", "out_of_reach");

    if (values.workEmail) {
      if (!env().allowedWorkspaceDomains.includes(emailDomain(values.workEmail))) flag(row, "workEmail", "email_domain");
      else if (env().bootstrapOwnerEmails.includes(values.workEmail)) flag(row, "workEmail", "email_reserved");
      if (!once(seen.email, values.workEmail)) flag(row, "workEmail", "duplicate_in_file");
      if (emailsOnBooks.has(values.workEmail)) flag(row, "workEmail", "already_exists");
    }
    if (values.employeeCode) {
      const key = `${values.entityCode}:${normalizeEmployeeCode(values.employeeCode)}`;
      if (!once(seen.code, key)) flag(row, "employeeCode", "duplicate_in_file");
      if (codesOnBooks.has(key)) flag(row, "employeeCode", "already_exists");
    }
    if (values.nationalId) {
      const key = normalizeIdNumber(values.nationalId);
      if (!once(seen.nationalId, key)) flag(row, "nationalId", "duplicate_in_file");
      if (idsOnBooks.has(key)) flag(row, "nationalId", "already_exists");
    }
    if (values.seniorityDate && values.startDate && values.seniorityDate > values.startDate) flag(row, "seniorityDate", "seniority_after_start");
    if (!!values.bankAccountNumber !== !!values.bankName) flag(row, values.bankName ? "bankAccountNumber" : "bankName", "bank_incomplete");
  }

  const links = linkManagers(rows, people);
  for (const { row } of rows) {
    const link = links.get(row)!;
    if (link.kind === "missing") flag(row, "manager", "manager_not_found");
    // Only rows of the file can close a loop: nobody on the books reports to someone who is not there yet.
    let cursor = link;
    for (let depth = 0; cursor.kind === "row" && depth <= rows.length; depth++) {
      if (cursor.row === row) {
        flag(row, "manager", depth === 0 ? "manager_is_self" : "manager_loop");
        break;
      }
      cursor = links.get(cursor.row)!;
    }
  }
  return problems;
}

export const employeeImport = defineImport({
  kind: "employees",
  columns: employeeColumns,
  // Anyone who may add people somewhere; where exactly is checked per row.
  authorize: (user) => can(user.principal, "person:manage"),
  validate,
  commit: async (rows, tx, user) => {
    const { entities, departments, units, people } = await loadReferences(tx);
    const links = linkManagers(rows, people);
    const created = new Map<number, { personId: string; assignmentId: string }>();
    let withRestricted = 0;

    for (const { row, values } of rows) {
      const department = values.departmentCode ? departments.get(values.departmentCode) : undefined;
      const link = links.get(row)!;
      const { person, assignment } = await hireInTransaction(
        tx,
        {
          fullName: values.fullName!,
          workEmail: values.workEmail,
          profile: { dateOfBirth: values.dateOfBirth, gender: values.gender, maritalStatus: values.maritalStatus, nationality: values.nationality, phone: values.phone, personalEmail: values.personalEmail, permanentAddress: values.permanentAddress, currentAddress: values.currentAddress },
          entityId: entities.get(values.entityCode!)!.id,
          employeeCode: values.employeeCode,
          startDate: values.startDate!,
          seniorityDate: values.seniorityDate,
          placement: {
            workforceType: values.workforceType ?? "employee",
            branchId: null,
            // The deepest unit the row names: its team if it has one, otherwise its department.
            orgUnitId: (values.teamName ? findTeam(units, department?.id, values.teamName) : department)?.id ?? null,
            positionName: values.positionName,
            jobLevel: values.jobLevel,
            managerId: link.kind === "person" ? link.personId : null,
            dottedManagerId: null,
            workLocation: null,
          },
        },
        user.person.id,
        // The import loads people who joined long ago: only those still to start get an onboarding checklist.
        { onboarding: values.startDate! >= todayInVietnam() },
      );
      created.set(row, { personId: person.id, assignmentId: assignment.id });

      if (values.nationalId || values.taxCode || values.socialInsuranceNumber || values.bankAccountNumber) {
        await updateSensitiveFields(
          person.id,
          {
            nationalId: values.nationalId,
            nationalIdIssuedOn: values.nationalIdIssuedOn,
            nationalIdIssuedAt: values.nationalIdIssuedAt,
            passportNumber: null,
            taxCode: values.taxCode,
            socialInsuranceNumber: values.socialInsuranceNumber,
            healthInsuranceHospital: null,
            bankAccounts: values.bankAccountNumber && values.bankName ? [{ bankName: values.bankName, accountNumber: values.bankAccountNumber, accountHolder: values.bankAccountHolder, branch: null }] : [],
          },
          tx,
        );
        withRestricted++;
      }
    }

    // Second pass: managers who arrived in the same file now exist.
    let managersLinked = 0;
    for (const { row } of rows) {
      const link = links.get(row)!;
      if (link.kind !== "row") continue;
      const managerId = created.get(link.row)!.personId;
      const { personId, assignmentId } = created.get(row)!;
      await tx.update(schema.assignment).set({ managerId }).where(eq(schema.assignment.id, assignmentId));
      const linked = await tx.update(schema.person).set({ managerId }).where(eq(schema.person.id, personId)).returning({ id: schema.person.id, workEmail: schema.person.workEmail });
      await invalidatePeople(linked);
      managersLinked++;
    }
    return { created: created.size, withRestricted, managersLinked };
  },
  onCommitted: async () => {
    // A row may have named a new position.
    await invalidatePositions();
    revalidatePath("/people");
  },
});
