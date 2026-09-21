// Lifecycle use-cases against a real Postgres (PGlite): what a hire starts, what a termination
// ends — and when — and that a returning employee stays one person.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { countInbox } from "@/modules/platform/approvals/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { loadGrants } from "@/modules/platform/rbac/service";
import { listMyTasks } from "@/modules/platform/tasks-engine/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { cancelTermination, findLikelyDuplicates, listLifecycleEvents, recordEvent, rehirePerson, terminateEmployment } from "./lifecycle";
import { decideResignation, getResignation, submitResignation } from "./resignation";
import { changeAssignment, hirePerson, type HireInput, rollOverPlacements } from "./service";

const today = todayInVietnam();
const ids = {} as Record<"media" | "video" | "actor" | "manager" | "hr" | "owner", string>;
const NO_PROFILE = { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null };
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });

async function hire(name: string, overrides: Partial<HireInput> = {}, managerId: string | null = ids.manager ?? null) {
  return hirePerson(
    {
      fullName: name,
      workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
      profile: NO_PROFILE,
      entityId: ids.media,
      employeeCode: null,
      startDate: "2024-01-01",
      seniorityDate: null,
      placement: { workforceType: "employee", branchId: null, orgUnitId: ids.video, positionName: "Editor", jobLevel: null, managerId, dottedManagerId: null, workLocation: null },
      ...overrides,
    },
    ids.actor,
  ).catch((error: Error) => Promise.reject(new Error(error.message)));
}

const personRow = async (personId: string) => (await db().select().from(schema.person).where(eq(schema.person.id, personId)))[0];
const tasksAbout = (personId: string) => db().select().from(schema.task).where(eq(schema.task.subjectPersonId, personId)).orderBy(schema.task.sortOrder);

async function signIn(email: string) {
  const userId = `user-${email}`;
  await db().insert(schema.user).values({ id: userId, name: email, email, emailVerified: true }).onConflictDoNothing();
  await db().insert(schema.session).values({ id: `session-${email}-${Math.random()}`, userId, token: `token-${email}-${Math.random()}`, expiresAt: new Date(Date.now() + 86_400_000) });
  return () => db().select().from(schema.session).where(eq(schema.session.userId, userId));
}

beforeAll(async () => {
  await migrateTestDb();
  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  Object.assign(ids, { media: media.id, video: video.id, actor: actor.id });

  ids.manager = (await hire("Line Manager", {}, null)).person.id;
  ids.hr = (await hire("Hr Staff", {}, null)).person.id;
  ids.owner = (await hire("The Owner", {}, null)).person.id;
  await db().insert(schema.roleAssignment).values([
    { personId: ids.hr, role: "hr_staff", scopeType: "entity", scopeId: media.id },
    { personId: ids.owner, role: "owner", scopeType: "group" },
  ]);

  const [template] = await db().insert(schema.taskTemplate).values({ purpose: "onboarding", name: "Default onboarding" }).returning();
  await db().insert(schema.taskTemplateItem).values([
    { templateId: template.id, title: "Create account", assigneeRule: "permission:person:manage", dueOffsetDays: -3, sortOrder: 0 },
    { templateId: template.id, title: "First-week plan", assigneeRule: "line_manager", dueOffsetDays: 0, sortOrder: 1 },
    { templateId: template.id, title: "Read the handbook", assigneeRule: "subject", dueOffsetDays: 5, sortOrder: 2 },
  ]);
  const [offboarding] = await db().insert(schema.taskTemplate).values({ purpose: "offboarding", name: "Default offboarding" }).returning();
  await db().insert(schema.taskTemplateItem).values([{ templateId: offboarding.id, title: "Return equipment", assigneeRule: "permission:person:manage", dueOffsetDays: 0, sortOrder: 0 }]);
});

