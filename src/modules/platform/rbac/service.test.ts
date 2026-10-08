import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { eq } from "drizzle-orm";
import { grantRole, holdsRoleGrants, listOwnerPersonIds, listPeopleHolding, listPeopleHoldingEach, listPeopleWithRole, listRoleAssignments, loadGrants, revokeRole, roleHolders } from "./service";

const today = todayInVietnam();
let entityId: string;
const people = {} as Record<"owner" | "mai" | "ctv", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  entityId = entity.id;
  const rows = await db()
    .insert(schema.person)
    .values([
      { fullName: "Owner", searchName: "owner", workEmail: "owner@suzu.vn", status: "active" },
      { fullName: "Mai", searchName: "mai", workEmail: "mai@suzu.group", status: "active" },
      { fullName: "Cong Tac Vien", searchName: "cong tac vien", status: "active" },
    ])
    .returning();
  Object.assign(people, { owner: rows[0].id, mai: rows[1].id, ctv: rows[2].id });
  await db().insert(schema.roleAssignment).values({ personId: people.owner, role: "owner", scopeType: "group" });
});

const grant = (overrides: Partial<Parameters<typeof grantRole>[0]> = {}) => grantRole({ personId: people.mai, role: "hr_admin", scopeType: "entity", scopeId: entityId, validFrom: today, validTo: null, ...overrides }, people.owner);

describe("grantRole", () => {
  it("takes effect at once and shows up with its scope named", async () => {
    await grant();
    expect(await loadGrants(people.mai)).toEqual([{ role: "hr_admin", scope: { type: "entity", id: entityId } }]);
    const listed = (await listRoleAssignments()).find((row) => row.personId === people.mai);
    expect(listed).toMatchObject({ role: "hr_admin", scopeName: "Media", grantedByName: "Owner" });
  });

  it("refuses duplicates, bad scopes, bad dates and people who cannot sign in", async () => {
    await expect(grant()).rejects.toThrow("grant_exists");
    await expect(grant({ scopeId: null })).rejects.toThrow("scope_required");
    await expect(grant({ scopeId: people.mai })).rejects.toThrow("scope_not_found");
    await expect(grant({ role: "payroll", validTo: addDays(today, -1) })).rejects.toThrow("grant_dates");
    await expect(grant({ personId: people.ctv })).rejects.toThrow("person_has_no_access");
  });

  it("keeps a future-dated grant out of today's grants but counts it as holding a role", async () => {
    const [withEmail] = await db().insert(schema.person).values({ fullName: "Later", searchName: "later", workEmail: "later@suzu.vn", status: "active" }).returning();
    await grantRole({ personId: withEmail.id, role: "auditor", scopeType: "group", scopeId: null, validFrom: addDays(today, 5), validTo: null }, people.owner);
    expect(await loadGrants(withEmail.id)).toEqual([]);
    expect(await loadGrants(withEmail.id, addDays(today, 5))).toEqual([{ role: "auditor", scope: { type: "group" } }]);
    expect(await holdsRoleGrants(withEmail.id)).toBe(true);
  });
});

describe("revokeRole", () => {
  it("ends the grant for the very next request", async () => {
    const mine = (await listRoleAssignments()).find((item) => item.personId === people.mai)!;
    await revokeRole(mine.id, people.owner);
    expect(await loadGrants(people.mai)).toEqual([]);
    expect(await holdsRoleGrants(people.mai)).toBe(false);
    await expect(revokeRole(mine.id, people.owner)).rejects.toThrow("grant_not_found");
  });

  it("never removes the last owner, but lets one of two go", async () => {
    const owner = (await listRoleAssignments()).find((item) => item.role === "owner")!;
    await expect(revokeRole(owner.id, people.owner)).rejects.toThrow("last_owner");
    await grant({ role: "owner", scopeType: "group", scopeId: null });
    await revokeRole(owner.id, people.mai);
    expect(await loadGrants(people.owner)).toEqual([]);
  });
});

