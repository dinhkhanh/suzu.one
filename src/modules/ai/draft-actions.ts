"use server";
// The drafting helpers as server actions (FR-PJM-64). They save nothing — the draft goes back to
// the person's form — but they read a person's work and may send it to a model, so each one goes
// through the one pipeline: parsed, authenticated, authorized and audited like a tool call
// (FR-AI-06). The audit keeps which draft, about what, and which driver wrote it — never the text.
//
// Authorization is the source's own rule, asked inside the use-case with the caller's rights before
// anything is read for a model: a draft of something the caller may not read answers
// `draft_not_available` — the same answer as for something that does not exist.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { draftEodNotes, draftHandoffNote, draftStatusSummary } from "./drafts";
import { canAskAssistant } from "./policy";

const locale = z.enum(["vi", "en"]).default("vi");

const eodPipeline = createAction({
  name: "ai.draft.eod_notes",
  input: z.object({ date: z.iso.date(), locale }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const result = await draftEodNotes(user, input.date, input.locale);
    if (!result) throw new ActionError("draft_not_available");
    return { data: { text: result.draft, extractive: result.extractive }, audit: { resource: { type: "daily_report", id: `${user.person.id}:${input.date}` }, summary: `EOD notes draft ${input.date}`, after: { driver: result.driver, model: result.model, extractive: result.extractive, length: result.draft.length } } };
  },
});

export async function draftEodNotesAction(input: unknown) {
  return eodPipeline(input);
}

const statusPipeline = createAction({
  name: "ai.draft.status_update",
  input: z.object({ projectId: z.uuid(), locale }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const result = await draftStatusSummary(user, input.projectId, input.locale);
    if (!result) throw new ActionError("draft_not_available");
    return { data: { text: result.draft.summary, health: result.draft.health, extractive: result.extractive }, audit: { resource: { type: "work_project", id: input.projectId }, summary: "status update draft", after: { driver: result.driver, model: result.model, extractive: result.extractive, health: result.draft.health } } };
  },
});

export async function draftStatusSummaryAction(input: unknown) {
  return statusPipeline(input);
}

const handoffPipeline = createAction({
  name: "ai.draft.handoff_note",
  input: z.object({ taskId: z.uuid(), locale }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const result = await draftHandoffNote(user, input.taskId, input.locale);
    if (!result) throw new ActionError("draft_not_available");
    return { data: { note: result.draft, extractive: result.extractive }, audit: { resource: { type: "task", id: input.taskId }, summary: "hand-off note draft", after: { driver: result.driver, model: result.model, extractive: result.extractive, parts: Object.keys(result.draft) } } };
  },
});

export async function draftHandoffNoteAction(input: unknown) {
  return handoffPipeline(input);
}
