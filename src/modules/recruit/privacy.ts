import "server-only";
// The talent pool, seen from both sides (FR-REC-04, 13; NFR-PRV-01, 03).
//
// **The candidate's side** is a page with no sign-in: the link in their letters opens
// `/careers/privacy/<token>`, which says whether they are being kept beyond their application and
// lets them stop it. Leaving the pool is the one thing it can do, and it is the safe direction —
// it can only ever shorten how long the company keeps somebody — so a forwarded link is not a
// hazard. Joining is not offered there: agreeing to be kept is asked on the application form, or
// by a recruiter who asked the person, never by whoever happens to hold a link.
//
// **The recruiter's side** is the candidate database filtered to the pool, and recording a
// candidate's answer when they gave it by telephone. Either way the clock in `jobs.ts` does the
// rest: somebody out of the pool is emptied once their window has passed.
//
// The page shows **nothing about the person**: not their name, not their address, not the jobs
// they applied for. Whoever holds the link already knows those things or has no business learning
// them.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { createPublicAction, type Visitor } from "@/lib/public-action";
import { publicOrigin } from "@/lib/site";
import { looksLikePrivacyToken, privacyToken, privacyTokenHash } from "./engine/privacy-token";
import { countPublicHit } from "./public";

type Executor = Tx | ReturnType<typeof db>;

const now = () => new Date();

/**
 * The link for one record, or null when it has no address to bind one to. Computed, not stored:
 * `rememberPrivacyLink` records its hash when a letter actually carries it.
 */
export function privacyLinkFor(candidate: { id: string; emailKey: string | null; anonymisedAt: Date | null }): { url: string; hash: string } | null {
  if (!candidate.emailKey || candidate.anonymisedAt) return null;
  const token = privacyToken(env().BETTER_AUTH_SECRET, { id: candidate.id, emailKey: candidate.emailKey });
  return { url: `${publicOrigin()}/careers/privacy/${token}`, hash: privacyTokenHash(token) };
}

/** Makes the link open: written in the transaction that queues the letter carrying it. */
export async function rememberPrivacyLink(executor: Executor, candidateId: string, hash: string): Promise<void> {
  await executor
    .update(schema.candidate)
    .set({ privacyTokenHash: hash })
    .where(and(eq(schema.candidate.id, candidateId), isNull(schema.candidate.anonymisedAt)));
}

/** The record a link opens. Nothing for a malformed token, a retired one, or an emptied record. */
async function candidateForToken(token: string, executor: Executor = db()) {
  if (!looksLikePrivacyToken(token)) return undefined;
  const [row] = await executor
    .select({ id: schema.candidate.id, talentPoolConsent: schema.candidate.talentPoolConsent })
    .from(schema.candidate)
    .where(and(eq(schema.candidate.privacyTokenHash, privacyTokenHash(token)), isNull(schema.candidate.anonymisedAt)))
    .limit(1);
  return row;
}

/** What the page may say. Deliberately one fact. */
export type PublicPrivacyView = { inTalentPool: boolean };

export async function findPublicPrivacyView(token: string): Promise<PublicPrivacyView | null> {
  const row = await candidateForToken(token);
  return row ? { inTalentPool: row.talentPoolConsent } : null;
}

/** Opening the page is counted like any public read: a script walking the token space pays per guess. */
export const countPrivacyView = (visitor: Visitor) => countPublicHit("privacy_view", visitor);

const leaveSchema = z.object({ token: z.string().trim().min(16).max(100) });
export type LeaveOutcome = { left: true };

const leavePipeline = createPublicAction({
  name: "careers.talent_pool.leave",
  input: leaveSchema,
  rateLimit: ({ visitor }) => countPublicHit("privacy", visitor),
  spamCheck: () => ({ verdict: "ok" }),
  dropped: (): LeaveOutcome => ({ left: true }),
  run: async ({ input }) => {
    const row = await candidateForToken(input.token);
    // Retired, emptied or never issued: one answer, the same as the page's 404.
    if (!row) throw new ActionError("privacy_link_closed");
    await db().update(schema.candidate).set({ talentPoolConsent: false, updatedAt: now() }).where(eq(schema.candidate.id, row.id));
    return {
      data: { left: true } as LeaveOutcome,
      // The record's id, never its name: the audit log outlives the record's anonymisation.
      audit: { resource: { type: "candidate", id: row.id, entityId: null }, summary: "left the talent pool through their privacy link", before: { talentPool: row.talentPoolConsent }, after: { talentPool: false } },
    };
  },
});

/** The candidate leaves the talent pool. */
export async function leaveTalentPool(input: { token: string }, visitor: Visitor) {
  return leavePipeline(input, visitor);
}

/**
 * A recruiter records the candidate's answer, given in person: keep me, or stop keeping me. Who
 * recorded it and when is the audit row the action writes; the notice the person first agreed to
 * (`consent_at`, `consent_version`) is left as it was — that is a different agreement.
 */
export async function setTalentPool(candidateId: string, inPool: boolean): Promise<{ before: boolean; after: boolean }> {
  const [before] = await db().select({ talentPoolConsent: schema.candidate.talentPoolConsent, anonymisedAt: schema.candidate.anonymisedAt }).from(schema.candidate).where(eq(schema.candidate.id, candidateId)).limit(1);
  if (!before) throw new ActionError("recruit_candidate_not_found");
  if (before.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");
  if (before.talentPoolConsent === inPool) throw new ActionError("recruit_status_unchanged");
  await db().update(schema.candidate).set({ talentPoolConsent: inPool, updatedAt: now() }).where(eq(schema.candidate.id, candidateId));
  return { before: before.talentPoolConsent, after: inPool };
}
