// Service-level tests against a real Postgres (PGlite) with the real migrations applied.
// What matters most here: the SQL that decides who shows up in whose list agrees with the policy.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const database = drizzle(new PGlite({ extensions: { btree_gist } }), { schema });
  return { db: () => database, schema };
});
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: ["chairman@suzu.vn"], BETTER_AUTH_URL: "https://suzu.one" }),
}));
// The real module pulls in the auth stack; services only need the error class.
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { db, schema } from "@/lib/db";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canReadTier, type Grant, type Principal } from "@/modules/platform/rbac/policy";
import { changeAssignment, getPersonTarget, getPersonView, hirePerson, type HireInput, listPeople, rollOverPlacements, updatePersonBasics } from "./service";

const NO_PROFILE = { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null };
const today = todayInVietnam();
const eqId = (id: string) => eq(schema.person.id, id);
// Whoever is recorded as having made the change; irrelevant to these tests.
let actorId: string;
const ids = {} as Record<"media" | "creative" | "video" | "design" | "long" | "tam" | "huy" | "chi" | "ctv" | "future", string>;

function placement(overrides: Partial<HireInput["placement"]> = {}): HireInput["placement"] {
  return { workforceType: "employee", branchId: null, departmentId: null, teamId: null, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null, ...overrides };
}

