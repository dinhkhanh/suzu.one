import "server-only";
// Take-home assignments (FR-REC-07): send a brief, receive a submission, rate it.
//
// The awkward half is the middle one. The candidate is not a user of this system and never will
// be, so their submission arrives through the **public** surface — and everything week 2 built for
// the careers form applies here unchanged: `createPublicAction` (parse → rate limit → spam check →
// run → audit), the same fixed-window limiter, the same byte checks, the same rule that a refusal
// is a message key and never an id.
//
// Three decisions specific to this file:
//
//   · **The link is a token, and only its hash is stored.** `recruit_assignment.token_hash` is
//     SHA-256 of what went in the email; the token itself exists in the candidate's mailbox and
//     nowhere else, exactly as the approval deep links work (FR-PLT-24). Nobody — recruiter,
//     administrator, anybody with the database — can read a link back out of the system. Re-sending
//     mints a new one, which is what makes the old one stop working.
//   · **An expired, cancelled, rated or unknown link answers identically**: nothing. A brief that
//     has closed is not a different page from a brief that never existed.
//   · **The submitted file is `not_scanned`**, like every CV, and `policy.ts` keeps it to the
//     people running the opening.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { createPublicAction, type Visitor } from "@/lib/public-action";
import { reownFile, softDeleteFile, storeIncomingFile } from "@/modules/platform/files/service";
import { notify } from "@/modules/platform/notifications/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { ASSIGNMENT_CLOSED, ASSIGNMENT_GRACE_DAYS, ASSIGNMENT_LIMITS, SCORE_MAX, SCORE_MIN } from "./enums";
import { canRunAssignment, type OpeningTarget } from "./policy";
import { countPublicHit } from "./public";
import { findApplication, findCandidate, findOpening, isOpeningMember, recordApplicationEvent } from "./service";

type Executor = Tx | ReturnType<typeof db>;

export type AssignmentRow = typeof schema.recruitAssignment.$inferSelect;

const now = () => new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

/** A submission is a document or an archive, not a film. Well under the platform's 20 MB. */
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;

// ── The link ────────────────────────────────────────────────────────────────────────────────

/** 192 bits. It is the only thing standing between the internet and one candidate's brief. */
const newToken = (): string => randomBytes(24).toString("base64url");
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Looks a token up by its hash. Constant-time on the hash as well as unique-indexed on it: the
 * index lookup is the fast path, and the comparison below means a timing difference cannot be read
 * off a near-miss.
 */
async function assignmentForToken(token: string, executor: Executor = db()): Promise<AssignmentRow | undefined> {
  if (token.length < 16 || token.length > 200) return undefined;
  const hash = hashToken(token);
  const [row] = await executor.select().from(schema.recruitAssignment).where(eq(schema.recruitAssignment.tokenHash, hash)).limit(1);
  if (!row) return undefined;
  const left = Buffer.from(row.tokenHash);
  const right = Buffer.from(hash);
  return left.length === right.length && timingSafeEqual(left, right) ? row : undefined;
}

/** Is this brief still open to the candidate? Every "no" below is the same answer to them. */
const stillOpen = (assignment: AssignmentRow, at: Date): boolean =>
  !ASSIGNMENT_CLOSED.includes(assignment.status) && assignment.submittedAt === null && assignment.tokenExpiresAt > at;

// ── Sending one ─────────────────────────────────────────────────────────────────────────────

export type AssignmentInput = { applicationId: string; title: string; brief: string; dueAt: Date };

/**
 * Sends a brief and returns the **one and only** copy of its link. The caller puts it in the
 * candidate's email; nothing stores it, and asking for it again means issuing a new one.
 */
export async function sendAssignment(input: AssignmentInput, actorPersonId: string): Promise<{ assignment: AssignmentRow; token: string }> {
  if (input.dueAt.getTime() < now().getTime()) throw new ActionError("assignment_due_in_the_past");

  const token = newToken();
  const assignment = await db().transaction(async (tx) => {
    const application = await findApplication(input.applicationId, tx);
    if (!application) throw new ActionError("recruit_application_not_found");
    const opening = await findOpening(application.openingId, tx);
    if (!opening) throw new ActionError("recruit_opening_not_found");

    const [row] = await tx
      .insert(schema.recruitAssignment)
      .values({
        applicationId: application.id,
        openingId: opening.id,
        title: input.title,
        brief: input.brief,
        dueAt: input.dueAt,
        tokenHash: hashToken(token),
        // The link outlives the deadline by a few days: a candidate who is one hour late should
        // reach a page that takes their work, not a wall.
        tokenExpiresAt: new Date(input.dueAt.getTime() + ASSIGNMENT_GRACE_DAYS * DAY_MS),
        sentByPersonId: actorPersonId,
      })
      .returning();
    await recordApplicationEvent(tx, {
      applicationId: application.id,
      type: "assignment_sent",
      actorPersonId,
      note: input.title,
      detail: { dueAt: input.dueAt.toISOString() },
    });
    return row;
  });
  return { assignment, token };
}

