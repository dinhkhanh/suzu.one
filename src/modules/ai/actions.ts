"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { recordAudit, recordAudits } from "@/modules/platform/audit/service";
import { ask, deleteConversation, resolveUnanswered } from "./conversations";
import { FEEDBACK_NOTE_MAX, FEEDBACK_VERDICTS, PAGE_KINDS, QUESTION_MAX } from "./enums";
import { giveFeedback } from "./feedback";
import { admitAiUse } from "./limits";
import { canAskAssistant, canReadUnansweredLog } from "./policy";

/**
 * Asking is a mutation: it writes the turn, and on a miss it writes the question into the backlog.
 * So it goes through the one pipeline like everything else and is audited (FR-AI-06).
 *
 * WHAT THE AUDIT KEEPS: the question, the outcome, the score, and the ids of the pages quoted —
 * enough to answer "why did it say that" and "did it ever quote something it should not have",
 * which is the point of auditing an assistant. Not the answer text: it is a copy of pages that are
 * already in the knowledge base, and the citation ids find it again. A question can be personal, so
 * the entry lands where personal things already live — the audit log, behind `audit:read`.
 *
 * THE CEILING comes first (`admitAiUse`): a person over their limit for the minute or the day is
 * refused before anything is retrieved, so the refused call reaches no driver and stores no turn.
 */
const askPipeline = createAction({
  name: "ai.ask",
  input: z.object({
    question: z.string().trim().min(2).max(QUESTION_MAX),
    conversationId: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.uuid().nullable().default(null)),
    locale: z.enum(["vi", "en"]).default("vi"),
    // The record on screen when asked from the sheet (FR-AGT-02): a kind and an id, nothing the
    // model reads as an instruction. The tool given the id checks it like any other.
    page: z.object({ kind: z.enum(PAGE_KINDS), id: z.uuid() }).nullable().default(null),
  }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    await admitAiUse(user, "ask");
    const { audit: toolCall, agentCalls, ...result } = await ask(user, input);
    // FR-AI-06: **every tool call is audited**, under its own action name, so an auditor can ask
    // "who had the assistant read a payslip this quarter" without reading every question. The
    // entry says which tool, about whom (always the asker), and how it ended — never a figure.
    if (toolCall) {
      await recordAudit({
        action: `ai.tool.${toolCall.tool}`,
        actor: { userId: user.userId, personId: user.person.id, email: user.email },
        request: user.request,
        resource: { type: "person", id: toolCall.subjectPersonId, entityId: user.person.primaryEntityId },
        summary: input.question.slice(0, 300),
        after: { outcome: toolCall.outcome, reason: toolCall.reason, subjectIsAsker: toolCall.subjectPersonId === user.person.id },
      });
    }
    // FR-AGT-50: the same for every tool the agent called — which tool, about what, how it ended.
    // The input is kept (a month, a filter, a search) and the result is not: never a figure.
    await recordAudits(
      agentCalls.map((call) => ({
        action: `ai.tool.${call.tool}`,
        actor: { userId: user.userId, personId: user.person.id, email: user.email },
        request: user.request,
        resource: call.subject ?? { type: "person", id: user.person.id, entityId: user.person.primaryEntityId },
        summary: input.question.slice(0, 300),
        after: { outcome: call.outcome, input: call.input, error: call.error, agent: true },
      })),
    );
    // R4: a proposal written for the asker to confirm is audited as itself too (FR-AGT-50); its
    // confirm and discard are audited by their own actions, and the change by the module's.
    await recordAudits(
      agentCalls
        .filter((call) => call.outcome === "proposed" && call.subject)
        .map((call) => ({
          action: "ai.proposal.create",
          actor: { userId: user.userId, personId: user.person.id, email: user.email },
          request: user.request,
          resource: call.subject!,
          summary: input.question.slice(0, 300),
          after: { tool: call.tool, input: call.input },
        })),
    );
    return {
      data: result,
      audit: {
        resource: { type: "ai_message", id: result.messageId },
        summary: input.question.slice(0, 300),
        after: { outcome: result.outcome, score: result.score, driver: result.driver, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, tool: toolCall?.tool ?? null, agentTools: agentCalls.map((call) => call.tool), citedPageIds: result.citations.map((citation) => citation.pageId), page: input.page },
      },
    };
  },
});

// A `"use server"` file may export nothing but async functions (tests/server-actions.test.ts).
export async function askAssistantAction(input: unknown) {
  return askPipeline(input);
}

const forgetPipeline = createAction({
  name: "ai.conversation.delete",
  input: z.object({ conversationId: z.uuid() }),
  // Your own or nothing: `deleteConversation` matches on the person as well as the id.
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    if (!(await deleteConversation(user.person.id, input.conversationId))) throw new ActionError("ai_conversation_not_found");
    revalidatePath("/assistant", "layout");
    return { data: { deleted: true }, audit: { resource: { type: "ai_conversation", id: input.conversationId }, summary: "conversation deleted" } };
  },
});

export async function deleteConversationAction(input: unknown) {
  return forgetPipeline(input);
}

const resolvePipeline = createAction({
  name: "ai.unanswered.resolve",
  input: z.object({ id: z.uuid(), note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(300).nullable().default(null)) }),
  authorize: (user) => canReadUnansweredLog(user.principal),
  run: async ({ user, input }) => {
    const closed = await resolveUnanswered(user.principal, input.id, user.person.id, input.note);
    if (closed === 0) throw new ActionError("ai_unanswered_not_found");
    revalidatePath("/assistant/unanswered");
    return { data: { closed }, audit: { resource: { type: "ai_unanswered_question", id: input.id }, summary: `${closed} closed`, after: { note: input.note } } };
  },
});

export async function resolveUnansweredAction(input: unknown) {
  return resolvePipeline(input);
}

const feedbackPipeline = createAction({
  name: "ai.feedback.give",
  input: z.object({
    messageId: z.uuid(),
    verdict: z.enum(FEEDBACK_VERDICTS),
    note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(FEEDBACK_NOTE_MAX).nullable().default(null)),
    // A checkbox: "on" when ticked, absent when not.
    shared: z.preprocess((value) => value === true || value === "on" || value === "true" || value === "1", z.boolean()),
  }),
  // On an answer of the asker's own: `giveFeedback` writes nothing for anybody else's message.
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const given = await giveFeedback(user.person.id, input);
    if (!given) throw new ActionError("ai_message_not_found");
    // The audit says what was said of which answer; the note is kept where the keepers read it.
    return { data: { verdict: input.verdict }, audit: { resource: { type: "ai_message", id: input.messageId }, summary: input.verdict, after: { verdict: input.verdict, shared: input.shared, note: input.note !== null } } };
  },
});

export async function giveFeedbackAction(input: unknown) {
  return feedbackPipeline(input);
}
