"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { POSITION_LEVELS, SENIORITY_LEVELS } from "@/lib/job-levels";
import { unitPathOf } from "@/modules/platform/org/service";
import { can, canReadTier } from "@/modules/platform/rbac/policy";
import { ActionError, createAction } from "@/lib/action";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { canGenerate, findTemplate, generateDocument } from "@/modules/documents/service";
import { CONTRACT_EVENT_TYPES, CONTRACT_TYPES, HAND_RECORDED_EVENT_TYPES, JOB_CATEGORIES, RECORD_ONLY_EVENT_TYPES, TERMINATION_REASONS, WORKFORCE_TYPES } from "./enums";
import { cancelRecordedEvent, cancelTermination, liftSuspension, recordContractEvent, recordEvent, rehirePerson, suspendPerson, terminateEmployment, transferToEntity } from "./lifecycle";
import { changeNeedsApproval, decideLifecycleChange, getLifecycleChange, proposeTermination } from "./lifecycle-approvals";
import { findLifecycleEvent } from "./lifecycle-events";
import { canHireInto, canReassign } from "./policy";
import { decideResignation, getResignation, submitResignation } from "./resignation";
import { getPersonTarget } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const id = optional(z.uuid());
const day = z.iso.date();
const placementInput = z.object({
  workforceType: z.enum(WORKFORCE_TYPES),
  branchId: id,
  orgUnitId: id,
  positionName: text(120),
  seniorityLevel: optional(z.enum(SENIORITY_LEVELS)),
  positionLevel: optional(z.enum(POSITION_LEVELS)),
  managerId: id,
  dottedManagerId: id,
  workLocation: text(200),
});

// Every lifecycle change is HR's: authority over the person where they sit today.
const managesPerson = async (user: { principal: Parameters<typeof can>[0] }, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && can(user.principal, "person:manage", target);
};

function refresh(personId: string) {
  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  revalidatePath("/today");
  revalidatePath("/reports/headcount");
}

const recordPipeline = createAction({
  name: "lifecycle.record",
  input: z.object({ personId: z.uuid(), type: z.enum(HAND_RECORDED_EVENT_TYPES), effectiveDate: day, reason: text(300), note: text(2000) }),
  // A salary change's reason and note are compensation tier: only someone who may read that tier of
  // this person writes one.
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    return !!target && can(user.principal, "person:manage", target) && (input.type !== "salary_change" || canReadTier(user.principal, target, "compensation"));
  },
  run: async ({ user, input }) => {
    const { personId, ...event } = input;
    const row = await recordEvent(personId, event, user.person.id);
    refresh(personId);
    // Discipline notes are restricted tier and a salary change's words compensation tier: the audit
    // log keeps that they exist, not their text.
    const after = {
      ...row,
      note: row.note && row.type === "discipline" ? "[restricted]" : row.note && row.type === "salary_change" ? "[compensation]" : row.note,
      reason: row.reason && row.type === "salary_change" ? "[compensation]" : row.reason,
    };
    return { data: { id: row.id }, audit: { resource: { type: "person", id: personId, entityId: row.entityId }, summary: `${row.type} ${row.effectiveDate}`, after } };
  },
});

export async function recordLifecycleEventAction(input: unknown) {
  return recordPipeline(input);
}

