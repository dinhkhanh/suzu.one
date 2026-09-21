import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { grantRole, holdsRoleGrants, listRoleAssignments, loadGrants, revokeRole } from "./service";

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

const grant = (overrides: Partial<Parameters<typeof grantRole>[0]> = {}) =>
  grantRole({ personId: people.mai, role: "hr_admin", scopeType: "entity", scopeId: entityId, validFrom: today, validTo: null, ...overrides }, people.owner);

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
