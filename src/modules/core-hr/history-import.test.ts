// Past work history (roll-out): the form's service and the bulk import on top of it. What
// matters: the periods land in order whatever order the file has, the row the employee import
// left gives way, the hire points at the first period, and a refused file writes nothing.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({
    allowedWorkspaceDomains: ["suzu.vn", "suzu.group"],
    bootstrapOwnerEmails: ["chairman@suzu.vn"],
    BETTER_AUTH_URL: "https://suzu.one",
    DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
    DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64"),
  }),
}));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/modules/platform/import/service", () => ({ defineImport: (definition: unknown) => definition }));

import { and, asc, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { addDays, todayInVietnam } from "@/lib/dates";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { parseCsv, parseTable } from "@/modules/platform/import/engine/table";
import type { ImportDefinition } from "@/modules/platform/import/service";
import type { Grant } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { historyColumns, historyImport } from "./history-import";
import { employeeColumns, employeeImport } from "./import";
import { changeAssignment, recordPastAssignment } from "./service";

const employees = employeeImport as unknown as Required<ImportDefinition<typeof employeeColumns>>;
const history = historyImport as unknown as Required<ImportDefinition<typeof historyColumns>>;
const ids = {} as Record<"media" | "creative" | "video" | "actor" | "long" | "huy" | "tam", string>;
const userWith = (grants: Grant[]) => ({ person: { id: ids.actor }, principal: { personId: ids.actor, workforceType: "employee", grants } }) as unknown as CurrentUser;
let hrAdmin: CurrentUser;
let hrOfCreative: CurrentUser;
const HEAD = "Mã nhân viên,Từ ngày,Đến ngày,Phòng ban (mã),Chức danh,Quản lý trực tiếp,Ghi chú";
const sheet = (csv: string) => parseTable(parseCsv(`${HEAD}\n${csv}\n`), historyColumns);
const placement = { workforceType: "employee" as const, branchId: null, orgUnitId: null, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null };

async function periodsOf(personId: string) {
  return db()
    .select({ id: schema.assignment.id, validFrom: schema.assignment.validFrom, validTo: schema.assignment.validTo, position: schema.position.name, managerId: schema.assignment.managerId })
    .from(schema.assignment)
    .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
    .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .where(eq(schema.employment.personId, personId))
    .orderBy(asc(schema.assignment.validFrom));
}

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  await db().insert(schema.orgUnit).values({ code: "OLD", name: "Phòng cũ", isActive: false });
  const [actor] = await db().insert(schema.person).values({ fullName: "Hr Admin", searchName: "hr admin" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, actor: actor.id });
  hrAdmin = userWith([{ role: "hr_admin", scope: { type: "group" } }]);
  hrOfCreative = userWith([{ role: "hr_staff", scope: { type: "entity", id: creative.id } }]);

  // The roll-out as it happens: everyone loaded with today's placement from their first day.
  const head = "Mã nhân viên,Họ và tên,Email công việc,Pháp nhân (mã),Phòng ban (mã),Chức danh,Ngày vào làm,Quản lý trực tiếp";
  const loaded = parseTable(
    parseCsv(`${head}\nSZM-0001,Đặng Hoàng Long,long.dang@suzu.group,SZM,VID,Trưởng phòng,01/03/2019,\nSZM-0002,Hồ Gia Huy,huy.ho@suzu.group,SZM,VID,Dựng phim,01/06/2021,SZM-0001\nSZM-0003,Bùi Thanh Tâm,tam.bui@suzu.group,SZM,VID,Dựng phim,01/01/2020,\n`),
    employeeColumns,
  );
  expect(loaded.problems).toEqual([]);
  await db().transaction((tx) => employees.commit(loaded.rows, tx as Tx, hrAdmin));
  const people = await db().select().from(schema.person);
  const idOf = (email: string) => people.find((row) => row.workEmail === email)!.id;
  Object.assign(ids, { long: idOf("long.dang@suzu.group"), huy: idOf("huy.ho@suzu.group"), tam: idOf("tam.bui@suzu.group") });
});

