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
  const [departments, entities] = await Promise.all([db().select().from(schema.department), db().select({ code: schema.entity.code }).from(schema.entity)]);
  const entityCodes = new Set(entities.map((entity) => entity.code));
  const codeById = new Map(departments.map((department) => [department.id, department.code]));
  // Parent of every department as it would be after the import.
  const parentOf = new Map<string, string | null>(departments.map((department) => [department.code, department.parentId ? (codeById.get(department.parentId) ?? null) : null]));

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
      const [existing] = await tx.select({ id: schema.department.id }).from(schema.department).where(eq(schema.department.code, values.code!)).limit(1);
      if (existing) {
        await tx.update(schema.department).set({ name: values.name!, updatedAt: new Date() }).where(eq(schema.department.id, existing.id));
        updated++;
      } else {
        await tx.insert(schema.department).values({ code: values.code!, name: values.name!, entityId: values.entityCode ? (entities.get(values.entityCode) ?? null) : null });
        created++;
      }
    }
    const ids = new Map((await tx.select({ id: schema.department.id, code: schema.department.code }).from(schema.department)).map((department) => [department.code, department.id]));
    for (const { values } of rows) {
      await tx.update(schema.department).set({ parentId: values.parentCode ? (ids.get(values.parentCode) ?? null) : null }).where(eq(schema.department.code, values.code!));
    }
    return { created, updated };
  },
  onCommitted: () => revalidatePath("/admin/org"),
});