describe("hire", () => {
  it("writes the hire event and starts the onboarding checklist with the right people and dates", async () => {
    const start = addDays(today, 10);
    const { person, event, tasks } = await hire("New Starter", { startDate: start });
    expect(event).toMatchObject({ type: "hire", status: "applied", effectiveDate: start, entityId: ids.media });
    expect((event.details as { to: { position: string; department: string; manager: string } }).to).toMatchObject({ position: "Editor", department: "Video", manager: "Line Manager" });
    expect(tasks).toHaveLength(3);

    const rows = await tasksAbout(person.id);
    expect(rows.map((task) => [task.title, task.assigneePersonId, task.dueDate, task.contextType, task.contextId])).toEqual([
      ["Create account", ids.hr, addDays(start, -3), "lifecycle_event", event.id],
      ["First-week plan", ids.manager, start, "lifecycle_event", event.id],
      ["Read the handbook", person.id, addDays(start, 5), "lifecycle_event", event.id],
    ]);
    // HR was told once, not once per task; the owner's "*" is not who routine work goes to.
    expect((await listMyTasks(ids.hr)).open.some((task) => task.subjectPersonId === person.id)).toBe(true);
    expect((await listMyTasks(ids.owner)).open).toHaveLength(0);
    const notices = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.manager), eq(schema.notification.kind, "tasks.assigned")));
    expect(notices.length).toBeGreaterThan(0);
  });

  it("starts no checklist when told not to (bulk import of long-standing staff)", async () => {
    const { person, event } = await hirePerson(
      { fullName: "Old Hand", workEmail: null, profile: NO_PROFILE, entityId: ids.media, employeeCode: null, startDate: "2020-01-01", seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: ids.video, positionName: null, jobLevel: null, managerId: null, dottedManagerId: null, workLocation: null } },
      ids.actor,
      { onboarding: false },
    );
    expect(event.type).toBe("hire");
    expect(await tasksAbout(person.id)).toHaveLength(0);
  });
});

describe("transfer and promotion", () => {
  it("records an event with a from → to snapshot; a correction records none", async () => {
    const { person } = await hire("Moving Person");
    const placement = { workforceType: "employee" as const, branchId: null, orgUnitId: ids.video, positionName: "Senior Editor", jobLevel: "L3", managerId: ids.manager, dottedManagerId: null, workLocation: null };
    const { event } = await changeAssignment(person.id, { validFrom: "2025-01-01", changeReason: "Good year", placement, kind: "promotion" }, ids.actor);
    expect(event).toMatchObject({ type: "promotion", effectiveDate: "2025-01-01", reason: "Good year" });
    expect(event!.details).toMatchObject({ from: { position: "Editor" }, to: { position: "Senior Editor", jobLevel: "L3" } });

    const { event: none } = await changeAssignment(person.id, { validFrom: "2025-01-01", changeReason: null, placement: { ...placement, jobLevel: "L4" } }, ids.actor);
    expect(none).toBeNull();
    const timeline = await listLifecycleEvents(principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]), person.id);
    expect(timeline!.map((row) => row.type)).toEqual(["promotion", "hire"]);
  });
});