// FR-PLT-16: the heads above a unit inherit the same rights over it. A caller that knows one unit
// — a team's department, a hiring request's team — must still find the grant given on a unit above.
describe("who holds a role over a unit", () => {
  const units = {} as Record<"marketing" | "social" | "video" | "brand" | "design", string>;
  const who = {} as Record<"headMarketing" | "headVideo" | "headBrand" | "headDesign" | "expired" | "later" | "hrSocial", string>;
  const sorted = (ids: string[]) => [...ids].sort();
  const named = (...keys: (keyof typeof who)[]) => sorted(keys.map((key) => who[key]));

  beforeAll(async () => {
    // Marketing › Social › Video Editing, with Brand beside Social and Design beside Marketing.
    const unit = async (name: string, parentId: string | null) =>
      (
        await db()
          .insert(schema.orgUnit)
          .values({ name, parentId, kind: parentId ? "team" : "department" })
          .returning()
      )[0].id;
    units.marketing = await unit("Marketing", null);
    units.social = await unit("Social", units.marketing);
    units.video = await unit("Video Editing", units.social);
    units.brand = await unit("Brand", units.marketing);
    units.design = await unit("Design", null);

    const grants: [keyof typeof who, string, string, { validFrom?: string; validTo?: string }][] = [
      ["headMarketing", "department_head", units.marketing, {}],
      ["headVideo", "department_head", units.video, {}],
      ["headBrand", "department_head", units.brand, {}],
      ["headDesign", "department_head", units.design, {}],
      ["expired", "department_head", units.marketing, { validTo: addDays(today, -1) }],
      ["later", "department_head", units.marketing, { validFrom: addDays(today, 1) }],
      ["hrSocial", "hr_staff", units.social, {}],
    ];
    for (const [key, role, scopeId, dates] of grants) {
      const [row] = await db()
        .insert(schema.person)
        .values({ fullName: key, searchName: key.toLowerCase(), workEmail: `${key.toLowerCase()}@suzu.group`, status: "active" })
        .returning();
      who[key] = row.id;
      await db()
        .insert(schema.roleAssignment)
        .values({ personId: row.id, role, scopeType: "unit", scopeId, validFrom: "2024-01-01", ...dates });
    }
  });

  it("finds the grant on the unit itself and on every unit above it, from one unit id", async () => {
    // A grandchild: its own head and the head two levels up — not the sibling's, not another department's.
    expect(sorted(await listPeopleWithRole("department_head", { unitPath: [units.video] }))).toEqual(named("headMarketing", "headVideo"));
    // A grant never reaches up: Video Editing's head is not Social's.
    expect(await listPeopleWithRole("department_head", { unitPath: [units.social] })).toEqual([who.headMarketing]);
    expect(sorted(await listPeopleWithRole("department_head", { unitPath: [units.brand] }))).toEqual(named("headBrand", "headMarketing"));
    expect(await listPeopleWithRole("department_head", { unitPath: [units.design] })).toEqual([who.headDesign]);
    // No unit named, no unit grant answers.
    expect(await listPeopleWithRole("department_head", { entityId })).toEqual([]);
  });

  it("answers the same for a target that carries its whole chain, and inside a transaction", async () => {
    const chain = { unitPath: [units.marketing, units.social, units.video] };
    expect(sorted(await listPeopleWithRole("department_head", chain))).toEqual(named("headMarketing", "headVideo"));
    await db().transaction(async (tx) => {
      expect(sorted(await listPeopleWithRole("department_head", { unitPath: [units.video] }, tx))).toEqual(named("headMarketing", "headVideo"));
      expect(await listPeopleHolding("person:manage", { unitPath: [units.video] }, { includeWildcard: false, executor: tx })).toEqual([who.hrSocial]);
    });
  });

  it("leaves out a grant that has ended and one that has not started", async () => {
    const heads = await listPeopleWithRole("department_head", { unitPath: [units.video] });
    expect(heads).not.toContain(who.expired);
    expect(heads).not.toContain(who.later);
    // Asked about the day it starts, the later grant counts.
    expect(await listPeopleHolding("report:read", { unitPath: [units.video] }, { includeWildcard: false, today: addDays(today, 1) })).toContain(who.later);
    expect(await listPeopleHolding("report:read", { unitPath: [units.video] }, { includeWildcard: false })).not.toContain(who.later);
  });

  it("finds the holders of a permission the same way, with the owners only when asked", async () => {
    expect(await listPeopleHolding("person:manage", { unitPath: [units.video] }, { includeWildcard: false })).toEqual([who.hrSocial]);
    expect(await listPeopleHolding("person:manage", { unitPath: [units.social] }, { includeWildcard: false })).toEqual([who.hrSocial]);
    expect(await listPeopleHolding("person:manage", { unitPath: [units.brand] }, { includeWildcard: false })).toEqual([]);
    expect(await listPeopleHolding("person:manage", { unitPath: [units.marketing] }, { includeWildcard: false })).toEqual([]);
    const owners = await listOwnerPersonIds();
    expect(owners).toEqual([people.mai]);
    expect(sorted(await listPeopleHolding("person:manage", { unitPath: [units.video] }))).toEqual(sorted([who.hrSocial, ...owners]));
  });

  it("answers many questions from one read exactly as the single lookups do", async () => {
    const targets = [{ unitPath: [units.video] }, { unitPath: [units.social] }, { unitPath: [units.brand] }, { unitPath: [units.design] }, { entityId }, {}];
    const check = async (executor?: Parameters<typeof listOwnerPersonIds>[0]) => {
      const holders = await roleHolders({ executor });
      expect(holders.owners()).toEqual(await listOwnerPersonIds(executor));
      for (const target of targets) {
        expect(sorted(holders.withRole("department_head", target))).toEqual(sorted(await listPeopleWithRole("department_head", target, executor)));
        for (const includeWildcard of [true, false]) expect(sorted(holders.holding("person:manage", target, { includeWildcard }))).toEqual(sorted(await listPeopleHolding("person:manage", target, { includeWildcard, executor })));
      }
      const each = await listPeopleHoldingEach("report:read", targets, { includeWildcard: false, executor });
      expect(each).toEqual(await Promise.all(targets.map((target) => listPeopleHolding("report:read", target, { includeWildcard: false, executor }))));
    };
    await check();
    await db().transaction(async (tx) => check(tx));
  });

  it("follows the tree when a unit moves", async () => {
    // Video Editing leaves Marketing for Design: the database rewrites its path, nothing else changes.
    await db().update(schema.orgUnit).set({ parentId: units.design }).where(eq(schema.orgUnit.id, units.video));
    expect(sorted(await listPeopleWithRole("department_head", { unitPath: [units.video] }))).toEqual(named("headDesign", "headVideo"));
    expect(await listPeopleHolding("person:manage", { unitPath: [units.video] }, { includeWildcard: false })).toEqual([]);
  });
});
