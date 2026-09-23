// Drafting help on the assistant's infrastructure (FR-PJM-64, on the FR-AI-06 guardrails): the
// EOD report's notes from the day's recorded activity, a project status update's summary from its
// status facts, and a hand-off note from a task's comment thread.
//
// THE RULES
//  1. **The source is read with the caller's own rights, first.** An EOD draft is only ever of the
//     caller's own day; a status draft needs the right to post the project's update
//     (`openProject` + `canPostStatus`); a hand-off draft needs the right to open the task
//     (`canViewTask`). Refused = null, and nothing was read for the model.
//  2. **No compensation reaches a model.** The sources are work records in hours and counts — no
//     compensation table is read — and every free text passes `redactCompensation` on its way out.
//  3. **Nothing is saved.** A draft is text handed back to the person's form; they edit it and
//     submit it through the owning module's own action, or throw it away.
//  4. **Local first.** With no model key the local driver's deterministic extractive draft is the
//     answer; with one, the model rewrites the same facts and any failure falls back to it.
import "server-only";
import { createTranslator } from "next-intl";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { getReportForm, REPORT_BACKFILL_DAYS } from "@/modules/daily/service";
import { loadStatusFacts, openProject } from "@/modules/projects/service";
import { canViewTask, findState, listComments, loadTask, loadViewer, notePrivateProjectRead } from "@/modules/work/service";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type DraftLine, eodDraftLines, handoffDraft, type HandoffNoteDraft, redactCompensation, statusDraftLines, suggestedHealth, threadText } from "./engine/drafts";
import { draftDriver } from "./model";

type Locale = "vi" | "en";
type DraftUser = Pick<CurrentUser, "person" | "principal">;
export type DraftResult<Draft> = { draft: Draft; driver: string; model: string; /** True when the local extractive draft is what came back. */ extractive: boolean };

const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en, namespace: "assistant.drafts.lines" });
const render = (lines: readonly DraftLine[], locale: Locale) => {
  const t = translator(locale);
  return lines.map((line) => t(line.key as never, line.params as never)).join("\n");
};

/** The model's text when there is a model and it answered; the extractive draft otherwise. */
async function viaDriver(extractive: string, request: { instruction: string; facts: string; locale: Locale }): Promise<DraftResult<string>> {
  const driver = draftDriver();
  const written = driver.isLocal ? null : await driver.draft({ ...request, facts: redactCompensation(request.facts) });
  return written ? { draft: written, driver: driver.name, model: driver.model, extractive: false } : { draft: extractive, driver: driver.isLocal ? driver.name : `${driver.name}:fallback`, model: driver.model, extractive: true };
}

// ── 1. EOD report notes ─────────────────────────────────────────────────────────────────────

/** Notes for the caller's own report of `date` (today or the days the report may be backfilled). */
export async function draftEodNotes(user: DraftUser, date: IsoDate, locale: Locale, today: IsoDate = todayInVietnam()): Promise<DraftResult<string> | null> {
  if (date > today || date < addDays(today, -REPORT_BACKFILL_DAYS)) return null;
  const form = await getReportForm(user.person.id, date);
  const facts = { done: form.draft.done, notDone: form.draft.notDone, activity: form.draft.activity, minutesLogged: form.draft.minutesLogged };
  const extractive = render(eodDraftLines(facts), locale);
  return viaDriver(extractive, {
    instruction: "Write the notes of this person's end-of-day report from their recorded activity: two to five short sentences in the first person, what they finished, what moved, what is still open.",
    facts: [extractive, ...facts.activity.map((item) => `- ${item.kind}: ${item.ref ? `${item.ref} ` : ""}${item.title}${item.detail ? ` (${item.detail})` : ""}`)].join("\n"),
    locale,
  });
}

// ── 2. Project status summary ───────────────────────────────────────────────────────────────

export type StatusDraft = { summary: string; health: "on_track" | "at_risk" | "off_track" };

