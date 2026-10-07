// Proposals (Phase 13 R4, D37, FR-AGT-20…23): what the agent may do instead of changing anything —
// write down a change for the asker to confirm.
//
// THE RULES
//  1. **Nothing here changes a record of another module.** A proposal is a row of this module: the
//     action's name, its input, the card. Confirming it calls the module's own server action as the
//     person (`proposal-actions.ts`), which authorises, notifies, invalidates and audits as it always
//     does; this file only takes the claim before and writes the outcome after.
//  2. **Your own, once, in time.** Only the person it was proposed to can confirm or discard it; the
//     claim is one UPDATE that matches the person, `pending` and the expiry together, so two clicks,
//     two tabs or a replayed request run the action at most once (FR-AGT-20). Thirty minutes, then
//     it has expired — nothing deletes it, the card just says so.
//  3. **Reads are the asker's own and live.** A card's state is read with the conversation, by id,
//     never cached: a proposal confirmed a second ago must not show its buttons again.
import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db, schema, type Tx } from "@/lib/db";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import type { ProposalField, ProposalShown, ProposalState } from "./enums";

const { aiProposal } = schema;

/** FR-AGT-20: a proposal waits thirty minutes for its person. */
export const PROPOSAL_TTL_MS = 30 * 60_000;

/** At most this many proposals in one turn: a request for twenty tasks is a screen's job, not a chat's. */
export const PROPOSALS_PER_TURN = 3;

export type NewProposal = {
  id?: string;
  personId: string;
  turnId: string;
  action: string;
  input: unknown;
  fields: ProposalField[];
  notify: string[];
  editHref: string | null;
};

export type ProposalRow = typeof aiProposal.$inferSelect;

/** The state the card shows: a pending proposal past its expiry has expired. Pure. */
export function proposalState(row: Pick<ProposalRow, "status" | "expiresAt">, now: Date = new Date()): ProposalState {
  if (row.status === "pending" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status;
}

type Outcome = { href?: string | null; error?: string | null; reason?: string | null };
const outcomeOf = (row: Pick<ProposalRow, "result">): Outcome => (row.result && typeof row.result === "object" ? (row.result as Outcome) : {});

export async function createProposal(proposal: NewProposal, now: Date = new Date()): Promise<{ id: string; expiresAt: Date }> {
  const [row] = await db()
    .insert(aiProposal)
    .values({ ...proposal, input: proposal.input as object, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS) })
    .returning({ id: aiProposal.id, expiresAt: aiProposal.expiresAt });
  return row;
}

/** Ties a turn's proposals to the message that shows them, inside `ask`'s transaction. */
export async function linkProposals(tx: Tx, input: { personId: string; turnId: string; conversationId: string; messageId: string }): Promise<void> {
  await tx
    .update(aiProposal)
    .set({ conversationId: input.conversationId, messageId: input.messageId })
    .where(and(eq(aiProposal.turnId, input.turnId), eq(aiProposal.personId, input.personId)));
}

/** The live state of the asker's proposals in one conversation, by id — one query. */
export async function proposalStatesIn(personId: string, conversationId: string, now: Date = new Date()): Promise<Map<string, Pick<ProposalShown, "state" | "resultHref" | "error" | "reason">>> {
  const rows = await db()
    .select({ id: aiProposal.id, status: aiProposal.status, expiresAt: aiProposal.expiresAt, result: aiProposal.result })
    .from(aiProposal)
    .where(and(eq(aiProposal.personId, personId), eq(aiProposal.conversationId, conversationId)));
  return new Map(rows.map((row) => [row.id, { state: proposalState(row, now), resultHref: outcomeOf(row).href ?? null, error: outcomeOf(row).error ?? null, reason: outcomeOf(row).reason ?? null }]));
}

/** Why a proposal cannot be confirmed or discarded now. */
export type ProposalGone = "ai_proposal_not_found" | "ai_proposal_expired" | "ai_proposal_decided";

/**
 * Takes the claim (rule 2): pending → confirming, for its own person, before it expires. Returns the
 * row to execute, or why not. Only one caller ever gets the row.
 */
