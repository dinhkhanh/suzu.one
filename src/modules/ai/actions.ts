"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { recordAudit, recordAudits } from "@/modules/platform/audit/service";
import { ask, deleteConversation, resolveUnanswered } from "./conversations";
import { QUESTION_MAX } from "./enums";
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
    return {
      data: result,
      audit: {
        resource: { type: "ai_message", id: result.messageId },
        summary: input.question.slice(0, 300),
        after: { outcome: result.outcome, score: result.score, driver: result.driver, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, tool: toolCall?.tool ?? null, agentTools: agentCalls.map((call) => call.tool), citedPageIds: result.citations.map((citation) => citation.pageId) },
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
