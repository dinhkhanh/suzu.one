// An approved confirmation-letter request makes its letter (REQ-02). The letter is the documents
// module's: this file only picks the template the request asked for and calls that module's own
// `generateDocument` **as the approver who finished the request** — so the documents module's rules
// decide, exactly as when HR generates one by hand: a salary letter needs the compensation tier
// over the requester, and an approver without it gets no letter (HR makes it from the person page).
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateDocument, listTemplates } from "@/modules/documents/service";
import type { Principal } from "@/modules/platform/rbac/policy";

/** The request type whose approval produces a letter. */
export const CONFIRMATION_LETTER_CODE = "confirmation_letter";

/** Which template each kind of letter is made from. An introduction letter has none: HR writes it. */
export const LETTER_TEMPLATES: Record<string, string> = { employment: "XN-CONG-TAC", salary: "XN-LUONG" };

export type IssuedLetter = { documentId: string; number: string } | { skipped: "no_template" | "already_issued" | "not_a_letter" };

/**
 * Makes the letter of an approved confirmation-letter request and remembers it on the request.
 * Throws whatever the documents module refuses with (the approver may not generate it); the caller
 * decides that the approval stands regardless.
 */
export async function issueConfirmationLetter(requestId: string, approver: { principal: Principal; personId: string }): Promise<IssuedLetter> {
  const [row] = await db()
    .select({ submission: schema.requestSubmission, requesterPersonId: schema.approvalRequest.requesterPersonId, entityId: schema.approvalRequest.entityId, status: schema.approvalRequest.status })
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .where(eq(schema.requestSubmission.approvalRequestId, requestId))
    .limit(1);
  if (!row || row.submission.typeCode !== CONFIRMATION_LETTER_CODE || row.status !== "approved") return { skipped: "not_a_letter" };
  if (row.submission.documentId) return { skipped: "already_issued" };

  const code = LETTER_TEMPLATES[String(row.submission.values.letter_kind ?? "")];
  // The entity's own template wins over the group's, as everywhere templates are chosen.
  const templates = code ? (await listTemplates()).filter((template) => template.code === code && template.isActive && (template.entityId === null || template.entityId === row.entityId)) : [];
  const template = templates.find((candidate) => candidate.entityId !== null) ?? templates[0];
  if (!template) return { skipped: "no_template" };

  const { document } = await generateDocument(approver, template.id, row.requesterPersonId);
  await db().update(schema.requestSubmission).set({ documentId: document.id, updatedAt: new Date() }).where(eq(schema.requestSubmission.id, row.submission.id));
  return { documentId: document.id, number: document.number };
}