async function hire(name: string, entityId: string, overrides: Partial<HireInput> & { placement?: HireInput["placement"] } = {}) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`;
  const result = await hirePerson(
    { fullName: name, workEmail: email, profile: { ...NO_PROFILE, phone: "0900000000" }, entityId, employeeCode: null, startDate: "2024-01-01", seniorityDate: null, placement: placement(), ...overrides },
    actorId,
  ).catch((error: Error) => Promise.reject(new Error(error.message)));
  return result.person.id;
}

function principal(personId: string | null, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal {
  return { personId, workforceType, grants };
}

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mocked db is a PGlite drizzle instance
  await migrate(db() as any, { migrationsFolder: "./drizzle" });
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "Suzu Media", shortName: "Media" },
      { code: "SZC", legalName: "Suzu Creative", shortName: "Creative" },
    ])
    .returning();
  const [video, design] = await db()
    .insert(schema.department)
    .values([
      { code: "VID", name: "Video" },
      { code: "DES", name: "Design" },
    ])
    .returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, design: design.id });

  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  actorId = actor.id;
  ids.long = await hire("Dang Hoang Long", ids.media, { placement: placement({ departmentId: ids.video }) });
  ids.tam = await hire("Bui Thanh Tam", ids.media, { placement: placement({ departmentId: ids.video, managerId: ids.long }) });
  ids.huy = await hire("Ho Gia Huy", ids.media, { placement: placement({ departmentId: ids.video, managerId: ids.tam, workforceType: "probation" }) });
  ids.chi = await hire("Duong Thuy Chi", ids.creative, { placement: placement({ departmentId: ids.design }) });
  ids.ctv = await hire("Ngo Bao Anh", ids.media, { workEmail: null, placement: placement({ departmentId: ids.video, workforceType: "collaborator" }) });
  ids.future = await hire("Mai Anh Thu", ids.creative, { startDate: addDays(today, 30), placement: placement({ departmentId: ids.design, managerId: ids.chi }) });
});

describe("hirePerson", () => {
  it("numbers employees per entity and skips codes already used by hand", async () => {
    const codes = await db().select({ code: schema.employment.employeeCode }).from(schema.employment);
    expect(codes.map((row) => row.code).sort()).toEqual(["SZC-0001", "SZC-0002", "SZM-0001", "SZM-0002", "SZM-0003", "SZM-0004"]);

    await hire("Manual Code", ids.media, { employeeCode: " szm-0005 " });
    const next = await hire("After Manual", ids.media);
    const view = await getPersonView(principal(next), next);
    expect(view?.employeeCode).toBe("SZM-0006");
    await expect(hire("Duplicate Code", ids.media, { employeeCode: "SZM-0005" })).rejects.toThrow("employee_code_taken");
  });

  it("marks a future starter as pre-boarding and mirrors the placement onto the person", async () => {
    const [row] = await db().select().from(schema.person).where(eqId(ids.future));
    expect(row).toMatchObject({ status: "preboarding", primaryEntityId: ids.creative, departmentId: ids.design, managerId: ids.chi });
  });

  it("guards the sign-in identity: allowed domains, one owner per address, bootstrap addresses reserved", async () => {
    await expect(hire("Gmail User", ids.media, { workEmail: "someone@gmail.com" })).rejects.toThrow("work_email_domain");
    await expect(hire("Second Long", ids.media, { workEmail: "DANG.hoang.long@suzu.group" })).rejects.toThrow("work_email_taken");
    await expect(hire("Fake Chairman", ids.media, { workEmail: "chairman@suzu.vn" })).rejects.toThrow("work_email_reserved");
  });

  it("rolls everything back when a late step fails", async () => {
    const before = await db().$count(schema.person);
    await expect(hire("Bad Manager", ids.media, { placement: placement({ managerId: "11111111-1111-4111-8111-111111111111" }) })).rejects.toThrow("manager_not_found");
    await expect(hire("Taken Code", ids.media, { employeeCode: "SZM-0001" })).rejects.toThrow("employee_code_taken");
    expect(await db().$count(schema.person)).toBe(before);
  });
});

describe("listPeople", () => {
  const everyone = () => [ids.long, ids.tam, ids.huy, ids.chi, ids.ctv, ids.future];

  it("shows colleagues the active directory only, without personal facts", async () => {
    const { rows } = await listPeople(principal(ids.chi), {});
    expect(rows.map((row) => row.id)).not.toContain(ids.future);
    const huy = rows.find((row) => row.id === ids.huy);
    expect(huy).toMatchObject({ employeeCode: "SZM-0003", workforceType: null, status: null });
    // …but your own row is yours to see.
    expect(rows.find((row) => row.id === ids.chi)?.workforceType).toBe("employee");
  });

  it("ignores personal-fact filters from people who cannot read that tier: they only ever match themselves", async () => {
    // Huy manages nobody and holds no role.
    const employees = await listPeople(principal(ids.huy), { workforceType: "employee" });
    expect(employees.rows).toEqual([]);
    const all = await listPeople(principal(ids.huy), { status: "all" });
    expect(all.rows.map((row) => row.id)).toEqual([ids.huy]);
  });

  it("agrees with canReadTier for every viewer: the SQL scope is the policy", async () => {
    const viewers: Principal[] = [
      principal(ids.chi),
      principal(ids.long),
      principal(ids.tam),
      principal(ids.ctv, [], "collaborator"),
      principal(null, [{ role: "owner", scope: { type: "group" } }]),
      principal(null, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]),
      principal(null, [{ role: "department_head", scope: { type: "department", id: ids.design } }]),
      principal(null, [{ role: "asset_admin", scope: { type: "group" } }]),
      principal(null, [{ role: "recruiter", scope: { type: "group" } }]),
    ];
    for (const viewer of viewers) {
      const listed = new Set((await listPeople(viewer, { status: "all" })).rows.map((row) => row.id));
      for (const personId of everyone()) {
        const target = (await getPersonTarget(personId))!;
        expect(listed.has(personId), `${JSON.stringify(viewer)} → ${personId}`).toBe(canReadTier(viewer, target, "personal"));
      }
    }
  });

  it("searches without accents and by employee code, and sorts by given name", async () => {
    const owner = principal(null, [{ role: "owner", scope: { type: "group" } }]);
    expect((await listPeople(owner, { q: "gia huy" })).rows.map((row) => row.id)).toEqual([ids.huy]);
    expect((await listPeople(owner, { q: "szc-0001" })).rows.map((row) => row.id)).toEqual([ids.chi]);
    expect((await listPeople(owner, { q: "100%_" })).rows).toEqual([]);
    const names = (await listPeople(owner, { entityId: ids.media, departmentId: ids.video })).rows.map((row) => row.fullName);
    expect(names).toEqual(["Ngo Bao Anh", "Ho Gia Huy", "Dang Hoang Long", "Bui Thanh Tam"]);
  });
});

describe("getPersonView", () => {
  it("shapes the record by tier", async () => {
    const asColleague = await getPersonView(principal(ids.chi), ids.huy);
    expect(asColleague).toMatchObject({ tier: "public_internal", personal: null, canManage: false, employeeCode: "SZM-0003" });

    const asManager = await getPersonView(principal(ids.tam), ids.huy);
    expect(asManager?.tier).toBe("personal");
    expect(asManager?.personal?.profile?.phone).toBe("0900000000");
    expect(asManager?.canManage).toBe(false);

    const asHr = await getPersonView(principal(null, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]), ids.huy);
    expect(asHr).toMatchObject({ tier: "restricted", canManage: true });
  });

  it("hides collaborators' view of others, and people outside the active directory", async () => {
    expect(await getPersonView(principal(ids.ctv, [], "collaborator"), ids.huy)).toBeNull();
    expect((await getPersonView(principal(ids.ctv, [], "collaborator"), ids.ctv))?.tier).toBe("compensation");
    expect(await getPersonView(principal(ids.long), ids.future)).toBeNull();
    expect((await getPersonView(principal(ids.chi), ids.future))?.personal?.status).toBe("preboarding");
  });
});

describe("changeAssignment", () => {
  const change = (personId: string, validFrom: string, overrides: Partial<HireInput["placement"]>) =>
    changeAssignment(personId, { validFrom, changeReason: "test", placement: placement({ departmentId: ids.video, ...overrides }) }, actorId).catch((error: Error) =>
      Promise.reject(new Error(error.message)),
    );

  it("applies a change dated today to the person at once, and leaves a future one for later", async () => {
    await change(ids.huy, today, { managerId: ids.long, workforceType: "employee" });
    let [row] = await db().select().from(schema.person).where(eqId(ids.huy));
    expect(row).toMatchObject({ managerId: ids.long, workforceType: "employee" });

    await change(ids.huy, addDays(today, 10), { managerId: ids.tam });
    [row] = await db().select().from(schema.person).where(eqId(ids.huy));
    expect(row.managerId).toBe(ids.long);

    const view = await getPersonView(principal(ids.huy), ids.huy);
    expect(view?.personal?.history.map((item) => [item.validFrom, item.validTo])).toEqual([
      [addDays(today, 10), null],
      [today, addDays(today, 9)],
      ["2024-01-01", addDays(today, -1)],
    ]);
    expect(view?.current?.managerId).toBe(ids.long);
  });

  it("refuses loops, self-management and mismatched org units", async () => {
    await expect(change(ids.long, today, { managerId: ids.tam })).rejects.toThrow("manager_loop");
    await expect(change(ids.tam, today, { managerId: ids.tam })).rejects.toThrow("manager_is_self");
    await expect(change(ids.tam, "2023-01-01", {})).rejects.toThrow("assignment_before_employment_start");
    const [team] = await db().insert(schema.team).values({ departmentId: ids.design, name: "UI" }).returning();
    await expect(change(ids.tam, today, { teamId: team.id })).rejects.toThrow("team_not_in_department");
  });
});

describe("rollOverPlacements", () => {
  it("applies future-dated changes and activates new starters when their day comes, once", async () => {
    expect(await rollOverPlacements(today)).toEqual({ placementsUpdated: 0, peopleActivated: 0 });

    // Huy's manager change was dated ten days ahead by the test above.
    expect(await rollOverPlacements(addDays(today, 10))).toEqual({ placementsUpdated: 1, peopleActivated: 0 });
    const [huy] = await db().select().from(schema.person).where(eqId(ids.huy));
    expect(huy.managerId).toBe(ids.tam);

    expect(await rollOverPlacements(addDays(today, 29))).toEqual({ placementsUpdated: 0, peopleActivated: 0 });
    expect(await rollOverPlacements(addDays(today, 30))).toEqual({ placementsUpdated: 0, peopleActivated: 1 });
    const [future] = await db().select().from(schema.person).where(eqId(ids.future));
    expect(future.status).toBe("active");
    expect(await rollOverPlacements(addDays(today, 30))).toEqual({ placementsUpdated: 0, peopleActivated: 0 });
  });
});

describe("updatePersonBasics", () => {
  it("keeps the search key in step with the name and lets a person keep their own email", async () => {
    const { after } = await updatePersonBasics(ids.tam, { fullName: "Bùi  Thanh Tâm", workEmail: "bui.thanh.tam@suzu.group", profile: NO_PROFILE });
    expect(after.person).toMatchObject({ fullName: "Bùi Thanh Tâm", searchName: "bui thanh tam" });
    await expect(updatePersonBasics(ids.tam, { fullName: "Bùi Thanh Tâm", workEmail: "ho.gia.huy@suzu.group", profile: NO_PROFILE })).rejects.toThrow("work_email_taken");
  });
});
