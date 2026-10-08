// What every `propose_*` tool ends with (Phase 13 R4, D37, FR-AGT-20): the module action's input,
// checked against that action's OWN schema, written down as a proposal for the asker — and nothing
// else. No record of another module changes here; the card's Xác nhận does that, through the
// module's own server action, as the person (`proposal-actions.ts`).
//
// What the model reads back is that the card is waiting, and the change in the model-safe words the
// tool chose (`summary`) — never an id the asker has not already seen, never a contact. What the
// asker reads is the card: every field, with its link, and who will be notified.
import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { toSearchKey } from "@/lib/text";
import { pickNamedRow } from "../engine/name-match";
import { modelText } from "../engine/views";
import type { ProposalField } from "../enums";
import { createProposal } from "../proposals";
import type { ToolContext, ToolResult, ToolSubject } from "./registry";

export type ProposalSpec = {
  /** The module action's audit name, e.g. "work.task.create" — a key of `PROPOSABLE`. */
  action: string;
  /** That action's own input schema (the module's `inputs.ts`). */
  schema: z.ZodType;
  /** The input the action will be called with, as a form would send it. */
  input: Record<string, unknown>;
  fields: ProposalField[];
  /** The people the action will notify, by name — the asker excluded. */
  notify: string[];
  /** Sửa: the module's normal form, filled in from `?proposal=<id>` (FR-AGT-22); `{id}` is replaced. */
  editHref: string | null;
  subject: ToolSubject | null;
  /** The change as the model may read it: values and names it already saw, free text redacted here. */
  summary: Record<string, string | number | boolean | null>;
};

/** A refusal the model can read and explain, with nothing stored. */
export const notProposed = (reason: string, extra: Record<string, unknown> = {}): ToolResult => ({ outcome: "refused", model: { proposed: false, reason, ...extra }, card: null, subject: null });

export async function propose(context: ToolContext, tool: string, spec: ProposalSpec): Promise<ToolResult> {
  // The action's own schema, now: a card that its Xác nhận would refuse is never shown.
  const parsed = spec.schema.safeParse(spec.input);
  if (!parsed.success) return { outcome: "failed", model: { proposed: false, error: "invalid_input", issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`) }, card: null, subject: null };
  const summary = Object.fromEntries(Object.entries(spec.summary).map(([key, value]) => [key, typeof value === "string" ? modelText(value) : value]));
  const line = Object.entries(summary)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("; ");
  // The id first: the edit link names it.
  const id = randomUUID();
  const editHref = spec.editHref ? spec.editHref.replace("{id}", id) : null;
  const { expiresAt } = await createProposal({ id, personId: context.user.person.id, turnId: context.turnId ?? randomUUID(), action: spec.action, input: spec.input, fields: spec.fields, notify: spec.notify, editHref });
  return {
    outcome: "proposed",
    model: { proposed: true, status: "awaiting_the_askers_confirmation", action: spec.action, change: summary, note: "Nothing has changed. The asker sees a card with every field and confirms or discards it." },
    card: { tool, href: null, items: [], more: 0, proposal: { id, action: spec.action, fields: spec.fields, notify: spec.notify, editHref, expiresAt: expiresAt.toISOString(), state: "pending", summary: `${spec.action} — ${line}` } },
    subject: { type: "ai_proposal", id },
  };
}

// ── Names → ids, among a list the module itself gave ─────────────────────────────────────────

const ME = new Set(["me", "myself", "toi", "minh", "em"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isUuid = (value: string): boolean => UUID.test(value.trim());

/** "me", "tôi", "mình" — the asker. */
export const meantAsker = (name: string): boolean => ME.has(toSearchKey(name).trim());

/**
 * One person named by the asker among the people the module would accept for this field (a team's
 * assignable list, a task's people): by id, by "me", or by whole words of the name. Several = the
 * model asks which; none = the module would refuse them, so no card is made.
 */
export function pickPerson<Row extends { id: string; fullName: string }>(candidates: readonly Row[], name: string, askerId: string): { one: Row } | { many: Row[] } | { none: true } {
  const wanted = name.trim();
  if (isUuid(wanted)) {
    const row = candidates.find((candidate) => candidate.id === wanted);
    return row ? { one: row } : { none: true };
  }
  if (meantAsker(wanted)) {
    const row = candidates.find((candidate) => candidate.id === askerId);
    return row ? { one: row } : { none: true };
  }
  const picked = pickNamedRow(candidates, wanted, (candidate) => [candidate.fullName]);
  return "one" in picked ? { one: picked.one } : "many" in picked ? { many: picked.many.slice(0, 8) } : picked;
}

/** At most six names on a card, then "+N". */
export function notifyNames(names: readonly string[]): string[] {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.length <= 6 ? unique : [...unique.slice(0, 6), `+${unique.length - 6}`];
}
