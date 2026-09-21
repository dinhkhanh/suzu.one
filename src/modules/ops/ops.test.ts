// The ops tracker against a real Postgres (PGlite): generation, shifting through the real calendar
// rows, the pull from HR events, evidence-required completion and who may do what.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { movesThroughEngine } from "../platform/tasks-engine/policy";
import { NO_EVIDENCE, OBLIGATION_FILE_OWNER } from "./enums";
import { cancelInstance, completeInstance, listInstances, loadInstance, reassignInstance, reopenInstance, saveProgress } from "./instances";
import { canViewInstance, canWorkInstance } from "./policy";
import { generateInstances } from "./scheduler";
import { OBLIGATION_LIBRARY } from "./seed-library";
import { saveTemplate, setReviewStatus, type TemplateInput, templateProblem } from "./templates";

const ids = {} as Record<"szm" | "szc" | "finance" | "hrSzm" | "hrAdmin" | "ceo" | "owner" | "newHire" | "employment", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error & { details?: unknown }) => ({ message: error.message, details: error.details }));
const TODAY = "2026-09-20";

const base: TemplateInput = { code: "X", name: "X", category: "external", authority: "tax", recurrence: "monthly", dueRule: { type: "after_period", monthsAfter: 1, day: 20 }, shift: "next_working_day", eventType: null, entityIds: null, ownerRule: "role:finance", ownerPersonId: null, reviewerRule: "none", reviewerPersonId: null, checklist: [], guidance: null, links: [], reminderLeadDays: [7, 3, 1], escalation: { managerAfterDays: 3, executiveAfterDays: 7 }, evidence: NO_EVIDENCE, penaltyNote: null, isActive: true };

