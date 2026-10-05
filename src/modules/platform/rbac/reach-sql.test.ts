// The reach clauses against a real Postgres (PGlite): `personInReachSql` admits exactly the people
// `matchesReach` does — and a reach that admits nobody admits nobody in SQL too, rather than turning
// into "no condition" inside an `and(...)`, which would list everyone.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { matchesReach, type TierReach } from "./policy";
import { personInReachSql, unitColumnInReachSql } from "./reach-sql";

const ids = {} as Record<"szm" | "szc" | "video" | "social" | "design" | "boss" | "an" | "binh" | "chi", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [szm, szc] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [social] = await db().insert(schema.orgUnit).values({ code: "SOC", name: "Social", parentId: video.id }).returning();
  const [design] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, video: video.id, social: social.id, design: design.id });
  const add = async (fullName: string, entityId: string, orgUnitId: string, managerId: string | null = null) =>
    (await db().insert(schema.person).values({ fullName, searchName: fullName.toLowerCase(), status: "active", primaryEntityId: entityId, orgUnitId, managerId }).returning())[0].id;
  ids.boss = await add("Boss", szm.id, video.id);
  ids.an = await add("An", szm.id, social.id, ids.boss);
  ids.binh = await add("Binh", szc.id, design.id);
  ids.chi = await add("Chi", szc.id, social.id);
});

const everyone = () => [ids.boss, ids.an, ids.binh, ids.chi];

async function admitted(reach: TierReach): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(and(inArray(schema.person.id, everyone()), personInReachSql(reach)));
  return rows.map((row) => row.id).sort();
}

async function expected(reach: TierReach): Promise<string[]> {
  const rows = await db().select().from(schema.person).where(inArray(schema.person.id, everyone()));
  return rows.filter((row) => matchesReach(reach, { personId: row.id, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId })).map((row) => row.id).sort();
}

describe("personInReachSql", () => {
  it("admits nobody for a reach that admits nobody — never everybody", async () => {
    const nothing: TierReach = { all: false, entityIds: [], unitIds: [], managerOf: null };
    expect(personInReachSql(nothing)).toBeDefined();
    expect(await admitted(nothing)).toEqual([]);
  });

  it("adds no condition for a reach over everyone", async () => {
    expect(personInReachSql({ all: true })).toBeUndefined();
    expect(await admitted({ all: true })).toEqual(everyone().sort());
  });

  it("admits exactly whom matchesReach admits: by entity, by a unit and those below it, and as the manager", async () => {
    const reaches: TierReach[] = [
      { all: false, entityIds: [ids.szm], unitIds: [], managerOf: null },
      { all: false, entityIds: [], unitIds: [ids.video], managerOf: null },
      { all: false, entityIds: [], unitIds: [ids.design], managerOf: null },
      { all: false, entityIds: [], unitIds: [], managerOf: ids.boss },
      { all: false, entityIds: [ids.szc], unitIds: [ids.social], managerOf: ids.boss },
    ];
    for (const reach of reaches) expect(await admitted(reach)).toEqual(await expected(reach));
    // A grant on Video reaches Social below it, whatever the entity.
    expect(await admitted(reaches[1])).toEqual([ids.boss, ids.an, ids.chi].sort());
  });
});

describe("unitColumnInReachSql", () => {
  it("matches no row for no units", async () => {
    const rows = await db().select({ id: schema.person.id }).from(schema.person).where(unitColumnInReachSql(schema.person.departmentId, []));
    expect(rows).toEqual([]);
    const video = await db().select({ id: schema.person.id }).from(schema.person).where(and(unitColumnInReachSql(schema.person.departmentId, [ids.video, ids.social, ids.design]), eq(schema.person.id, ids.an)));
    expect(video.map((row) => row.id)).toEqual([ids.an]);
  });
});