describe("termination", () => {
  it("ends everything on the last day, but access only once that day has passed", async () => {
    const { person, employment } = await hire("Leaving Soon");
    await db().insert(schema.roleAssignment).values({ personId: person.id, role: "department_head", scopeType: "unit", scopeId: ids.video });
    const sessions = await signIn("leaving.soon@suzu.group");
    const lastDay = addDays(today, 5);

    const result = await terminateEmployment(person.id, { lastDay, reason: "resignation", note: null }, ids.actor);
    expect(result.offboardedNow).toBe(false);
    expect(result.event).toMatchObject({ type: "termination", status: "pending", effectiveDate: lastDay });
    expect(result.tasks.map((task) => [task.title, task.assigneePersonId, task.dueDate])).toEqual([["Return equipment", ids.hr, lastDay]]);

    const [ended] = await db().select().from(schema.employment).where(eq(schema.employment.id, employment.id));
    expect(ended.endDate).toBe(lastDay);
    const assignments = await db().select().from(schema.assignment).where(eq(schema.assignment.employmentId, employment.id));
    expect(assignments.map((row) => row.validTo)).toEqual([lastDay]);
    // Still working: active, signed in, and the grant holds until the last day — not a day longer.
    expect((await personRow(person.id)).status).toBe("active");
    expect(await sessions()).toHaveLength(1);
    expect(await loadGrants(person.id, lastDay)).toHaveLength(1);
    expect(await loadGrants(person.id, addDays(lastDay, 1))).toHaveLength(0);

    expect((await rollOverPlacements(lastDay)).peopleOffboarded).toBe(0);
    expect((await personRow(person.id)).status).toBe("active");
    expect((await rollOverPlacements(addDays(lastDay, 1))).peopleOffboarded).toBe(1);
    expect((await personRow(person.id)).status).toBe("offboarded");
    expect(await sessions()).toHaveLength(0);
    const [event] = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, result.event.id));
    expect(event.status).toBe("applied");
    // Once, not every night.
    expect((await rollOverPlacements(addDays(lastDay, 2))).peopleOffboarded).toBe(0);

    await expect(terminateEmployment(person.id, { lastDay, reason: "other", note: null }, ids.actor)).rejects.toThrow("already_terminated");
  });

  it("locks the person out at once when the last day is already past", async () => {
    const { person } = await hire("Already Gone");
    const sessions = await signIn("already.gone@suzu.group");
    const result = await terminateEmployment(person.id, { lastDay: addDays(today, -1), reason: "contract_end", note: null }, ids.actor);
    expect(result.offboardedNow).toBe(true);
    expect(result.event.status).toBe("applied");
    expect((await personRow(person.id)).status).toBe("offboarded");
    expect(await sessions()).toHaveLength(0);
  });

  it("can be called off before it takes effect: employment, assignment and grants reopen, the checklist is cancelled", async () => {
    const { person, employment } = await hire("Changed Mind");
    await db().insert(schema.roleAssignment).values({ personId: person.id, role: "recruiter", scopeType: "group" });
    const { event } = await terminateEmployment(person.id, { lastDay: addDays(today, 20), reason: "resignation", note: null }, ids.actor);
    const { cancelledTasks } = await cancelTermination(event.id);
    expect(cancelledTasks).toBe(1);
    const [reopened] = await db().select().from(schema.employment).where(eq(schema.employment.id, employment.id));
    expect(reopened.endDate).toBeNull();
    expect((await db().select().from(schema.assignment).where(eq(schema.assignment.employmentId, employment.id))).map((row) => row.validTo)).toEqual([null]);
    expect(await loadGrants(person.id, addDays(today, 400))).toHaveLength(1);
    await expect(cancelTermination(event.id)).rejects.toThrow("event_not_found");
  });

  it("refuses to end the last owner's access", async () => {
    await expect(terminateEmployment(ids.owner, { lastDay: today, reason: "other", note: null }, ids.actor)).rejects.toThrow("last_owner");
    expect((await db().select().from(schema.employment).where(eq(schema.employment.personId, ids.owner)))[0].endDate).toBeNull();
  });
});