/** A summary (and a suggested health) for the project's next status update — for whoever may post it. */
export async function draftStatusSummary(user: DraftUser, projectId: string, locale: Locale, today: IsoDate = todayInVietnam()): Promise<DraftResult<StatusDraft> | null> {
  const context = await openProject(user, projectId);
  if (!context || !context.can.postStatus) return null;
  // Hours and counts only: `loadStatusFacts` carries no fee, whoever asks.
  const facts = await loadStatusFacts(projectId, { budgetMinutes: context.plan.budgetMinutes, baseline: context.plan.baseline }, today);
  const extractive = render(statusDraftLines(facts), locale);
  const result = await viaDriver(extractive, {
    instruction: `Write the summary of this week's status update for the project "${redactCompensation(context.project.name)}": three to five sentences for the client-facing team, from these facts only.`,
    facts: extractive,
    locale,
  });
  return { ...result, draft: { summary: result.draft, health: suggestedHealth(facts) } };
}

// ── 3. Hand-off note from a task's thread ───────────────────────────────────────────────────

const NOTE_SCHEMA = {
  type: "object",
  properties: { context: { type: "string" }, state: { type: "string" }, done: { type: "string" }, next: { type: "string" }, questions: { type: "string" }, links: { type: "array", items: { type: "string" } }, contacts: { type: "string" } },
  required: ["context", "state", "done", "next", "questions", "links", "contacts"],
  additionalProperties: false,
} as const;

const NOTE_TEXT_PARTS = ["context", "state", "done", "next", "questions", "contacts"] as const;
const MAX_PART = 4000;

/** Whatever a model answered, kept only in the note's shape: known parts, strings, bounded. */
function asNote(json: string | null): HandoffNoteDraft | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const note: HandoffNoteDraft = {};
    for (const part of NOTE_TEXT_PARTS) if (typeof value[part] === "string" && value[part].trim()) note[part] = redactCompensation(value[part].trim()).slice(0, MAX_PART);
    if (Array.isArray(value.links)) note.links = value.links.filter((link): link is string => typeof link === "string" && /^https?:\/\//u.test(link)).slice(0, 10);
    return Object.keys(note).length ? note : null;
  } catch {
    return null;
  }
}

/** A hand-off note summarising the task's comment thread — for whoever may open the task. */
export async function draftHandoffNote(user: DraftUser, taskId: string, locale: Locale): Promise<DraftResult<HandoffNoteDraft> | null> {
  const [loaded, viewer] = await Promise.all([loadTask(taskId), loadViewer(user)]);
  if (!loaded || !canViewTask(viewer, loaded.facts)) return null;
  // The draft reads the task's thread as the task page does, so a private project's read leaves the same trail (Q25).
  if (loaded.facts.project) await notePrivateProjectRead(viewer, loaded.facts.project);
  const [comments, state] = await Promise.all([listComments(taskId), findState(loaded.work.stateId)]);
  const facts = { title: loaded.task.title, description: loaded.task.description, stateName: state?.name ?? null, comments: comments.filter((comment) => !comment.deleted).map((comment) => ({ author: comment.authorName, body: comment.body })) };
  const extractive = handoffDraft(facts);
  const driver = draftDriver();
  const written = driver.isLocal
    ? null
    : asNote(await driver.draft({ instruction: "Summarise this task's thread into a hand-off note for the next person: context, current state, what is done, next steps, open questions, links and client contacts. Leave a part empty when the thread does not say.", facts: threadText(facts), locale, schema: NOTE_SCHEMA }));
  // The links are the thread's own: a model may drop one, never add one.
  if (written) return { draft: { ...written, links: extractive.links }, driver: driver.name, model: driver.model, extractive: false };
  return { draft: extractive, driver: driver.isLocal ? driver.name : `${driver.name}:fallback`, model: driver.model, extractive: true };
}
