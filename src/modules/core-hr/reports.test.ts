// Reports and exports against a real Postgres (PGlite): a viewer's slice of the headcount, and
// that an export file holds exactly what the list would show that viewer.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { buildHeadcountExport, buildPeopleExport } from "./exports";
import { terminateEmployment } from "./lifecycle";
import { getHeadcountReport } from "./reports";
import { hirePerson } from "./service";

const today = todayInVietnam();
const ids = {} as Record<"media" | "creative" | "video" | "design" | "actor" | "head" | "huy" | "khoi", string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const period = { asOf: today, from: addDays(today, -30), to: today };

async function hire(name: string, entityId: string, orgUnitId: string, managerId: string | null, more: { type?: "employee" | "probation"; gender?: "male" | "female"; start?: string } = {}) {
  const { person } = await hirePerson(
    {
      fullName: name,
      workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
      profile: { dateOfBirth: "1996-01-01", gender: more.gender ?? "female", maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
      entityId,
      employeeCode: null,
      startDate: more.start ?? "2022-01-01",
      seniorityDate: null,
      placement: { workforceType: more.type ?? "employee", branchId: null, orgUnitId, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null },
    },
    ids.actor,
    { onboarding: false },
  );
  return person.id;
}

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const [video, design] = await db().insert(schema.orgUnit).values([{ code: "VID", name: "Video" }, { code: "DES", name: "Design" }]).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, design: design.id, actor: actor.id });

  ids.head = await hire("Video Head", media.id, video.id, null, { gender: "male" });
  ids.huy = await hire("Ho Gia Huy", media.id, video.id, ids.head, { gender: "male" });
  await hire("New Probationer", media.id, video.id, ids.head, { type: "probation", start: addDays(today, -10) });
  const leaver = await hire("Video Leaver", media.id, video.id, ids.head);
  await terminateEmployment(leaver, { lastDay: addDays(today, -5), reason: "resignation", note: null }, ids.actor);
  ids.khoi = await hire("Ly Minh Khoi", creative.id, design.id, null);
  await hire("Design Two", creative.id, design.id, ids.khoi);
  await hire("=cmd Injection", creative.id, design.id, ids.khoi);
});

describe("headcount report", () => {
  it("is refused without report:read", async () => {
    expect(await getHeadcountReport(principal(ids.huy), period)).toBeNull();
    expect(await getHeadcountReport(principal(ids.huy, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]), period)).toBeNull();
  });

  it("counts the whole group for a group-wide reader", async () => {
    const report = (await getHeadcountReport(principal("x", [{ role: "hr_admin", scope: { type: "group" } }]), period))!;
    expect(report.scoped).toBe(false);
    expect(report.snapshot.total).toBe(6);
    expect(report.snapshot.byEntity).toEqual([{ key: "Creative", count: 3 }, { key: "Media", count: 3 }]);
    expect(report.snapshot.byGender).toEqual([{ key: "female", count: 4 }, { key: "male", count: 2 }]);
    expect(report.movement).toMatchObject({ joiners: 1, leavers: 1, opening: 6, closing: 6 });
  });

  it("gives a department head only their department, and an entity director only their entity", async () => {
    const head = (await getHeadcountReport(principal(ids.head, [{ role: "department_head", scope: { type: "unit", id: ids.video } }]), period))!;
    expect(head.scoped).toBe(true);
    expect(head.snapshot.total).toBe(3);
    expect(head.snapshot.byDepartment).toEqual([{ key: "Video", count: 3 }]);
    expect(head.snapshot.byEntity).toEqual([{ key: "Media", count: 3 }]);
    expect(head.movement.leavers).toBe(1);

    const director = (await getHeadcountReport(principal("d", [{ role: "entity_director", scope: { type: "entity", id: ids.creative } }]), period))!;
    expect(director.snapshot.total).toBe(3);
    expect(director.movement.leavers).toBe(0);
    // Asking for another entity does not widen the scope.
    expect((await getHeadcountReport(principal("d", [{ role: "entity_director", scope: { type: "entity", id: ids.creative } }]), { ...period, entityId: ids.media }))!.snapshot.total).toBe(0);
  });

  it("exports the same scoped figures", async () => {
    const { file, scoped } = await buildHeadcountExport(principal(ids.head, [{ role: "department_head", scope: { type: "unit", id: ids.video } }]), period, "en");
    expect(scoped).toBe(true);
    expect(file.csv).toContain("Total headcount");
    expect(file.csv).toContain("By department,Video,3");
    expect(file.csv).not.toContain("Design");
  });
});

describe("people export", () => {
  it("as a line manager: personal-tier columns only for their own reports, never for people outside their reach", async () => {
    const { file, total } = await buildPeopleExport(principal(ids.head), {}, "en");
    expect(total).toBe(6);
    expect(file.rowCount).toBe(6);
    const lines = file.csv.trim().split("\r\n");
    const header = lines[0].replace("﻿", "").split(",");
    const cells = (name: string) => lines.find((line) => line.includes(name))!.split(",");
    const [type, status] = [header.indexOf("Workforce type"), header.indexOf("Status")];
    expect(type).toBeGreaterThan(0);
    // His direct report: workforce type and status are there.
    expect([cells("Ho Gia Huy")[type], cells("Ho Gia Huy")[status]]).toEqual(["Employee", "Active"]);
    // Someone in another entity: directory columns only.
    expect([cells("Ly Minh Khoi")[type], cells("Ly Minh Khoi")[status]]).toEqual(["", ""]);
    expect(cells("Ly Minh Khoi")[header.indexOf("Department")]).toBe("Design");
    // A former colleague is not part of the directory at all.
    expect(file.csv).not.toContain("Video Leaver");
  });

  it("defuses a name that a spreadsheet would run", async () => {
    const { file } = await buildPeopleExport(principal(ids.head), {}, "en");
    expect(file.csv).toContain("'=cmd Injection");
  });
});