export async function cancelAssignment(assignmentId: string, actorPersonId: string): Promise<AssignmentRow> {
  return db().transaction(async (tx) => {
    const before = await findAssignment(assignmentId, tx);
    if (!before) throw new ActionError("recruit_assignment_not_found");
    if (ASSIGNMENT_CLOSED.includes(before.status)) throw new ActionError("recruit_assignment_closed");
    const [after] = await tx.update(schema.recruitAssignment).set({ status: "cancelled", updatedAt: now() }).where(eq(schema.recruitAssignment.id, assignmentId)).returning();
    await recordApplicationEvent(tx, { applicationId: after.applicationId, type: "note", actorPersonId, note: `Huỷ bài: ${after.title}` });
    return after;
  });
}

export async function findAssignment(assignmentId: string, executor: Executor = db()): Promise<AssignmentRow | undefined> {
  const [row] = await executor.select().from(schema.recruitAssignment).where(eq(schema.recruitAssignment.id, assignmentId)).limit(1);
  return row;
}

/** Every brief sent on one application. The caller has already been checked. */
export async function listAssignments(applicationId: string, executor: Executor = db()): Promise<AssignmentRow[]> {
  return executor.select().from(schema.recruitAssignment).where(eq(schema.recruitAssignment.applicationId, applicationId)).orderBy(desc(schema.recruitAssignment.sentAt));
}

/** The whole opening's outstanding work, for the recruiter's own list. */
export async function listOpenAssignments(openingId: string): Promise<(AssignmentRow & { candidateName: string })[]> {
  const rows = await db()
    .select({ assignment: schema.recruitAssignment, candidateName: schema.candidate.fullName })
    .from(schema.recruitAssignment)
    .innerJoin(schema.jobApplication, eq(schema.jobApplication.id, schema.recruitAssignment.applicationId))
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.jobApplication.candidateId))
    .where(and(eq(schema.recruitAssignment.openingId, openingId), isNull(schema.recruitAssignment.ratedAt)))
    .orderBy(asc(schema.recruitAssignment.dueAt));
  return rows.map((row) => ({ ...row.assignment, candidateName: row.candidateName }));
}

// ── Rating one ──────────────────────────────────────────────────────────────────────────────

export async function rateAssignment(assignmentId: string, input: { rating: number; note: string | null }, actorPersonId: string): Promise<AssignmentRow> {
  return db().transaction(async (tx) => {
    const before = await findAssignment(assignmentId, tx);
    if (!before) throw new ActionError("recruit_assignment_not_found");
    if (before.status === "cancelled") throw new ActionError("recruit_assignment_closed");
    if (!before.submittedAt) throw new ActionError("recruit_assignment_not_submitted");
    const rating = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(input.rating)));
    const [after] = await tx
      .update(schema.recruitAssignment)
      .set({ status: "rated", rating, ratingNote: input.note, ratedByPersonId: actorPersonId, ratedAt: now(), updatedAt: now() })
      .where(eq(schema.recruitAssignment.id, assignmentId))
      .returning();
    // As with a scorecard: the history records that it was rated, not what the rating was.
    await recordApplicationEvent(tx, { applicationId: after.applicationId, type: "note", actorPersonId, note: after.title, detail: { assignmentRated: true } });
    return after;
  });
}

/** Whether this principal may send, cancel or rate on the assignment's opening. */
export async function mayRunAssignmentOn(viewer: { principal: Principal; personId: string | null }, applicationId: string): Promise<boolean> {
  const application = await findApplication(applicationId);
  if (!application) return false;
  const opening = await findOpening(application.openingId);
  if (!opening) return false;
  const target: OpeningTarget = { entityId: opening.entityId, departmentId: opening.departmentId, teamId: opening.teamId };
  return canRunAssignment(viewer.principal, target, await isOpeningMember(opening.id, viewer.personId));
}

// ── What the candidate sees ─────────────────────────────────────────────────────────────────

/**
 * The brief, as a stranger holding the link sees it. **No identifiers**: not the application, not
 * the opening, not the candidate. The job's title is on it because the candidate applied for it
 * and already knows it.
 */
export type PublicAssignment = { title: string; brief: string; dueAt: Date; jobTitle: string; companyName: string };

export async function findPublicAssignment(token: string): Promise<PublicAssignment | null> {
  const assignment = await assignmentForToken(token);
  if (!assignment || !stillOpen(assignment, now())) return null;
  const [row] = await db()
    .select({ jobTitle: schema.jobOpening.title, companyName: schema.entity.shortName })
    .from(schema.jobOpening)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .where(eq(schema.jobOpening.id, assignment.openingId))
    .limit(1);
  return { title: assignment.title, brief: assignment.brief, dueAt: assignment.dueAt, jobTitle: row?.jobTitle ?? "", companyName: row?.companyName ?? "" };
}