const instancesOf = async (code: string) =>
  db()
    .select({ instance: schema.obligationInstance, task: schema.task })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .where(eq(schema.obligationTemplate.code, code))
    .orderBy(schema.obligationInstance.periodKey);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  await db().insert(schema.entity).values({ code: "OLD", legalName: "Closed", shortName: "Closed", isActive: false });
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  const people: [keyof typeof ids, string, string][] = [["finance", "Tuan Vo", szc.id], ["hrSzm", "Bao Pham", szm.id], ["hrAdmin", "Mai Le", szc.id], ["ceo", "Ha Nguyen", szc.id], ["owner", "Khanh Tran", szc.id], ["newHire", "Thu Mai", szm.id]];
  for (const [key, name, entityId] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key.toLowerCase()}@suzu.group`, status: "active", primaryEntityId: entityId }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values([
    { personId: ids.finance, role: "finance", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
    { personId: ids.hrSzm, role: "hr_staff", scopeType: "entity", scopeId: szm.id, validFrom: "2020-01-01" },
    { personId: ids.hrAdmin, role: "hr_admin", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
    { personId: ids.ceo, role: "c_level", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
    { personId: ids.owner, role: "owner", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
  ]);
  const [employment] = await db().insert(schema.employment).values({ personId: ids.newHire, entityId: szm.id, employeeCode: "SZM-0099", startDate: "2026-09-14", seniorityDate: "2026-09-14" }).returning();
  ids.employment = employment.id;
  // National Day 2026 for the group; SZM alone takes Monday 21 September off.
  await db().insert(schema.calendarDay).values([
    { entityId: null, date: "2026-09-02", kind: "public_holiday", name: "Quốc khánh" },
    { entityId: szm.id, date: "2026-09-21", kind: "company_off", name: "Ngày thành lập" },
  ]);
});

describe("the starter library", () => {
  it("every template is valid and codes are unique", () => {
    expect(OBLIGATION_LIBRARY.map((row) => [row.code, templateProblem(row)]).filter(([, problem]) => problem)).toEqual([]);
    expect(new Set(OBLIGATION_LIBRARY.map((row) => row.code)).size).toBe(OBLIGATION_LIBRARY.length);
    expect(OBLIGATION_LIBRARY.every((row) => row.guidance?.includes("Bản nháp"))).toBe(true);
  });
});

describe("templates", () => {
  it("refuses a bad rule, a bad party and a taken code", async () => {
    expect(await fails(saveTemplate(null, { ...base, dueRule: { type: "after_period", monthsAfter: 1, day: 40 } }))).toMatchObject({ message: "template_rule_day" });
    expect(await fails(saveTemplate(null, { ...base, ownerRule: "role:wizard" }))).toMatchObject({ message: "template_owner_rule_invalid" });
    expect(await fails(saveTemplate(null, { ...base, ownerRule: "none" }))).toMatchObject({ message: "template_owner_rule_invalid" });
    expect(await fails(saveTemplate(null, { ...base, recurrence: "event", dueRule: { type: "after_event", days: 3 } }))).toMatchObject({ message: "template_event_type_invalid" });
    expect(await fails(saveTemplate(null, { ...base, links: [{ title: "x", url: "http://plain" }] }))).toMatchObject({ message: "template_link_invalid" });
    await saveTemplate(null, { ...base, code: "TAKEN", isActive: false });
    expect(await fails(saveTemplate(null, { ...base, code: "TAKEN" }))).toMatchObject({ message: "template_code_taken" });
  });

  it("an edit puts a reviewed template back to unreviewed unless the edit is the review", async () => {
    const { after: created } = await saveTemplate(null, { ...base, code: "REVIEWED", isActive: false });
    expect(created.reviewStatus).toBe("unreviewed");
    expect((await setReviewStatus(created.id, true, ids.finance)).after).toMatchObject({ reviewStatus: "reviewed", reviewedByPersonId: ids.finance });
    expect((await saveTemplate(created.id, { ...base, code: "REVIEWED", isActive: false, name: "Changed" })).after).toMatchObject({ reviewStatus: "unreviewed", reviewedByPersonId: null });
  });
});

describe("the scheduler", () => {
  it("creates one instance per period and active entity, shifted through the entity's own calendar, and nothing the second time", async () => {
    await saveTemplate(null, { ...base, code: "VAT", name: "VAT return", evidence: { file: true, reference: true, submittedDate: true, amount: false }, checklist: ["Prepare", "File"], reviewerRule: "permission:person:manage" });
    const first = await generateInstances(TODAY, { from: "2026-09-01", horizonDays: 45 });
    // August (due 20 Sep) and September (due 20 Oct) × two active entities.
    expect(first).toMatchObject({ created: 4, fromEvents: 0, unassigned: 0 });
    const rows = await instancesOf("VAT");
    expect(rows.map((row) => [row.instance.periodKey, row.instance.entityId === ids.szm ? "SZM" : "SZC", row.instance.nominalDueDate, row.task.dueDate].join(" ")).sort()).toEqual([
      // 20 September 2026 is a Sunday → Monday 21st; SZM is off that Monday too → Tuesday 22nd.
      "2026-08 SZC 2026-09-20 2026-09-21",
      "2026-08 SZM 2026-09-20 2026-09-22",
      "2026-09 SZC 2026-10-20 2026-10-20",
      "2026-09 SZM 2026-10-20 2026-10-20",
    ]);
    expect(rows.every((row) => row.task.kind === "obligation" && row.task.assigneePersonId === ids.finance && row.task.title.includes("VAT return — "))).toBe(true);
    // The reviewer is the entity's own HR before the group's, and never the owner of the instance.
    expect(rows.find((row) => row.instance.entityId === ids.szm)!.instance.reviewerPersonId).toBe(ids.hrSzm);
    expect(rows.find((row) => row.instance.entityId === ids.szc)!.instance.reviewerPersonId).toBe(ids.hrAdmin);
    // One notice for the whole batch.
    expect(await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.finance), eq(schema.notification.kind, "ops.assigned")))).toHaveLength(1);

    expect(await generateInstances(TODAY, { from: "2026-09-01", horizonDays: 45 })).toMatchObject({ created: 0 });
    expect(await instancesOf("VAT")).toHaveLength(4);
  });

  it("keeps to the entities a template names and never assigns through the owners' wildcard", async () => {
    await saveTemplate(null, { ...base, code: "SZC-ONLY", entityIds: [ids.szc], ownerRule: "permission:rbac:manage" });
    await generateInstances(TODAY, { horizonDays: 5 });
    const rows = await instancesOf("SZC-ONLY");
    expect(rows.map((row) => row.instance.entityId)).toEqual([ids.szc]);
    // Only the owner role holds rbac:manage, through "*": nobody is named, the instance waits unassigned.
    expect(rows[0].task.assigneePersonId).toBeNull();
  });

  it("pulls obligations from HR events once, about the person, and calls them off with the event", async () => {
    await saveTemplate(null, { ...base, code: "HIRE-INS", name: "Register insurance", recurrence: "event", eventType: "hire", dueRule: { type: "after_event", days: 30 }, ownerRule: "permission:person:manage", authority: "social_insurance" });
    await saveTemplate(null, { ...base, code: "LEAVE-RETURN", name: "Insurance increase", recurrence: "event", eventType: "long_leave_return", dueRule: { type: "after_event", days: 10 }, ownerRule: "permission:person:manage", authority: "social_insurance" });
    const [hire] = await db().insert(schema.lifecycleEvent).values({ personId: ids.newHire, employmentId: ids.employment, entityId: ids.szm, type: "hire", effectiveDate: "2026-09-14", status: "applied" }).returning();
    // A hire from years ago that was only just imported is history, not a duty.
    await db().insert(schema.lifecycleEvent).values({ personId: ids.newHire, employmentId: ids.employment, entityId: ids.szm, type: "hire", effectiveDate: "2021-03-01", status: "applied" });
    const [leave] = await db().insert(schema.lifecycleEvent).values({ personId: ids.newHire, employmentId: ids.employment, entityId: ids.szm, type: "long_leave", effectiveDate: "2026-09-01", status: "applied", details: { from: "2026-09-01", to: "2026-10-15" } }).returning();

    expect(await generateInstances(TODAY, { horizonDays: 45 })).toMatchObject({ fromEvents: 2 });
    const [registered] = await instancesOf("HIRE-INS");
    expect(registered.instance).toMatchObject({ periodKey: `event:${hire.id}`, sourceType: "lifecycle_event", sourceId: hire.id, nominalDueDate: "2026-10-14" });
    expect(registered.task).toMatchObject({ subjectPersonId: ids.newHire, assigneePersonId: ids.hrSzm, dueDate: "2026-10-14" });
    expect(registered.task.title).toContain("Thu Mai");
    // Back on 16 October → due 26 October.
    expect((await instancesOf("LEAVE-RETURN"))[0].instance.nominalDueDate).toBe("2026-10-26");
    expect(await generateInstances(TODAY, { horizonDays: 45 })).toMatchObject({ created: 0, fromEvents: 0 });

    await db().update(schema.lifecycleEvent).set({ status: "cancelled" }).where(eq(schema.lifecycleEvent.id, leave.id));
    expect(await generateInstances(TODAY, { horizonDays: 45 })).toMatchObject({ created: 0, cancelled: 1 });
    expect((await instancesOf("LEAVE-RETURN"))[0].task.status).toBe("cancelled");
    expect((await instancesOf("HIRE-INS"))[0].task.status).toBe("todo");
  });

  it("closes the timesheet-lock instance once attendance says the month is locked", async () => {
    await saveTemplate(null, { ...base, code: "INT-TIMESHEET-LOCK", name: "Lock timesheet", category: "internal", authority: "internal", dueRule: { type: "after_period", monthsAfter: 1, day: 2 }, ownerRule: "permission:attendance:manage", entityIds: [ids.szm] });
    await generateInstances(TODAY, { from: "2026-09-01", horizonDays: 20 });
    expect((await instancesOf("INT-TIMESHEET-LOCK")).map((row) => [row.instance.periodKey, row.task.status])).toEqual([["2026-08", "todo"], ["2026-09", "todo"]]);
    await db().insert(schema.timesheetPeriod).values({ entityId: ids.szm, month: "2026-08", status: "locked" });
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 1 });
    expect((await instancesOf("INT-TIMESHEET-LOCK")).map((row) => [row.instance.periodKey, row.task.status, row.instance.note])).toEqual([["2026-08", "done", "system:timesheet_locked"], ["2026-09", "todo", null]]);
  });

  // FR-OPS-10: the deferred half of the payroll calendar, closed by payroll's own lifecycle.
  it("closes the payroll calendar as the month's run is proposed, signed and paid", async () => {
    const payrollTemplate = (code: string, name: string, day: number, ownerRule: string) => saveTemplate(null, { ...base, code, name, category: "internal", authority: "internal", dueRule: { type: "after_period", monthsAfter: 1, day }, ownerRule, entityIds: [ids.szm] });
    await payrollTemplate("INT-PAYROLL-PROPOSE", "Trình bảng lương", 3, "permission:payroll:propose");
    await payrollTemplate("INT-PAYROLL-SIGN", "Ký duyệt bảng lương", 4, "permission:payroll:approve");
    await payrollTemplate("INT-SALARY-PAYMENT", "Chi lương", 5, "permission:payroll:pay");
    await generateInstances(TODAY, { from: "2026-09-01", horizonDays: 20 });

    const august = async (code: string) => (await instancesOf(code)).find((row) => row.instance.periodKey === "2026-08")!;
    expect((await august("INT-PAYROLL-PROPOSE")).task.status).toBe("todo");

    // Nothing closes while August's run is still being worked on.
    const [run] = await db().insert(schema.payrollRun).values({ entityId: ids.szm, month: "2026-08", kind: "regular", status: "calculated", headcount: 4 }).returning();
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 0 });

    // The HR lead proposes it: the first of the three ticks, the other two wait.
    await db().update(schema.payrollRun).set({ status: "proposed", proposedAt: new Date() }).where(eq(schema.payrollRun.id, run.id));
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 1 });
    expect((await august("INT-PAYROLL-PROPOSE")).instance.note).toBe("system:payroll_proposed");
    expect((await august("INT-PAYROLL-SIGN")).task.status).toBe("todo");

    // Paid: signing is behind it, so the run closes both of the remaining items at once.
    await db().update(schema.payrollRun).set({ status: "paid", approvedAt: new Date(), paidAt: new Date() }).where(eq(schema.payrollRun.id, run.id));
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 2 });
    expect([(await august("INT-PAYROLL-SIGN")).instance.note, (await august("INT-SALARY-PAYMENT")).instance.note]).toEqual(["system:payroll_approved", "system:payroll_paid"]);

    // Idempotent: a second sync closes nothing again, and September is untouched.
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 0 });
    expect((await instancesOf("INT-SALARY-PAYMENT")).find((row) => row.instance.periodKey === "2026-09")!.task.status).toBe("todo");
  });

  it("leaves the payroll calendar of an entity whose run was cancelled alone", async () => {
    await db().insert(schema.payrollRun).values({ entityId: ids.szc, month: "2026-08", kind: "regular", status: "cancelled", headcount: 0 });
    expect(await generateInstances(TODAY, { horizonDays: 20 })).toMatchObject({ autoCompleted: 0 });
  });
});

describe("working an instance", () => {
  const vat = async (entity: "szm" | "szc", period: string) => (await instancesOf("VAT")).find((row) => row.instance.entityId === ids[entity] && row.instance.periodKey === period)!;

  it("cannot be closed without the evidence and the steps the template asks for", async () => {
    const { task, instance } = await vat("szc", "2026-08");
    expect(await fails(completeInstance(task.id, ids.finance, TODAY))).toEqual({ message: "obligation_evidence_missing", details: { evidence: ["file", "reference", "submittedDate"], checklist: [0, 1] } });

    await saveProgress(task.id, { referenceNumber: "TK-2026-08-001", submittedDate: "2026-09-18", amountPaid: null, note: null, checklistState: { "0": true, "1": true, "7": true } });
    const progressed = (await loadInstance(task.id))!;
    expect(progressed.task.status).toBe("in_progress");
    expect(progressed.instance.checklistState).toEqual({ "0": true, "1": true });
    expect(await fails(completeInstance(task.id, ids.finance, TODAY))).toMatchObject({ details: { evidence: ["file"], checklist: [] } });

    await db().insert(schema.storedFile).values({ bucket: "files", objectPath: `ops/${instance.id}/receipt.pdf`, fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1200, ownerType: OBLIGATION_FILE_OWNER, ownerId: instance.id, entityId: ids.szc, tier: "public_internal", status: "ready", uploadedByPersonId: ids.finance });
    // Closed two days after the due date, but the receipt is dated in time: not late.
    expect(await completeInstance(task.id, ids.finance, "2026-09-23")).toMatchObject({ completedLate: false });
    const closed = (await loadInstance(task.id))!;
    expect(closed.task).toMatchObject({ status: "done", completedByPersonId: ids.finance });
    expect(await fails(completeInstance(task.id, ids.finance, TODAY))).toMatchObject({ message: "obligation_closed" });
    expect(await fails(saveProgress(task.id, { referenceNumber: "changed", submittedDate: null, amountPaid: null, note: null, checklistState: {} }))).toMatchObject({ message: "obligation_closed" });
  });

  it("is late when neither the receipt nor the day it was closed is in time; reopening takes it back to work", async () => {
    const { task, instance } = await vat("szm", "2026-08");
    await saveProgress(task.id, { referenceNumber: "TK-2", submittedDate: "2026-09-24", amountPaid: 1_250_000, note: null, checklistState: { "0": true, "1": true } }, "2026-09-24");
    await db().insert(schema.storedFile).values({ bucket: "files", objectPath: `ops/${instance.id}/receipt.pdf`, fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1200, ownerType: OBLIGATION_FILE_OWNER, ownerId: instance.id, entityId: ids.szm, tier: "public_internal", status: "ready", uploadedByPersonId: ids.finance });
    expect(await completeInstance(task.id, ids.finance, "2026-09-24")).toMatchObject({ completedLate: true });
    expect((await loadInstance(task.id))!.instance).toMatchObject({ completedLate: true, amountPaid: 1_250_000 });

    await reopenInstance(task.id, "Wrong receipt attached");
    expect((await loadInstance(task.id))!).toMatchObject({ task: { status: "in_progress", completedAt: null }, instance: { completedLate: null, reopenReason: "Wrong receipt attached" } });
    expect(await fails(reopenInstance(task.id, "again"))).toMatchObject({ message: "obligation_not_closed" });
  });

  it("reassigns to someone else, tells them, and keeps owner and reviewer apart; cancelling keeps the reason", async () => {
    const { task } = await vat("szm", "2026-09");
    expect(await fails(reassignInstance(task.id, { assigneePersonId: ids.hrSzm, reviewerPersonId: ids.hrSzm }, ids.finance))).toMatchObject({ message: "obligation_reviewer_is_owner" });
    await reassignInstance(task.id, { assigneePersonId: ids.hrSzm, reviewerPersonId: ids.finance }, ids.finance);
    expect((await loadInstance(task.id))!.parties).toMatchObject({ assigneePersonId: ids.hrSzm, reviewerPersonId: ids.finance });
    expect(await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.hrSzm), eq(schema.notification.kind, "ops.assigned")))).not.toHaveLength(0);
    await cancelInstance(task.id, "Entity files quarterly");
    expect((await loadInstance(task.id))!).toMatchObject({ task: { status: "cancelled" }, instance: { note: "Entity files quarterly" } });
  });

  it("the generic task actions leave obligations alone", () => {
    expect(movesThroughEngine({ kind: "obligation" })).toBe(false);
    expect(movesThroughEngine({ kind: "checklist" })).toBe(true);
  });
});

describe("who sees what", () => {
  const principal = (personId: string, grants: Principal["grants"]): Principal => ({ personId, workforceType: "employee", grants });

  it("the list matches the policy for each kind of viewer", async () => {
    const viewers: [string, Principal][] = [
      ["finance", principal(ids.finance, [{ role: "finance", scope: { type: "group" } }])],
      ["hrSzm", principal(ids.hrSzm, [{ role: "hr_staff", scope: { type: "entity", id: ids.szm } }])],
      ["ceo", principal(ids.ceo, [{ role: "c_level", scope: { type: "group" } }])],
      ["newHire", principal(ids.newHire, [])],
    ];
    const everything = await db().select({ instance: schema.obligationInstance, task: schema.task }).from(schema.obligationInstance).innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId));
    for (const [name, viewer] of viewers) {
      const listed = new Set((await listInstances({ principal: viewer, personId: viewer.personId! }, {}, TODAY)).map((row) => row.taskId));
      const allowed = everything.filter((row) => canViewInstance(viewer, { entityId: row.instance.entityId, assigneePersonId: row.task.assigneePersonId, reviewerPersonId: row.instance.reviewerPersonId })).map((row) => row.task.id);
      expect([name, [...listed].sort()]).toEqual([name, allowed.sort()]);
    }
    const hrSees = await listInstances({ principal: viewers[1][1], personId: ids.hrSzm }, {}, TODAY);
    // Entity HR: its own entity, plus the SZC instance it was never part of stays hidden.
    expect(hrSees.every((row) => row.entityId === ids.szm)).toBe(true);
    expect(await listInstances({ principal: viewers[3][1], personId: ids.newHire }, {}, TODAY)).toEqual([]);
  });

  it("a reader who owns a step works it; other readers only look", async () => {
    const ceo = principal(ids.ceo, [{ role: "c_level", scope: { type: "group" } }]);
    expect(canWorkInstance(ceo, { entityId: ids.szm, assigneePersonId: ids.ceo, reviewerPersonId: null })).toBe(true);
    expect(canWorkInstance(ceo, { entityId: ids.szm, assigneePersonId: ids.finance, reviewerPersonId: null })).toBe(false);
  });

  it("colours and filters the list", async () => {
    const finance = principal(ids.finance, [{ role: "finance", scope: { type: "group" } }]);
    const open = await listInstances({ principal: finance, personId: ids.finance }, { open: true }, "2026-10-25");
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((row) => row.status === "todo" || row.status === "in_progress")).toBe(true);
    expect(open.find((row) => row.templateCode === "VAT" && row.periodKey === "2026-09" && row.entityId === ids.szc)).toMatchObject({ colour: "overdue", unreviewed: true });
    const closed = await listInstances({ principal: finance, personId: ids.finance }, { open: false }, TODAY);
    expect(closed.map((row) => row.colour)).toContain("done");
  });
});
