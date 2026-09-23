// Compliance on the delivery dashboard is team totals, never a list of people (FR-PJM-60) — and a
// total over one person is that person (security review, finding 22). Against a real Postgres
// (PGlite): a `work:manage` reader sees the teams of their scope, but a team of one is folded into
// "other teams" or left out of the dashboard, totals included; a lead still sees their own team
// whatever its size.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string, values: Record<string, unknown> = {}) => `${key}:${values.count ?? ""}` }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {},
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { getDeliveryDashboard } from "./delivery";

type Who = "lead" | "one" | "two" | "solo" | "alone" | "head";
const ids = {} as Record<Who | "szm" | "dept" | "video" | "copy" | "studio", string>;
const people = {} as Record<Who, { person: { id: string; primaryEntityId: string | null }; principal: Principal }>;
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const TODAY = "2026-10-01";

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const [dept] = await db().insert(schema.orgUnit).values({ name: "Marketing", kind: "department", entityId: szm.id }).returning();
  ids.dept = dept.id;
  const grants: Record<Who, Grant[]> = { lead: [], one: [], two: [], solo: [], alone: [], head: [{ role: "department_head", scope: { type: "unit", id: dept.id } }] };
  for (const who of Object.keys(grants) as Who[]) {
    const [person] = await db().insert(schema.person).values({ fullName: `Người ${who}`, searchName: who, workEmail: `${who}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[who] = person.id;
    people[who] = { person, principal: { personId: person.id, workforceType: "employee", grants: grants[who] } };
  }
  await db().insert(schema.roleAssignment).values({ personId: ids.head, role: "department_head", scopeType: "unit", scopeId: dept.id, validFrom: "2026-01-01" });

  const team = async (key: string, name: string, members: [Who, "lead" | "member"][]) => {
    const [row] = await db().insert(schema.workTeam).values({ key, name, entityId: szm.id, departmentId: dept.id }).returning();
    await db().insert(schema.workTeamMember).values(members.map(([who, role]) => ({ teamId: row.id, personId: ids[who], role })));
    return row.id;
  };
  ids.video = await team("VID", "Video", [
    ["lead", "lead"],
    ["one", "member"],
    ["two", "member"],
  ]);
  ids.copy = await team("CPY", "Copywriting", [["solo", "lead"]]);
});

describe("compliance rows on the delivery dashboard", () => {
  it("a lead sees their own team, however small", async () => {
    const view = await getDeliveryDashboard(people.solo, PERIOD, TODAY);
    expect(view.compliance?.teams.map((team) => team.teamId)).toEqual([ids.copy]);
    expect(view.compliance?.teams[0].people).toBe(1);
  });

  it("a portfolio reader gets no row for a team that is one person, and no total of them", async () => {
    const view = await getDeliveryDashboard(people.head, PERIOD, TODAY);
    expect(view.compliance?.teams.map((team) => team.teamId)).toEqual([ids.video]);
    // Copywriting is not hidden in the total either: it could be read back by subtraction.
    expect(view.compliance?.total.reports.due).toBe(view.compliance?.teams[0].reports.due);
    expect(JSON.stringify(view.compliance)).not.toContain("Copywriting");
    expect(JSON.stringify(view.compliance)).not.toContain(ids.solo);
  });

  it("two one-person teams make one 'other teams' row", async () => {
    ids.studio = (await db().insert(schema.workTeam).values({ key: "STU", name: "Studio", entityId: ids.szm, departmentId: ids.dept }).returning())[0].id;
    await db().insert(schema.workTeamMember).values({ teamId: ids.studio, personId: ids.alone, role: "lead" });
    const view = await getDeliveryDashboard(people.head, PERIOD, TODAY);
    const rows = view.compliance!.teams;
    expect(rows.map((team) => team.teamId)).toEqual([ids.video, "other"]);
    expect(rows.find((team) => team.teamId === "other")).toMatchObject({ people: 2, name: "otherTeams:2" });
    expect(JSON.stringify(rows)).not.toContain("Studio");
  });
});