// A probation passed or a contract renewed (FR-CHR-09): the contract, the workforce type and the
// event in one transaction, then — when a template is chosen — the decision paper, numbered and
// kept as issued, tied to the event. Everything the paper needs is checked before anything is
// written, so a refused paper never leaves an event behind without it.
const contractEventPipeline = createAction({
  name: "lifecycle.contract_event",
  input: z.object({
    personId: z.uuid(),
    type: z.enum(CONTRACT_EVENT_TYPES),
    effectiveDate: day,
    reason: text(300),
    note: text(2000),
    workforceType: optional(z.enum(WORKFORCE_TYPES)),
    contractType: z.enum(CONTRACT_TYPES),
    contractNumber: z.string().trim().min(1).max(60),
    jobCategory: optional(z.enum(JOB_CATEGORIES)),
    signDate: optional(day),
    endDate: optional(day),
    salaryTerms: text(2000),
    templateId: id,
  }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    if (!target || !can(user.principal, "person:manage", target)) return false;
    // Pay is written only by those who may read it back; a paper only by those who may issue it.
    if (input.salaryTerms && !canReadTier(user.principal, target, "compensation")) return false;
    if (!input.templateId) return true;
    const template = await findTemplate(input.templateId);
    return !!template && template.isActive && canGenerate(user.principal, target, template.tier);
  },
  run: async ({ user, input }) => {
    const template = input.templateId ? await findTemplate(input.templateId) : null;
    if (template?.tier === "compensation" && !isStepUpFresh(user.reauthAt)) throw new ActionError("step_up_required");
    const { event, contract, ended, moved } = await recordContractEvent(
      input.personId,
      {
        type: input.type,
        effectiveDate: input.effectiveDate,
        reason: input.reason,
        note: input.note,
        workforceType: input.type === "probation_pass" ? (input.workforceType ?? "employee") : input.workforceType,
        contract: { number: input.contractNumber, type: input.contractType, jobCategory: input.jobCategory, signDate: input.signDate, startDate: input.effectiveDate, endDate: input.endDate, salaryTerms: input.salaryTerms, note: null },
      },
      user.person.id,
    );
    const paper = template ? (await generateDocument({ principal: user.principal, personId: user.person.id }, template.id, input.personId, { eventId: event.id })).document : null;
    refresh(input.personId);
    return {
      data: { id: event.id, contractId: contract.id, document: paper ? { id: paper.id, number: paper.number } : null },
      audit: {
        resource: { type: "person", id: input.personId, entityId: event.entityId },
        summary: `${event.type} ${event.effectiveDate}: contract ${contract.number}${paper ? `, ${paper.number}` : ""}`,
        after: { eventId: event.id, contractId: contract.id, contractsEnded: ended.length, workforceType: moved ? { from: moved.before.workforceType, to: moved.after.workforceType } : null, documentId: paper?.id ?? null },
      },
    };
  },
});

export async function recordContractEventAction(input: unknown) {
  return contractEventPipeline(input);
}

