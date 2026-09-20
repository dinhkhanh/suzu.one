// The employee import's own rules: what it refuses, per row and all in one pass, and what a commit
// writes. The action wrapper (staging, encryption of the waiting batch) is tested with the framework.
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

import { eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { parseCsv, parseTable } from "@/modules/platform/import/engine/table";
import type { ImportDefinition } from "@/modules/platform/import/service";
import type { Grant } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { employeeColumns, employeeImport, employeeTemplate } from "./import";
import { getSensitiveFields } from "./records";

const definition = employeeImport as unknown as Required<ImportDefinition<typeof employeeColumns>>;
const sheet = (csv: string) => parseTable(parseCsv(csv), employeeColumns);
const ids = {} as Record<"media" | "creative" | "actor" | "long", string>;
const userWith = (grants: Grant[]) => ({ person: { id: ids.actor }, principal: { personId: ids.actor, workforceType: "employee", grants } }) as unknown as CurrentUser;
let hrAdmin: CurrentUser;
let hrOfMedia: CurrentUser;

const HEAD = "Mã nhân viên,Họ và tên,Email công việc,Pháp nhân (mã),Phòng ban (mã),Nhóm,Chức danh,Loại lao động,Ngày vào làm,Quản lý trực tiếp,Số CCCD,Ngân hàng,Số tài khoản";

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "Suzu Media", shortName: "Media" },
      { code: "SZC", legalName: "Suzu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  await db().insert(schema.department).values({ code: "STU", name: "Studio", entityId: creative.id });
  await db().insert(schema.team).values({ departmentId: video.id, name: "Hậu kỳ" });
  const [actor] = await db().insert(schema.person).values({ fullName: "Hr Admin", searchName: "hr admin" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, actor: actor.id });
  hrAdmin = userWith([{ role: "hr_admin", scope: { type: "group" } }]);
  hrOfMedia = userWith([{ role: "hr_staff", scope: { type: "entity", id: media.id } }]);

  // Someone already on the books, to be a manager and a duplicate.
  const first = sheet(`${HEAD}\nSZM-0001,Đặng Hoàng Long,long.dang@suzu.group,SZM,VID,,Trưởng phòng,Chính thức,14/09/2020,,079200000001,,\n`);
  expect(first.problems).toEqual([]);
  await db().transaction((tx) => definition.commit(first.rows, tx as Tx, hrAdmin));
  ids.long = (await db().select().from(schema.person).where(eq(schema.person.workEmail, "long.dang@suzu.group")))[0].id;
});