/** Counted like any other public read, so a script cannot walk the token space for free. */
export async function countAssignmentView(visitor: Visitor) {
  return countPublicHit("assignment_view", visitor);
}

// ── Receiving one ───────────────────────────────────────────────────────────────────────────

const trimmed = (max: number) => z.string().trim().max(max);

const submissionSchema = z.object({
  token: z.string().trim().min(16).max(200),
  /** The honeypot, exactly as on the application form. */
  website: z.string().max(200).default(""),
  note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), trimmed(ASSIGNMENT_LIMITS.note).nullable().default(null)),
  links: z.array(z.url().max(ASSIGNMENT_LIMITS.link)).max(ASSIGNMENT_LIMITS.links).default([]),
  file: z.object({ fileName: z.string().min(1).max(200), bytes: z.instanceof(Uint8Array) }).nullable().default(null),
});

export type SubmissionInput = z.input<typeof submissionSchema>;
export type SubmitOutcome = { received: true };

const submitPipeline = createPublicAction({
  name: "careers.assignment.submit",
  input: submissionSchema,
  rateLimit: ({ visitor }) => countPublicHit("assignment", visitor),
  spamCheck: (input) => (input.website.trim() === "" ? { verdict: "ok" } : { verdict: "drop", reason: "honeypot" }),
  dropped: (): SubmitOutcome => ({ received: true }),
  run: async ({ input }) => {
    const assignment = await assignmentForToken(input.token);
    // Unknown, expired, cancelled, already in — one answer, and it is the same one the page gives
    // for a token nobody ever issued.
    if (!assignment || !stillOpen(assignment, now())) throw new ActionError("assignment_link_closed");
    // Work with neither a file nor a link is not work.
    if (!input.file && input.links.length === 0) throw new ActionError("assignment_nothing_submitted");

    const opening = await findOpening(assignment.openingId);
    const stored = input.file
      ? await storeIncomingFile(
          { ownerType: "recruit_assignment", ownerId: assignment.id, entityId: opening?.entityId ?? null, tier: "personal" },
          input.file,
          { maxBytes: MAX_SUBMISSION_BYTES },
        )
      : null;

    try {
      const saved = await db().transaction(async (tx) => {
        // Re-read inside the transaction: two tabs, two submissions, one winner.
        const [locked] = await tx
          .update(schema.recruitAssignment)
          .set({
            status: "received",
            submissionFileId: stored?.id ?? null,
            submissionLinks: input.links,
            submissionNote: input.note,
            submittedAt: now(),
            updatedAt: now(),
          })
          .where(and(eq(schema.recruitAssignment.id, assignment.id), isNull(schema.recruitAssignment.submittedAt), sql`${schema.recruitAssignment.status} = 'sent'`))
          .returning();
        if (!locked) return null;
        await recordApplicationEvent(tx, {
          applicationId: locked.applicationId,
          type: "assignment_received",
          actorPersonId: null,
          note: locked.title,
          detail: { hasFile: !!stored, links: input.links.length },
        });
        return locked;
      });

      if (!saved) {
        if (stored) await softDeleteFile(stored.id);
        // Somebody got there first. The candidate is told the same thing either way.
        throw new ActionError("assignment_link_closed");
      }
      if (stored) await reownFile(stored.id, { ownerId: saved.id, entityId: opening?.entityId ?? null });
      await tellTheRecruiter(saved);

      return {
        data: { received: true } as SubmitOutcome,
        audit: {
          resource: { type: "recruit_assignment", id: saved.id, entityId: opening?.entityId ?? null },
          // Never the candidate's name: who sent work back is the recruiter's business, and the
          // audit log is read across the company.
          summary: `${saved.title} — submission through the take-home link`,
          after: { hasFile: !!stored, links: input.links.length },
        },
      };
    } catch (error) {
      if (stored) await softDeleteFile(stored.id);
      throw error;
    }
  },
});

/** The person who sent the brief hears that it came back. Nothing of the work itself travels. */
async function tellTheRecruiter(assignment: AssignmentRow): Promise<void> {
  const application = await findApplication(assignment.applicationId);
  const candidate = application ? await findCandidate(application.candidateId) : undefined;
  await notify({
    recipients: [assignment.sentByPersonId],
    kind: "recruit.assignment_received",
    params: { title: assignment.title, candidate: candidate?.fullName ?? "" },
    link: `/recruit/applications/${assignment.applicationId}`,
  });
}

/** The candidate's submission. The second public mutation in the product, and the last. */
export async function submitAssignment(input: SubmissionInput, visitor: Visitor) {
  return submitPipeline(input, visitor);
}