const terminatePipeline = createAction({
  name: "person.terminate",
  input: z.object({ personId: z.uuid(), lastDay: day, reason: z.enum(TERMINATION_REASONS), note: text(2000), resignationEventId: id }),
  authorize: (user, input) => managesPerson(user, input.personId),
  run: async ({ user, input }) => {
    const { personId, ...termination } = input;
    // Where an administrator asked for it, a termination waits for its approval (FR-CHR-09).
    const target = await getPersonTarget(personId);
    if (await changeNeedsApproval("termination", target?.entityId ?? null)) {
      const { request, outcome } = await proposeTermination(personId, termination, user.person.id);
      refresh(personId);
      revalidatePath("/approvals");
      return {
        data: { id: request.id, offboardedNow: false, pendingApproval: outcome !== "approved" },
        audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: `proposed: ${request.summary}`, after: { personId, ...termination, outcome } },
      };
    }
    const { employment, before, event, tasks, closed, offboardedNow } = await terminateEmployment(personId, termination, user.person.id);
    refresh(personId);
    return {
      data: { id: event.id, offboardedNow, pendingApproval: false },
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

// Suspension (FR-PLT-05): the same authority as a termination — HR over the person — and never over
// oneself. The reason is kept in the audit log, which is the record of who locked whom out and why.
const suspendPipeline = createAction({
  name: "person.suspend",
  input: z.object({ personId: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => input.personId !== user.person.id && managesPerson(user, input.personId),
  run: async ({ user, input }) => {
    const { person, sessionsRevoked } = await suspendPerson(input.personId, user.person.id);
    refresh(input.personId);
    return {
      data: { id: person.id, sessionsRevoked },
      audit: { resource: { type: "person", id: person.id, entityId: person.primaryEntityId }, summary: `suspended: ${input.reason}`, before: { status: "active" }, after: { status: person.status, reason: input.reason, sessionsRevoked } },
    };
  },
});

export async function suspendPersonAction(input: unknown) {
  return suspendPipeline(input);
}

const liftSuspensionPipeline = createAction({
  name: "person.unsuspend",
  input: z.object({ personId: z.uuid(), reason: text(1000) }),
  authorize: (user, input) => input.personId !== user.person.id && managesPerson(user, input.personId),
  run: async ({ input }) => {
    const { person } = await liftSuspension(input.personId);
    refresh(input.personId);
    return {
      data: { id: person.id },
      audit: {
        resource: { type: "person", id: person.id, entityId: person.primaryEntityId },
        summary: input.reason ? `suspension lifted: ${input.reason}` : "suspension lifted",
        before: { status: "suspended" },
        after: { status: person.status, reason: input.reason },
      },
    };
  },
});

export async function liftSuspensionAction(input: unknown) {
  return liftSuspensionPipeline(input);
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
    return {
      data: { id: after.id },
      audit: { resource: { type: "person", id: after.personId, entityId: after.entityId }, summary: `cancel ${after.type} ${after.effectiveDate}`, before: { status: before.status }, after: { status: after.status } },
    };
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
    placement: placementInput,
  }),
  // Authority over where the person is going, and over the record being reopened.
  authorize: async (user, input) => canHireInto(user.principal, { entityId: input.entityId, unitPath: await unitPathOf(input.placement.orgUnitId) }) && (await managesPerson(user, input.personId)),
  run: async ({ user, input }) => {
    const { personId, ...rehire } = input;
    const { person, employment, assignment, event } = await rehirePerson(personId, rehire, user.person.id);
    refresh(personId);
    return {
      data: { id: personId },
      audit: { resource: { type: "person", id: personId, entityId: employment.entityId }, summary: `${employment.employeeCode} ${person.fullName} (rehire)`, after: { employment, assignment, eventId: event.id } },
    };
  },
});

export async function rehirePersonAction(input: unknown) {
  return rehirePipeline(input);
}

const transferPipeline = createAction({
  name: "person.transfer_entity",
  input: z.object({ personId: z.uuid(), entityId: z.uuid(), employeeCode: text(30), startDate: day, reason: text(300), placement: placementInput }),
  // Authority over where the person is today and over where they are going, as for any reassignment.
  authorize: async (user, input) => {
    const from = await getPersonTarget(input.personId);
    return !!from && canReassign(user.principal, from, { entityId: input.entityId, unitPath: await unitPathOf(input.placement.orgUnitId) });
  },
  run: async ({ user, input }) => {
    const { personId, ...transfer } = input;
    const { previous, ended, employment, assignment, event, droppedAssignments, contractsEnded } = await transferToEntity(personId, transfer, user.person.id);
    refresh(personId);
    return {
      data: { id: personId },
      audit: {
        resource: { type: "person", id: personId, entityId: employment.entityId },
        summary: `${previous.employeeCode} → ${employment.employeeCode} from ${employment.startDate}`,
        before: { employment: previous },
        after: { endedEmployment: ended, employment, assignment, eventId: event.id, droppedAssignments, contractsEnded },
      },
    };
  },
});

export async function transferToEntityAction(input: unknown) {
  return transferPipeline(input);
}

// ── Approved transfers, promotions and terminations (FR-CHR-09) ─────────────────────────────

const decideLifecycleChangePipeline = createAction({
  name: "lifecycle.change.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  authorize: async (user, input) => !!(await getLifecycleChange({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome } = await decideLifecycleChange(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    if (request.subjectPersonId) refresh(request.subjectPersonId);
    revalidatePath("/approvals");
    revalidatePath(`/approvals/lifecycle/${request.id}`);
    return {
      data: { outcome },
      audit: {
        resource: { type: "person", id: request.subjectPersonId ?? request.id, entityId: request.entityId },
        summary: `${input.decision}: ${request.summary}`,
        before: { status: before.status },
        after: { status: request.status, requestId: request.id, type: request.type },
      },
    };
  },
});

export async function decideLifecycleChangeAction(input: unknown) {
  return decideLifecycleChangePipeline(input);
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
    return {
      data: { outcome },
      audit: {
        resource: { type: "person", id: request.subjectPersonId, entityId: request.entityId },
        summary: `${input.decision}: resignation, ${request.summary}`,
        before: { status: before.status },
        after: { status: request.status, requestId: request.id, eventId },
      },
    };
  },
});

export async function decideResignationAction(input: unknown) {
  return decideResignationPipeline(input);
}
