"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "@/modules/platform/rbac/policy";
import { RECORD_ONLY_EVENT_TYPES, TERMINATION_REASONS, WORKFORCE_TYPES } from "./enums";
import { cancelRecordedEvent, cancelTermination, recordEvent, rehirePerson, terminateEmployment } from "./lifecycle";
import { findLifecycleEvent } from "./lifecycle-events";
import { canHireInto } from "./policy";
import { decideResignation, getResignation, submitResignation } from "./resignation";
import { getPersonTarget } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const id = optional(z.uuid());
const day = z.iso.date();

// Every lifecycle change is HR's: authority over the person where they sit today.
const managesPerson = async (user: { principal: Parameters<typeof can>[0] }, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && can(user.principal, "person:manage", target);
};

function refresh(personId: string) {
  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  revalidatePath("/tasks");
  revalidatePath("/reports/headcount");
}

const recordPipeline = createAction({
  name: "lifecycle.record",
  input: z.object({ personId: z.uuid(), type: z.enum(RECORD_ONLY_EVENT_TYPES), effectiveDate: day, reason: text(300), note: text(2000) }),
  authorize: (user, input) => managesPerson(user, input.personId),
  run: async ({ user, input }) => {
    const { personId, ...event } = input;
    const row = await recordEvent(personId, event, user.person.id);
    refresh(personId);
    // Discipline notes are restricted tier: the audit log keeps that a note exists, not its text.
    const after = { ...row, note: row.type === "discipline" && row.note ? "[restricted]" : row.note };
    return { data: { id: row.id }, audit: { resource: { type: "person", id: personId, entityId: row.entityId }, summary: `${row.type} ${row.effectiveDate}`, after } };
  },
});

export async function recordLifecycleEventAction(input: unknown) {
  return recordPipeline(input);
}

const terminatePipeline = createAction({
  name: "person.terminate",
  input: z.object({ personId: z.uuid(), lastDay: day, reason: z.enum(TERMINATION_REASONS), note: text(2000), resignationEventId: id }),
  authorize: (user, input) => managesPerson(user, input.personId),
  run: async ({ user, input }) => {
    const { personId, ...termination } = input;
    const { employment, before, event, tasks, closed, offboardedNow } = await terminateEmployment(personId, termination, user.person.id);
    refresh(personId);
    return {
      data: { id: event.id, offboardedNow },
      audit: {
        resource: { type: "person", id: personId, entityId: employment.entityId },
        summary: `${employment.employeeCode} last day ${input.lastDay} (${input.reason})`,
        before: { endDate: before.endDate },
        after: { endDate: employment.endDate, eventId: event.id, offboardedNow, checklistTasks: tasks.length, assignmentsClosed: closed.assignments.length, roleGrantsEnded: closed.grants.length, contractsEnded: closed.contracts.length },
      },
    };
  },
});

export async function terminateEmploymentAction(input: unknown) {
  return terminatePipeline(input);
}

const cancelPipeline = createAction({
  name: "lifecycle.cancel",
  input: z.object({ eventId: z.uuid() }),
  authorize: async (user, input) => {
    const event = await findLifecycleEvent(input.eventId);
    // Hires, transfers and promotions mirror an assignment that would stay in force: not cancellable here.
    return !!event && (event.type === "termination" || (RECORD_ONLY_EVENT_TYPES as readonly string[]).includes(event.type) || event.type === "resignation") && managesPerson(user, event.personId);
  },
  run: async ({ input }) => {
    const event = (await findLifecycleEvent(input.eventId))!;
    const { before, after } = event.type === "termination" ? await cancelTermination(input.eventId) : await cancelRecordedEvent(input.eventId);
    refresh(after.personId);
    return { data: { id: after.id }, audit: { resource: { type: "person", id: after.personId, entityId: after.entityId }, summary: `cancel ${after.type} ${after.effectiveDate}`, before: { status: before.status }, after: { status: after.status } } };
  },
});

export async function cancelLifecycleEventAction(input: unknown) {
  return cancelPipeline(input);
}

const rehirePipeline = createAction({
  name: "person.rehire",
  input: z.object({
    personId: z.uuid(),
    entityId: z.uuid(),
    employeeCode: text(30),
    startDate: day,
    seniorityDate: optional(day),
    placement: z.object({ workforceType: z.enum(WORKFORCE_TYPES), branchId: id, departmentId: id, teamId: id, positionName: text(120), jobLevel: text(60), managerId: id, dottedManagerId: id, workLocation: text(200) }),
  }),
  // Authority over where the person is going, and over the record being reopened.
  authorize: async (user, input) => canHireInto(user.principal, { entityId: input.entityId, departmentId: input.placement.departmentId, teamId: input.placement.teamId }) && (await managesPerson(user, input.personId)),
  run: async ({ user, input }) => {
    const { personId, ...rehire } = input;
    const { person, employment, assignment, event } = await rehirePerson(personId, rehire, user.person.id);
    refresh(personId);
    return { data: { id: personId }, audit: { resource: { type: "person", id: personId, entityId: employment.entityId }, summary: `${employment.employeeCode} ${person.fullName} (rehire)`, after: { employment, assignment, eventId: event.id } } };
  },
});

export async function rehirePersonAction(input: unknown) {
  return rehirePipeline(input);
}

// ── Resignation requests ────────────────────────────────────────────────────────────────────

function refreshResignation(personId: string | null, requestId: string) {
  revalidatePath("/me");
  revalidatePath("/approvals");
  revalidatePath(`/approvals/resignation/${requestId}`);
  if (personId) revalidatePath(`/people/${personId}`);
}

// Self-service, like change requests: a resignation is always the signed-in person's own.
const resignPipeline = createAction({
  name: "resignation.submit",
  input: z.object({ lastWorkingDay: day, reason: text(1000) }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const { request } = await submitResignation(user.person.id, input);
    refreshResignation(user.person.id, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:resignation", id: request.id, entityId: request.entityId }, summary: request.summary, after: input } };
  },
});

export async function submitResignationAction(input: unknown) {
  return resignPipeline(input);
}

const decideResignationPipeline = createAction({
  name: "resignation.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  authorize: async (user, input) => !!(await getResignation({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome, eventId } = await decideResignation(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    refreshResignation(request.subjectPersonId, request.id);
    return { data: { outcome }, audit: { resource: { type: "person", id: request.subjectPersonId, entityId: request.entityId }, summary: `${input.decision}: resignation, ${request.summary}`, before: { status: before.status }, after: { status: request.status, requestId: request.id, eventId } } };
  },
});

export async function decideResignationAction(input: unknown) {
  return decideResignationPipeline(input);
}