export async function claimProposal(personId: string, id: string, now: Date = new Date()): Promise<ProposalRow | ProposalGone> {
  const [claimed] = await db()
    .update(aiProposal)
    .set({ status: "confirming", decidedAt: now })
    .where(and(eq(aiProposal.id, id), eq(aiProposal.personId, personId), eq(aiProposal.status, "pending"), gt(aiProposal.expiresAt, now)))
    .returning();
  if (claimed) return claimed;
  return whyNot(personId, id, now);
}

async function whyNot(personId: string, id: string, now: Date): Promise<ProposalGone> {
  const [row] = await db()
    .select({ status: aiProposal.status, expiresAt: aiProposal.expiresAt })
    .from(aiProposal)
    .where(and(eq(aiProposal.id, id), eq(aiProposal.personId, personId)))
    .limit(1);
  if (!row) return "ai_proposal_not_found";
  return proposalState(row, now) === "expired" ? "ai_proposal_expired" : "ai_proposal_decided";
}

/** Writes how the confirmed action ended. Only a proposal in `confirming` moves on. */
export async function finishProposal(id: string, status: "confirmed" | "failed", outcome: Outcome): Promise<void> {
  await db()
    .update(aiProposal)
    .set({ status, result: outcome })
    .where(and(eq(aiProposal.id, id), eq(aiProposal.status, "confirming")));
}

/** Bỏ: the asker's own pending proposal, discarded. Returns why not when it cannot be. */
export async function discardProposal(personId: string, id: string, now: Date = new Date()): Promise<ProposalRow | ProposalGone> {
  const [row] = await db()
    .update(aiProposal)
    .set({ status: "discarded", decidedAt: now })
    .where(and(eq(aiProposal.id, id), eq(aiProposal.personId, personId), eq(aiProposal.status, "pending")))
    .returning();
  if (row) return row;
  return whyNot(personId, id, now);
}

/**
 * Sửa (FR-AGT-22): the input of the asker's own proposal of one of `actions`, for a module's form to
 * start from — or null. A form reads it from `?proposal=<id>`; a confirmed proposal fills nothing,
 * since what it proposed already happened.
 */
export async function proposalDraft(personId: string, id: string | null | undefined, actions: readonly string[]): Promise<Record<string, unknown> | null> {
  if (!id || !/^[0-9a-f-]{36}$/u.test(id)) return null;
  const [row] = await db()
    .select({ input: aiProposal.input })
    .from(aiProposal)
    .where(and(eq(aiProposal.id, id), eq(aiProposal.personId, personId), inArray(aiProposal.action, [...actions]), sql`${aiProposal.status} in ('pending', 'failed')`))
    .limit(1);
  return row && row.input && typeof row.input === "object" ? (row.input as Record<string, unknown>) : null;
}

/**
 * Where the words for a module's refusal (its `ActionError` key) are, when a confirmed proposal
 * fails: the namespace the module's own form shows its errors from.
 */
const PROPOSAL_ERROR_NAMESPACES: Readonly<Record<string, string>> = {
  "work.task.create": "work.errors",
  "work.task.update": "work.errors",
  "work.comment.add": "work.discussion.errors",
  "work.blocker.raise": "work.errors",
  "work.blocker.resolve": "work.errors",
  "daily.time.log": "daily.errors",
  "daily.plan.add": "daily.errors",
  "daily.report.submit": "daily.errors",
  "leave.request.submit": "leave.errors",
  "attendance.request.submit": "attendance.requests.errors",
  "request.file": "requests.errors",
  "projects.status.post": "projects.errors",
};

/**
 * A module's refusal in its own words, in the asker's language (the module's error namespace, then
 * the card's own reasons, then the general line). Translated here because the chat's page is sent
 * the assistant's messages only, not every module's.
 */
export function proposalReason(locale: "vi" | "en", action: string, key: string): string {
  const t = createTranslator({ locale, messages: locale === "en" ? en : vi });
  const namespace = PROPOSAL_ERROR_NAMESPACES[action];
  for (const path of [namespace ? `${namespace}.${key}` : null, `assistant.agent.proposal.errors.${key}`]) if (path && t.has(path as never)) return t(path as never);
  return t("assistant.agent.proposal.errors.generic" as never);
}
