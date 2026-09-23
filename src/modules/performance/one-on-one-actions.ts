"use server";
// 1:1 notes and review outcomes (FR-PRF-04, 06). Audit rows keep who, when and what kind — never
// the prose of a note, which is the private half of a conversation.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { OUTCOME_TYPES } from "./enums";
import { addOneOnOneAction, completeOneOnOneAction, createOneOnOne, findOneOnOne, findOneOnOneAction, shareOneOnOne, updateOneOnOne } from "./one-on-ones";
import { decideOutcome, findOutcome, raiseOutcome } from "./outcomes";
import { loadDirectory } from "./people";
import { canDecideOutcome, canHoldOneOnOneWith, canProposeSalaryOutcome, canRaiseOutcome, canReadOneOnOnePrivate, canWriteOneOnOne } from "./policy";
import { findResultById } from "./final-results";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(inner: Schema) => z.preprocess(blankToNull, inner.nullable().default(null));
const notes = (max: number) => optional(z.string().trim().max(max));
const wholeNumber = z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[.,\s_]/g, "")) : value), z.number().int());

const refresh = (meetingId?: string) => {
  revalidatePath("/performance/one-on-ones");
  if (meetingId) revalidatePath(`/performance/one-on-ones/${meetingId}`);
};

/** The meeting's parties, as the policy wants them. */
async function partiesOf(meetingId: string) {
  const meeting = await findOneOnOne(meetingId);
  if (!meeting) throw new ActionError("one_on_one_not_found");
  const directory = await loadDirectory();
  const person = directory.get(meeting.personId);
  if (!person) throw new ActionError("one_on_one_not_found");
  return { meeting, parties: { managerPersonId: meeting.managerPersonId, person } };
}

const createPipeline = createAction({
  name: "one_on_one.create",
  input: z.object({ personId: z.uuid(), meetingOn: z.iso.date(), agenda: notes(4000), sharedNotes: notes(8000), privateNotes: notes(8000) }),
  // Who the meeting is about decides who may open it — not who says they are the manager.
  authorize: async (user, input) => {
    const directory = await loadDirectory();
    const person = directory.get(input.personId);
    return !!person && canHoldOneOnOneWith(user.principal, person);
  },
  run: async ({ user, input }) => {
    const created = await createOneOnOne(input, user.person.id);
    refresh();
    return { data: { id: created.id }, audit: { resource: { type: "one_on_one", id: created.id, entityId: null }, summary: `1:1 ${created.meetingOn}`, after: { personId: created.personId, meetingOn: created.meetingOn } } };
  },
});
export async function createOneOnOneAction(input: unknown) {
  return createPipeline(input);
}

const updatePipeline = createAction({
  name: "one_on_one.update",
  input: z.object({ meetingId: z.uuid(), meetingOn: z.iso.date(), agenda: notes(4000), sharedNotes: notes(8000), privateNotes: notes(8000) }),
  authorize: async (user, input) => canWriteOneOnOne(user.principal, (await partiesOf(input.meetingId)).parties),
  run: async ({ user, input }) => {
    // The private column is written only by whoever may read it. HR writes the meeting without
    // ever being shown it, so what their form posts there is dropped, not stored over the notes.
    const seesPrivate = canReadOneOnOnePrivate(user.principal, (await partiesOf(input.meetingId)).parties);
    const { after } = await updateOneOnOne(input.meetingId, { meetingOn: input.meetingOn, agenda: input.agenda, sharedNotes: input.sharedNotes, ...(seesPrivate ? { privateNotes: input.privateNotes } : {}) });
    refresh(input.meetingId);
    // Lengths, not text: a 1:1 note is not something the audit log should hold.
    return { data: { id: after.id }, audit: { resource: { type: "one_on_one", id: after.id, entityId: null }, summary: `cập nhật 1:1 ${after.meetingOn}`, after: { agendaLength: after.agenda?.length ?? 0, sharedLength: after.sharedNotes?.length ?? 0, privateLength: after.privateNotes?.length ?? 0 } } };
  },
});
export async function updateOneOnOneAction(input: unknown) {
  return updatePipeline(input);
}

const sharePipeline = createAction({
  name: "one_on_one.share",
  input: z.object({ meetingId: z.uuid() }),
  authorize: async (user, input) => canWriteOneOnOne(user.principal, (await partiesOf(input.meetingId)).parties),
  run: async ({ input }) => {
    const { after } = await shareOneOnOne(input.meetingId);
    refresh(input.meetingId);
    return { data: { id: after.id }, audit: { resource: { type: "one_on_one", id: after.id, entityId: null }, summary: `chia sẻ 1:1 ${after.meetingOn}`, after: { status: after.status } } };
  },
});
export async function shareOneOnOneAction(input: unknown) {
  return sharePipeline(input);
}

