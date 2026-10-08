// Contracts in bulk (CHR-02, FR-PLT-36): each row through the same checks as the form, into the
// employment running on its first day; a refused row is named, and a refused file writes nothing.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({
    allowedWorkspaceDomains: ["suzu.vn", "suzu.group"],
    bootstrapOwnerEmails: [],
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
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { contractColumns, contractImport } from "./contract-import";
import { hirePerson } from "./service";

const contracts = contractImport as unknown as Required<ImportDefinition<typeof contractColumns>>;
const ids = {} as Record<"media" | "creative" | "video" | "actor" | "huy" | "lan", string>;
const userWith = (grants: Grant[]) => ({ person: { id: ids.actor }, principal: { personId: ids.actor, workforceType: "employee", grants } }) as unknown as CurrentUser;
const HEAD = "Mã nhân viên,Số hợp đồng,Loại hợp đồng,Nhóm công việc (thử việc),Ngày ký,Từ ngày,Đến ngày,Ghi chú";
const sheet = (csv: string) => parseTable(parseCsv(`${HEAD}\n${csv}\n`), contractColumns);

beforeAll(async () => {
  await migrateTestDb();
  await db()
    .insert(schema.statutoryParameter)
    .values(STATUTORY_SEED.map((seed) => ({ ...seed, status: "approved" as const })));
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, actor: actor.id });
  const hire = async (fullName: string, entityId: string, employeeCode: string) =>
    (
      await hirePerson(
        {
          fullName,
          workEmail: null,
          profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
          entityId,
          employeeCode,
          startDate: "2024-07-01",
          seniorityDate: null,
          placement: { workforceType: "employee", branchId: null, orgUnitId: null, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null },
        },
        actor.id,
        { onboarding: false },
      )
    ).person.id;
  ids.huy = await hire("Ho Gia Huy", media.id, "SZM-0008");
  ids.lan = await hire("Tran Lan", creative.id, "SZC-0002");
});

const run = async (csv: string, user: CurrentUser) => {
  const { rows, problems } = sheet(csv);
  expect(problems.filter((problem) => problem.code !== "column_unknown")).toEqual([]);
  const found = await contracts.validate(rows, user, undefined);
  return { rows, found };
};

describe("the contract import", () => {
  const hrOfMedia = () => userWith([{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]);

  it("names what is wrong — out of reach, a broken rule, a number used twice — and writes nothing on a check", async () => {
    const { found } = await run(
      ["SZM-0008,TV-01,Thử việc,Chuyên môn,,01/07/2024,29/08/2024,", "SZM-0008,HD-01,Xác định thời hạn,,,01/09/2024,31/12/2028,", "SZC-0002,HD-02,Không xác định thời hạn,,,01/07/2024,,", "SZM-0008,TV-01,Bảo mật,,,01/07/2024,,"].join("\n"),
      hrOfMedia(),
    );
    // Row 1 is the header. Row 3's fixed term runs past 36 months; row 4 is another entity's person.
    expect(found.map((problem) => [problem.row, problem.code]).sort()).toEqual([
      [3, "contract_rule"],
      [4, "person_not_found"],
      [5, "contract_number_taken"],
    ]);
    expect(await db().select().from(schema.contract)).toEqual([]);
  });

  it("writes every row of a clean file into the right employment", async () => {
    const { rows, found } = await run(["SZM-0008,TV-01,Thử việc,Chuyên môn,28/06/2024,01/07/2024,29/08/2024,", "SZM-0008,HD-01,Xác định thời hạn,,30/08/2024,01/09/2024,31/08/2025,Ký lần đầu"].join("\n"), hrOfMedia());
    expect(found).toEqual([]);
    const result = await db().transaction((tx) => contracts.commit(rows, tx as unknown as Tx, hrOfMedia(), undefined));
    expect(result).toEqual({ contracts: 2 });
    const written = await db().select().from(schema.contract).where(eq(schema.contract.personId, ids.huy));
    expect(written.map((row) => [row.number, row.type, row.startDate, row.endDate, row.salaryTerms]).sort()).toEqual([
      ["HD-01", "fixed_term", "2024-09-01", "2025-08-31", null],
      ["TV-01", "probation", "2024-07-01", "2024-08-29", null],
    ]);
  });
});