describe("rehire and duplicates", () => {
  it("keeps one person with two employment periods", async () => {
    const { person, employment: first } = await hire("Coming Back", { profile: { ...NO_PROFILE, dateOfBirth: "1995-05-05", phone: "0912 345 678" } });
    await terminateEmployment(person.id, { lastDay: addDays(today, -30), reason: "resignation", note: null }, ids.actor);
    const placement = { workforceType: "employee" as const, branchId: null, orgUnitId: ids.video, positionName: "Editor", jobLevel: null, managerId: ids.manager, dottedManagerId: null, workLocation: null };

    await expect(rehirePerson(person.id, { entityId: ids.media, employeeCode: null, startDate: addDays(today, -40), seniorityDate: null, placement }, ids.actor)).rejects.toThrow("employment_overlap");
    const again = await rehirePerson(person.id, { entityId: ids.media, employeeCode: null, startDate: today, seniorityDate: null, placement }, ids.actor);
    expect(again.event.type).toBe("rehire");
    expect(again.employment.employeeCode).not.toBe(first.employeeCode);
    expect((await personRow(person.id)).status).toBe("active");
    expect(await db().select().from(schema.employment).where(eq(schema.employment.personId, person.id))).toHaveLength(2);
    expect(await db().select().from(schema.person).where(eq(schema.person.searchName, "coming back"))).toHaveLength(1);
    await expect(rehirePerson(person.id, { entityId: ids.media, employeeCode: null, startDate: addDays(today, 50), seniorityDate: null, placement }, ids.actor)).rejects.toThrow("still_employed");
  });

  it("finds likely duplicates by name + birth date, phone or personal email", async () => {
    const found = await findLikelyDuplicates({ fullName: "  coming   BACK ", dateOfBirth: "1995-05-05", personalEmail: null, phone: null });
    expect(found.map((row) => [row.fullName, row.reasons])).toEqual([["Coming Back", ["name_and_birth"]]]);
    expect((await findLikelyDuplicates({ fullName: "Someone Else", dateOfBirth: null, personalEmail: null, phone: "0912345678" }))[0].reasons).toEqual(["phone"]);
    // The name alone is not enough: Vietnamese names repeat.
    expect(await findLikelyDuplicates({ fullName: "Coming Back", dateOfBirth: "1990-01-01", personalEmail: null, phone: null })).toEqual([]);
  });
});

describe("resignation request", () => {
  it("goes to the line manager; approval leaves a pending resignation for HR to carry out", async () => {
    const { person } = await hire("Wants Out");
    const lastWorkingDay = addDays(today, 30);
    const { request } = await submitResignation(person.id, { lastWorkingDay, reason: "Moving abroad" });
    expect(await countInbox(ids.manager)).toBe(1);
    await expect(submitResignation(person.id, { lastWorkingDay, reason: null })).rejects.toThrow("resignation_open");

    const hr = { personId: ids.hr, principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]) };
    const colleague = (await hire("Nosy Colleague")).person.id;
    expect((await getResignation(hr, request.id))?.canDecide).toBe(false);
    expect(await getResignation({ personId: colleague, principal: principal(colleague) }, request.id)).toBeNull();
    await expect(decideResignation(ids.hr, request.id, { action: "approve", comment: null })).rejects.toThrow();

    const { outcome, eventId } = await decideResignation(ids.manager, request.id, { action: "approve", comment: null });
    expect(outcome).toBe("approved");
    const [event] = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, eventId!));
    expect(event).toMatchObject({ type: "resignation", status: "pending", effectiveDate: lastWorkingDay, approvalRequestId: request.id });
    // Approval alone ends nothing.
    expect((await db().select().from(schema.employment).where(eq(schema.employment.personId, person.id)))[0].endDate).toBeNull();
    expect((await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.hr), eq(schema.notification.kind, "hr.resignation_approved")))).length).toBe(1);

    await terminateEmployment(person.id, { lastDay: lastWorkingDay, reason: "resignation", note: null, resignationEventId: event.id }, ids.hr);
    expect((await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, event.id)))[0].status).toBe("applied");
  });
});

describe("timeline tiers", () => {
  it("shows discipline notes at the restricted tier only, and nothing below the personal tier", async () => {
    const { person } = await hire("Warned Once");
    await recordEvent(person.id, { type: "discipline", effectiveDate: today, reason: "Late three times", note: "Written warning, details…" }, ids.actor);
    const note = async (viewer: Principal) => (await listLifecycleEvents(viewer, person.id))?.find((event) => event.type === "discipline")?.note;
    expect(await note(principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]))).toBe("Written warning, details…");
    // The line manager reads the personal tier: sees that it happened, not the note.
    expect(await note(principal(ids.manager))).toBeNull();
    expect((await listLifecycleEvents(principal(ids.manager), person.id))!.length).toBe(2);
    expect(await listLifecycleEvents(principal(ids.owner), person.id)).toBeNull();
  });
});