describe("work history import", () => {
  it("reports every refused row and writes nothing while checking", async () => {
    const today = todayInVietnam();
    const { rows, problems } = sheet(
      [
        "SZM-0001,01/01/2020,31/12/2020,VID,Biên tập,,", // inside the one imported row: would split it
        `SZM-0001,01/03/2019,${today},VID,Biên tập,,`, // not over yet
        "SZM-0001,01/01/2018,31/12/2018,VID,Biên tập,,", // before the first day
        "SZM-9999,01/03/2019,31/12/2019,VID,Biên tập,,",
        "SZM-0002,01/06/2021,31/12/2021,XYZ,Biên tập,,",
        "SZM-0002,01/06/2021,31/12/2021,VID,Biên tập,nobody@suzu.group,",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    const found = await history.validate(rows, hrAdmin, undefined);
    expect(found.map((problem) => [problem.row, problem.code]).sort()).toEqual([
      [2, "inside_recorded_period"],
      [3, "not_ended"],
      [4, "outside_employment"],
      [5, "person_not_found"],
      [6, "department_not_found"],
      [7, "manager_not_found"],
    ]);
    expect((await periodsOf(ids.long)).map((row) => row.validFrom)).toEqual(["2019-03-01"]);
    // Out of reach looks like nobody.
    const theirs = sheet("SZM-0001,01/03/2019,31/12/2019,VID,Biên tập,,");
    expect((await history.validate(theirs.rows, hrOfCreative, undefined)).map((problem) => problem.code)).toEqual(["person_not_found"]);
  });

  it("applies a person's periods oldest first, whatever the file's order", async () => {
    // Long's old manager is Huy, who reports to Long today: history is not today's reporting line.
    const { rows } = sheet(["SZM-0001,01/01/2021,31/05/2022,VID,Biên tập viên chính,,Thăng chức", "SZM-0001,01/03/2019,31/12/2020,OLD,Biên tập viên,huy.ho@suzu.group,"].join("\n"));
    expect(await history.validate(rows, hrAdmin, undefined)).toEqual([]);
    const counts = await db().transaction((tx) => history.commit(rows, tx as Tx, hrAdmin, undefined));
    expect(counts).toEqual({ periods: 2, adjusted: 2 });

    const periods = await periodsOf(ids.long);
    expect(periods.map((row) => [row.validFrom, row.validTo, row.position])).toEqual([
      ["2019-03-01", "2020-12-31", "Biên tập viên"],
      ["2021-01-01", "2022-05-31", "Biên tập viên chính"],
      ["2022-06-01", null, "Trưởng phòng"],
    ]);
    expect(periods[0].managerId).toBe(ids.huy);
    // The hire now points at where Long started, and says so.
    const [hire] = await db().select().from(schema.lifecycleEvent).where(and(eq(schema.lifecycleEvent.personId, ids.long), eq(schema.lifecycleEvent.type, "hire")));
    expect(hire.assignmentId).toBe(periods[0].id);
    expect((hire.details.to as { position: string }).position).toBe("Biên tập viên");
    // Today's placement is untouched.
    const [long] = await db().select().from(schema.person).where(eq(schema.person.id, ids.long));
    expect(long.managerId).toBeNull();
  });

  it("corrects a period given its exact dates", async () => {
    const { rows } = sheet("SZM-0001,01/03/2019,31/12/2020,VID,Biên tập viên,,Sửa phòng ban");
    expect(await history.validate(rows, hrAdmin, undefined)).toEqual([]);
    await db().transaction((tx) => history.commit(rows, tx as Tx, hrAdmin, undefined));
    expect((await periodsOf(ids.long)).map((row) => [row.validFrom, row.validTo])).toEqual([
      ["2019-03-01", "2020-12-31"],
      ["2021-01-01", "2022-05-31"],
      ["2022-06-01", null],
    ]);
  });
});

describe("recordPastAssignment", () => {
  it("keeps a promotion on its date", async () => {
    await changeAssignment(ids.tam, { validFrom: "2023-01-01", changeReason: null, placement: { ...placement, positionName: "Trưởng nhóm" }, kind: "promotion" }, ids.actor);
    await expect(recordPastAssignment(ids.tam, { validFrom: "2022-06-01", validTo: "2023-03-31", changeReason: null, placement }, ids.actor)).rejects.toThrow("assignment_moves_recorded_event");
    // Ending before it is fine: the row before the promotion gives way at its end instead.
    await recordPastAssignment(ids.tam, { validFrom: "2022-06-01", validTo: "2022-12-31", changeReason: null, placement: { ...placement, positionName: "Dựng phim chính" } }, ids.actor);
    expect((await periodsOf(ids.tam)).map((row) => [row.validFrom, row.validTo, row.position])).toEqual([
      ["2020-01-01", "2022-05-31", "Dựng phim"],
      ["2022-06-01", "2022-12-31", "Dựng phim chính"],
      ["2023-01-01", null, "Trưởng nhóm"],
    ]);
  });

  it("refuses a period that ends before it starts or is not over", async () => {
    await expect(recordPastAssignment(ids.huy, { validFrom: "2022-01-01", validTo: "2021-12-31", changeReason: null, placement }, ids.actor)).rejects.toThrow("assignment_period_reversed");
    await expect(recordPastAssignment(ids.huy, { validFrom: "2021-06-01", validTo: addDays(todayInVietnam(), 1), changeReason: null, placement }, ids.actor)).rejects.toThrow("assignment_not_ended");
  });
});