describe("employee import", () => {
  it("offers a template that parses back without problems", () => {
    const { problems, rows } = sheet(employeeTemplate().replace("long.dang@suzu.group", ""));
    expect(problems).toEqual([]);
    expect(rows[0].values).toMatchObject({ fullName: "Nguyễn Văn An", entityCode: "SZM", workforceType: "employee", startDate: "2024-03-01", gender: "male" });
  });

  it("reports every problem in one pass", async () => {
    const { rows, problems } = sheet(
      [
        HEAD,
        "SZM-0001,Trùng Mã,trung.ma@suzu.group,SZM,VID,,,,01/01/2024,,,,", // code taken
        ",Trùng Email,long.dang@suzu.group,SZM,VID,,,,01/01/2024,,,,", // email on the books
        ",Sai Miền,someone@gmail.com,SZM,VID,,,,01/01/2024,,,,",
        ",Chủ Tịch,chairman@suzu.vn,SZM,VID,,,,01/01/2024,,,,",
        ",Sai Phòng,sai.phong@suzu.group,SZM,STU,Không Có,,,01/01/2024,,,,", // department of another entity, unknown team
        ",Không Pháp Nhân,kpn@suzu.group,XXX,NOPE,,,,01/01/2024,ai.do@suzu.group,,,",
        ",Trùng CCCD,trung.cccd@suzu.group,SZM,VID,,,,01/01/2024,,079 200 000 001,,",
        ",Hai Lần,hai.lan@suzu.group,SZM,VID,,,,01/01/2024,,079200000002,Vietcombank,",
        ",Hai Lần Nữa,hai.lan@suzu.group,SZM,VID,,,,01/01/2024,,079200000002,,123",
        "A1,Vòng Một,vong.mot@suzu.group,SZM,VID,,,,01/01/2024,A2,,,",
        "A2,Vòng Hai,vong.hai@suzu.group,SZM,VID,,,,01/01/2024,vong.mot@suzu.group,,,",
        "A3,Tự Quản,tu.quan@suzu.group,SZM,VID,,,,01/01/2024,A3,,,",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    const found = (await definition.validate(rows, hrAdmin)).map((problem) => `${problem.row}:${problem.code}`).sort();
    expect(found).toEqual(
      [
        "2:already_exists",
        "3:already_exists",
        "4:email_domain",
        "5:email_reserved",
        "6:department_not_in_entity",
        "6:team_not_found",
        "7:entity_not_found",
        "7:department_not_found",
        "7:manager_not_found",
        "8:already_exists",
        "9:bank_incomplete",
        "10:duplicate_in_file",
        "10:duplicate_in_file",
        "10:bank_incomplete",
        "11:manager_loop",
        "12:manager_loop",
        "13:manager_is_self",
      ].sort(),
    );
  });

  it("checks the importer's reach row by row", async () => {
    const { rows } = sheet(`${HEAD}\n,Người Media,nguoi.media@suzu.group,SZM,VID,,,,01/01/2024,,,,\n,Người Creative,nguoi.creative@suzu.group,SZC,STU,,,,01/01/2024,,,,\n`);
    expect((await definition.validate(rows, hrOfMedia)).map((problem) => `${problem.row}:${problem.code}`)).toEqual(["3:out_of_reach"]);
    expect(await definition.validate(rows, hrAdmin)).toEqual([]);
  });

  it("commits through the hire path: codes, teams, managers from the file and from the books, encrypted restricted fields", async () => {
    const { rows, problems } = sheet(
      [
        HEAD,
        ",Hồ Gia Huy,huy.ho@suzu.group,SZM,VID,hau ky,Dựng phim,Thử việc,17/07/2023,TAM-01,079201001234,Vietcombank,0071000123456",
        "TAM-01,Bùi Thanh Tâm,tam.bui@suzu.group,SZM,VID,,Đạo diễn,,01/03/2021,long.dang@suzu.group,,,",
        ",Ngô Bảo Anh,,SZM,VID,,Quay phim,CTV,01/11/2025,SZM-0001,,,",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(await definition.validate(rows, hrOfMedia)).toEqual([]);
    const counts = await db().transaction((tx) => definition.commit(rows, tx as Tx, hrOfMedia));
    expect(counts).toEqual({ created: 3, withRestricted: 1, managersLinked: 1 });

    const people = await db().select().from(schema.person);
    const byName = (name: string) => people.find((person) => person.fullName === name)!;
    const [huy, tam, anh] = [byName("Hồ Gia Huy"), byName("Bùi Thanh Tâm"), byName("Ngô Bảo Anh")];
    expect(huy.managerId).toBe(tam.id);
    expect(tam.managerId).toBe(ids.long);
    expect(anh).toMatchObject({ managerId: ids.long, workEmail: null, workforceType: "collaborator" });
    expect(huy).toMatchObject({ workforceType: "probation", primaryEntityId: ids.media });
    expect(huy.teamId).not.toBeNull();

    const employments = await db().select().from(schema.employment);
    expect(employments.find((row) => row.personId === tam.id)?.employeeCode).toBe("TAM-01");
    expect(employments.find((row) => row.personId === huy.id)?.employeeCode).toMatch(/^SZM-\d{4}$/);
    const [assignment] = await db().select().from(schema.assignment).where(eq(schema.assignment.employmentId, employments.find((row) => row.personId === huy.id)!.id));
    expect(assignment.managerId).toBe(tam.id);

    const [raw] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, huy.id));
    expect(JSON.stringify(raw)).not.toContain("079201001234");
    expect(await getSensitiveFields(hrAdmin.principal, huy.id)).toMatchObject({ nationalId: "079201001234", bankAccounts: [{ bankName: "Vietcombank", accountNumber: "0071000123456" }] });

    // The same file again is now all duplicates: nothing is imported twice.
    expect((await definition.validate(rows, hrOfMedia)).filter((problem) => problem.code === "already_exists")).toHaveLength(4);
  });
});