const addActionPipeline = createAction({
  name: "one_on_one.add_action",
  input: z.object({ meetingId: z.uuid(), title: z.string().trim().min(1).max(200), assigneePersonId: optional(z.uuid()), dueOn: optional(z.iso.date()) }),
  authorize: async (user, input) => canWriteOneOnOne(user.principal, (await partiesOf(input.meetingId)).parties),
  run: async ({ user, input }) => {
    const created = await addOneOnOneAction(input, user.person.id);
    refresh(input.meetingId);
    revalidatePath("/tasks");
    return { data: { id: created.id, taskId: created.taskId }, audit: { resource: { type: "one_on_one_action", id: created.id, entityId: null }, summary: created.title, after: { taskId: created.taskId, assigneePersonId: created.assigneePersonId, dueOn: created.dueOn } } };
  },
});
export async function addOneOnOneActionAction(input: unknown) {
  return addActionPipeline(input);
}

const completeActionPipeline = createAction({
  name: "one_on_one.complete_action",
  input: z.object({ actionId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findOneOnOneAction(input.actionId);
    if (!found) return false;
    // Whoever it was given to may tick it off, as well as whoever may write the meeting.
    if (found.action.assigneePersonId === user.person.id) return true;
    const directory = await loadDirectory();
    const person = directory.get(found.meeting.personId);
    return !!person && canWriteOneOnOne(user.principal, { managerPersonId: found.meeting.managerPersonId, person });
  },
  run: async ({ user, input }) => {
    const row = await completeOneOnOneAction(input.actionId, user.person.id);
    refresh(row.meetingId);
    revalidatePath("/tasks");
    return { data: { id: row.id }, audit: { resource: { type: "one_on_one_action", id: row.id, entityId: null }, summary: row.title, after: { taskId: row.taskId, done: true } } };
  },
});
export async function completeOneOnOneActionAction(input: unknown) {
  return completeActionPipeline(input);
}

// ── Review outcomes (FR-PRF-06) ─────────────────────────────────────────────────────────────

const raisePipeline = createAction({
  name: "review_outcome.raise",
  input: z.object({
    resultId: z.uuid(),
    type: z.enum(OUTCOME_TYPES),
    note: notes(2000),
    baseSalary: optional(wholeNumber.pipe(z.number().int().min(0).max(100_000_000_000))),
    insuranceSalary: optional(wholeNumber.pipe(z.number().int().min(0).max(100_000_000_000))),
    validFrom: optional(z.iso.date()),
  }),
  authorize: async (user, input) => {
    const result = await findResultById(input.resultId);
    if (!result) return false;
    const directory = await loadDirectory();
    const person = directory.get(result.personId);
    if (!person || !canRaiseOutcome(user.principal, person)) return false;
    // A salary adjustment carries figures: only somebody who may read the person's compensation
    // types one. A line manager raises the other kinds.
    return input.type !== "salary_adjustment" || canProposeSalaryOutcome(user.principal, person);
  },
  run: async ({ user, input }) => {
    const salary = input.type === "salary_adjustment" ? { baseSalary: input.baseSalary ?? 0, insuranceSalary: input.insuranceSalary ?? input.baseSalary ?? 0, validFrom: input.validFrom ?? "" } : null;
    if (salary && (!salary.validFrom || salary.baseSalary <= 0)) throw new ActionError("salary_terms_required");
    const created = await raiseOutcome({ resultId: input.resultId, type: input.type, note: input.note, salary }, user.person.id);
    revalidatePath("/performance/results");
    revalidatePath("/tasks");
    // The type and the ids; the proposed salary itself lives in payroll's encrypted request.
    return { data: { id: created.id }, audit: { resource: { type: "review_outcome", id: created.id, entityId: created.entityId }, summary: `${created.type} (${created.year})`, after: { personId: created.personId, type: created.type, salaryRequestId: created.salaryRequestId, taskId: created.taskId } } };
  },
});
export async function raiseOutcomeAction(input: unknown) {
  return raisePipeline(input);
}

const decidePipeline = createAction({
  name: "review_outcome.decide",
  input: z.object({ outcomeId: z.uuid(), decision: z.enum(["accept", "reject"]) }),
  authorize: async (user, input) => {
    const outcome = await findOutcome(input.outcomeId);
    if (!outcome) return false;
    const directory = await loadDirectory();
    const person = directory.get(outcome.personId);
    return !!person && canDecideOutcome(user.principal, person);
  },
  run: async ({ user, input }) => {
    const { before, after } = await decideOutcome(input.outcomeId, input.decision, user.person.id);
    revalidatePath("/performance/results");
    return { data: { id: after.id, status: after.status }, audit: { resource: { type: "review_outcome", id: after.id, entityId: after.entityId }, summary: `${after.type}: ${after.status}`, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function decideOutcomeAction(input: unknown) {
  return decidePipeline(input);
}
