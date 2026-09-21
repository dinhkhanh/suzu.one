import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { code, type Column, type ParsedRow, type Problem, templateCsv, text } from "../import/engine/table";
import { defineImport } from "../import/service";
import { can } from "../rbac/policy";

// Departments in bulk: new codes are created, known codes get their name and parent updated.
// A department with no entity code is shared across the group.
export const departmentColumns = {
  code: { headers: ["Mã phòng ban", "Department code", "Mã"], required: true, parse: code(12), example: "MOT" } as Column<string>,
  name: { headers: ["Tên phòng ban", "Department name", "Tên"], required: true, parse: text(120), example: "Motion Graphics" } as Column<string>,
  parentCode: { headers: ["Trực thuộc (mã)", "Parent code"], parse: code(12), example: "DES" } as Column<string>,
  entityCode: { headers: ["Pháp nhân (mã)", "Entity code"], parse: code(12), example: "" } as Column<string>,
};

export const departmentTemplate = () => templateCsv(departmentColumns);

type Row = ParsedRow<typeof departmentColumns>;

async function validate(rows: Row[]): Promise<Problem[]> {
  const problems: Problem[] = [];
  const [departments, entities] = await Promise.all([db().select().from(schema.orgUnit), db().select({ code: schema.entity.code }).from(schema.entity)]);
  const entityCodes = new Set(entities.map((entity) => entity.code));
  const codeById = new Map(departments.flatMap((department) => (department.code ? [[department.id, department.code] as const] : [])));
  // Parent of every department as it would be after the import.
  const parentOf = new Map<string, string | null>(departments.flatMap((department) => (department.code ? [[department.code, department.parentId ? (codeById.get(department.parentId) ?? null) : null] as const] : [])));

  const seen = new Set<string>();
  for (const { row, values } of rows) {
    if (!values.code) continue;
    if (seen.has(values.code)) problems.push({ row, column: departmentColumns.code.headers[0], code: "duplicate_in_file" });
    seen.add(values.code);
    parentOf.set(values.code, values.parentCode);
    if (values.entityCode && !entityCodes.has(values.entityCode)) problems.push({ row, column: departmentColumns.entityCode.headers[0], code: "entity_not_found" });
  }
  for (const { row, values } of rows) {
    if (!values.code || !values.parentCode) continue;
    const column = departmentColumns.parentCode.headers[0];
    if (!parentOf.has(values.parentCode)) problems.push({ row, column, code: "parent_not_found" });
    let cursor: string | null | undefined = values.parentCode;
    for (let depth = 0; cursor && depth <= parentOf.size; depth++) {
      if (cursor === values.code) {
        problems.push({ row, column, code: "parent_loop" });
        break;
      }
      cursor = parentOf.get(cursor);
    }
  }
  return problems;
}

export const departmentImport = defineImport({
  kind: "departments",
  columns: departmentColumns,
  // Shared departments belong to the whole group.
  authorize: (user) => can(user.principal, "org:manage", {}),
  validate,
  commit: async (rows, tx) => {
    const entities = new Map((await tx.select({ id: schema.entity.id, code: schema.entity.code }).from(schema.entity)).map((entity) => [entity.code, entity.id]));
    let created = 0;
    let updated = 0;
    // First every department, then the parents: a parent may sit further down the same file.
    for (const { values } of rows) {
      const [existing] = await tx.select({ id: schema.orgUnit.id }).from(schema.orgUnit).where(eq(schema.orgUnit.code, values.code!)).limit(1);
      if (existing) {
        await tx.update(schema.orgUnit).set({ name: values.name!, updatedAt: new Date() }).where(eq(schema.orgUnit.id, existing.id));
        updated++;
      } else {
        await tx.insert(schema.orgUnit).values({ code: values.code!, name: values.name!, entityId: values.entityCode ? (entities.get(values.entityCode) ?? null) : null });
        created++;
      }
    }
    const ids = new Map((await tx.select({ id: schema.orgUnit.id, code: schema.orgUnit.code }).from(schema.orgUnit)).flatMap((department) => (department.code ? [[department.code, department.id] as const] : [])));
    for (const { values } of rows) {
      await tx.update(schema.orgUnit).set({ parentId: values.parentCode ? (ids.get(values.parentCode) ?? null) : null }).where(eq(schema.orgUnit.code, values.code!));
    }
    return { created, updated };
  },
  onCommitted: () => revalidatePath("/admin/org"),
});
