import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The action wrapper needs a signed-in request; here the definition itself is under test.
vi.mock("../import/service", () => ({ defineImport: (definition: unknown) => definition }));

import { db, schema, type Tx } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { parseCsv, parseTable } from "../import/engine/table";
import type { ImportDefinition } from "../import/service";
import { departmentColumns, departmentImport, departmentTemplate } from "./import";

const definition = departmentImport as unknown as Required<ImportDefinition<typeof departmentColumns>>;
// Department rows are checked the same for everyone; who may import is the action's question.
const anyone = {} as never;
const sheet = (csv: string) => parseTable(parseCsv(csv), departmentColumns).rows;

beforeAll(async () => {
  await migrateTestDb();
  await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" });
  await db().insert(schema.department).values({ code: "DES", name: "Thiết kế" });
});

it("finds duplicates, missing references and loops — including loops through departments already in the system", async () => {
  const rows = sheet("Mã,Tên,Parent code,Entity code\nMOT,Motion,DES,\nDES,Thiết kế,MOT,\nSND,Sound,NOPE,XXX\nSND,Again,,\n");
  expect((await definition.validate(rows, anyone)).map((problem) => `${problem.row}:${problem.code}`).sort()).toEqual(["2:parent_loop", "3:parent_loop", "4:entity_not_found", "4:parent_not_found", "5:duplicate_in_file"]);
});

it("creates and updates in one go, whatever order the parents come in", async () => {
  const rows = sheet("Mã,Tên,Parent code,Entity code\nANI,Animation,MOT,szm\nMOT,Motion Graphics,DES,\nDES,Thiết kế & Sáng tạo,,\n");
  expect(await definition.validate(rows, anyone)).toEqual([]);
  const counts = await db().transaction((tx) => definition.commit(rows, tx as unknown as Tx, undefined as never));
  expect(counts).toEqual({ created: 2, updated: 1 });

  const departments = await db().select().from(schema.department);
  const byCode = Object.fromEntries(departments.map((department) => [department.code, department]));
  expect(byCode.DES.name).toBe("Thiết kế & Sáng tạo");
  expect(byCode.MOT.parentId).toBe(byCode.DES.id);
  expect(byCode.ANI.parentId).toBe(byCode.MOT.id);
  expect(byCode.ANI.entityId).not.toBeNull();
  expect(byCode.MOT.entityId).toBeNull();
});

it("offers a template that passes its own checks", async () => {
  const rows = sheet(departmentTemplate());
  expect(rows).toHaveLength(1);
  // The example row points at DES, which exists here.
  expect(await definition.validate(rows, anyone)).toEqual([]);
});
