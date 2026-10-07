"use server";
// Xác nhận and Bỏ on a proposal card (Phase 13 R4, D37, FR-AGT-20).
//
// CONFIRM IS TWO ACTIONS, ON PURPOSE. `ai.proposal.confirm` is the asker's click: it takes the claim
// (their own proposal, pending, not expired — at most once) and then calls the module's own exported
// server action with the stored input, exactly as that module's form would. The inner action runs
// its whole pipeline itself — parse, the session, its own `authorize`, its approval flow, its
// notifications, its cache invalidation and its own audit row — so the log holds both: that the
// person confirmed an assistant's proposal, and the change itself, as it always records it
// (FR-AGT-50). A refusal of the inner action is not an error of this one: the proposal is marked
// failed with the module's reason, and the card says it and offers Sửa.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, ActionError, createAction } from "@/lib/action";
import { PROPOSABLE } from "./agent/proposable";
import type { ProposalState } from "./enums";
import { canAskAssistant } from "./policy";
import { claimProposal, discardProposal, finishProposal, proposalReason } from "./proposals";

type Decided = { id: string; state: ProposalState; resultHref: string | null; error: string | null; reason: string | null; fieldErrors?: Record<string, string[]> };

const confirmPipeline = createAction({
  name: "ai.proposal.confirm",
  input: z.object({ id: z.uuid(), locale: z.enum(["vi", "en"]).default("vi") }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const claimed = await claimProposal(user.person.id, input.id);
    if (typeof claimed === "string") throw new ActionError(claimed);
    const proposable = PROPOSABLE[claimed.action];
    let result: ActionResult<unknown>;
    try {
      result = proposable ? await proposable.execute(claimed.input) : { ok: false, error: "failed", message: "ai_proposal_unknown_action" };
    } catch (error) {
      // The module threw past its own pipeline: nothing is known to have changed, and the claim stays
      // spent — a proposal never runs twice.
      await finishProposal(claimed.id, "failed", { error: "generic", reason: proposalReason(input.locale, claimed.action, "generic") });
      throw error;
    }
    const resultHref = result.ok && proposable ? proposable.after(claimed.input as Record<string, unknown>, result.data) : null;
    const error = result.ok ? null : result.error === "failed" ? (result.message ?? "generic") : result.error;
    const reason = error ? proposalReason(input.locale, claimed.action, error) : null;
    await finishProposal(claimed.id, result.ok ? "confirmed" : "failed", { href: resultHref, error, reason });
    revalidatePath("/assistant", "layout");
    const data: Decided = { id: claimed.id, state: result.ok ? "confirmed" : "failed", resultHref, error, reason, ...(!result.ok && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) };
    return { data, audit: { resource: { type: "ai_proposal", id: claimed.id }, summary: claimed.action, after: { action: claimed.action, outcome: data.state, error } } };
  },
});

export async function confirmProposalAction(input: unknown) {
  return confirmPipeline(input);
}

const discardPipeline = createAction({
  name: "ai.proposal.discard",
  input: z.object({ id: z.uuid() }),
  authorize: (user) => canAskAssistant(user.principal),
  run: async ({ user, input }) => {
    const discarded = await discardProposal(user.person.id, input.id);
    if (typeof discarded === "string") throw new ActionError(discarded);
    revalidatePath("/assistant", "layout");
    const data: Decided = { id: discarded.id, state: "discarded", resultHref: null, error: null, reason: null };
    return { data, audit: { resource: { type: "ai_proposal", id: discarded.id }, summary: discarded.action, after: { action: discarded.action, outcome: "discarded" } } };
  },
});

export async function discardProposalAction(input: unknown) {
  return discardPipeline(input);
}
