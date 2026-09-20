import "server-only";
// The public careers page and its application form (FR-REC-03) — the only surface in this product
// that an unauthenticated stranger can reach, and the only file in the module written on the
// assumption that every byte arriving is hostile.
//
// What that assumption buys, in order of how much it matters:
//
//   · **No internal identifier ever crosses the boundary.** An opening is addressed by its opaque
//     `public_slug`; `PublicOpening` below has no uuid in it at all, so a page cannot print one by
//     accident. `findOpeningBySlug` returns published openings only, so a draft and a typo are the
//     same 404.
//   · **Nothing the visitor posts tells them anything about anybody else.** Applying twice, or
//     applying with an address already on file, produces the *same* answer as a first application:
//     a thank-you. A form that says "you have already applied" is a membership oracle for every
//     address somebody cares to try.
//   · **The pipeline is `createPublicAction`**, so parse → rate limit → spam check → run → audit
//     cannot be skipped, and no refusal reaches the caller as anything but a message key.
//   · **The CV is never trusted.** The bytes are checked against the allow-list and the file's own
//     magic bytes in memory before anything is stored, the stored row is `not_scanned` (there is
//     no scanner in this system), and `policy.ts` keeps it to the people hiring for that opening.
import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { createPublicAction, type RateLimitOutcome, type Visitor } from "@/lib/public-action";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { reownFile, softDeleteFile, storeIncomingFile } from "@/modules/platform/files/service";
import { CONSENT_VERSION, OPENING_PUBLIC_STATUSES, type OpeningQuestion, PUBLIC_LIMITS } from "./enums";
import { signFormToken, verifyFormToken } from "./engine/form-token";
import { CAREERS_LIMITS, type CareersBucket, retryAfterSeconds, windowStartFor, withinLimit } from "./engine/rate-limit";
import { createApplication, createCandidate, findLikelyCandidateDuplicates, findOpeningBySlug } from "./service";

type Executor = Tx | ReturnType<typeof db>;

const now = () => new Date();

/** A CV is a document, not a video. Well under the platform's 20 MB, and stated to the applicant. */
export const MAX_CV_BYTES = 5 * 1024 * 1024;

// ── Rate limiting ───────────────────────────────────────────────────────────────────────────

/**
 * Counts one request and says whether it is allowed. One statement: the unique key on
 * (bucket, visitor, window) turns the whole thing into an upsert that cannot race, and the
 * returned `hits` already includes this call.
 */
export async function countPublicHit(bucket: CareersBucket, visitor: Visitor, at: Date = now()): Promise<RateLimitOutcome> {
  const limit = CAREERS_LIMITS[bucket];
  const windowStart = windowStartFor(at, limit.windowSeconds);
  const [row] = await db()
    .insert(schema.recruitPublicHit)
    .values({ bucket, visitorHash: visitor.ipHash, windowStart, hits: 1, lastAt: at })
    .onConflictDoUpdate({
      target: [schema.recruitPublicHit.bucket, schema.recruitPublicHit.visitorHash, schema.recruitPublicHit.windowStart],
      set: { hits: sql`${schema.recruitPublicHit.hits} + 1`, lastAt: at },
    })
    .returning({ hits: schema.recruitPublicHit.hits });
  return withinLimit(row?.hits ?? 1, limit) ? { ok: true } : { ok: false, retryAfterSeconds: retryAfterSeconds(at, limit.windowSeconds) };
}

/**
 * Counted windows nobody can still be inside. Swept by the retention job (week 4).
 *
 * `lt`, not a `sql` fragment: drizzle binds a `Date` correctly when it knows the column, but a raw
 * fragment gives postgres.js nothing to infer the type from and it **throws** — while PGlite
 * shrugs and the tests stay green. The same trap Phase 6 hit with `tstzrange`; here it took
 * running the job against a real Postgres to see it.
 */
export async function purgePublicHits(before: Date): Promise<number> {
  const rows = await db().delete(schema.recruitPublicHit).where(lt(schema.recruitPublicHit.windowStart, before)).returning({ id: schema.recruitPublicHit.id });
  return rows.length;
}

// ── The form token ──────────────────────────────────────────────────────────────────────────

/** Minted when the form is rendered; see `engine/form-token.ts` for what it is and is not. */
export const issueFormToken = (slug: string, at: Date = now()): string => signFormToken(env().BETTER_AUTH_SECRET, { slug, issuedAt: at });

// ── What the public may see of an opening ───────────────────────────────────────────────────

/**
 * An advertisement. **No identifiers**: the slug is the only handle, and everything else is text
 * somebody wrote to be read by strangers. The salary band appears only when a person decided it
 * should (`salary_public`), never because the field happened to be filled in.
 */
export type PublicOpening = {
  slug: string;
  title: string;
  titleEn: string | null;
  entityName: string;
  departmentName: string | null;
  employmentType: string;
  workMode: string;
  workLocation: string | null;
  description: string;
  requirements: string;
  benefits: string;
  salary: { minVnd: number | null; maxVnd: number | null } | null;
  questions: OpeningQuestion[];
  publishedAt: Date | null;
};

type OpeningRow = typeof schema.jobOpening.$inferSelect;

const publicViewOf = (opening: OpeningRow, entityName: string, departmentName: string | null): PublicOpening => ({
  slug: opening.publicSlug,
  title: opening.title,
  titleEn: opening.titleEn,
  entityName,
  departmentName,
  employmentType: opening.employmentType,
  workMode: opening.workMode,
  workLocation: opening.workLocation,
  description: opening.description,
  requirements: opening.requirements,
  benefits: opening.benefits,
  salary: opening.salaryPublic ? { minVnd: opening.salaryMinVnd, maxVnd: opening.salaryMaxVnd } : null,
  questions: opening.questions,
  publishedAt: opening.publishedAt,
});

/** Every job on offer. Filtered in the database by the same rule `findOpeningBySlug` applies. */
export async function listPublicOpenings(): Promise<PublicOpening[]> {
  const rows = await db()
    .select({ opening: schema.jobOpening, entityName: schema.entity.shortName, departmentName: schema.department.name })
    .from(schema.jobOpening)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .leftJoin(schema.department, eq(schema.department.id, schema.jobOpening.departmentId))
    .where(and(inArray(schema.jobOpening.status, [...OPENING_PUBLIC_STATUSES]), isNotNull(schema.jobOpening.publishedAt)))
    .orderBy(asc(schema.jobOpening.title));
  return rows.map((row) => publicViewOf(row.opening, row.entityName, row.departmentName));
}

/** One advertisement, or nothing at all — a draft, a closed job and a made-up slug are one answer. */
export async function findPublicOpening(slug: string): Promise<PublicOpening | null> {
  const opening = await findOpeningBySlug(slug);
  if (!opening) return null;
  const [entity] = await db().select({ name: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, opening.entityId)).limit(1);
  const [department] = opening.departmentId ? await db().select({ name: schema.department.name }).from(schema.department).where(eq(schema.department.id, opening.departmentId)).limit(1) : [];
  return publicViewOf(opening, entity?.name ?? "", department?.name ?? null);
}

// ── Applying ────────────────────────────────────────────────────────────────────────────────

const trimmed = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), trimmed(max).nullable().default(null));

/**
 * The second gate, after the route handler has turned a multipart body into values. Every string
 * is capped, every list is capped, and anything the form did not ask for is dropped rather than
 * carried: `z.object` strips unknown keys, which is what stops a hand-posted `status: "hired"`
 * from ever being a question anyone has to think about.
 */
const applicationSchema = z.object({
  slug: z.string().trim().min(8).max(64),
  /** The honeypot. A field no person can see and no person fills in. */
  website: z.string().max(200).default(""),
  formToken: z.string().max(200).default(""),
  fullName: z.string().trim().min(2).max(PUBLIC_LIMITS.fullName),
  email: z.email().max(PUBLIC_LIMITS.email),
  phone: optional(PUBLIC_LIMITS.phone),
  location: optional(PUBLIC_LIMITS.location),
  currentTitle: optional(PUBLIC_LIMITS.currentTitle),
  currentEmployer: optional(PUBLIC_LIMITS.currentEmployer),
  links: z.array(z.url().max(PUBLIC_LIMITS.link)).max(PUBLIC_LIMITS.links).default([]),
  coverLetter: optional(PUBLIC_LIMITS.coverLetter),
  answers: z.record(z.string().max(64), z.string().max(PUBLIC_LIMITS.answer)).default({}),
  salaryExpectationVnd: z.preprocess(
    (value) => (typeof value === "string" ? (value.replace(/[.,\s]/g, "") === "" ? null : value.replace(/[.,\s]/g, "")) : value),
    z.coerce.number().int().min(0).max(10_000_000_000).nullable().default(null),
  ),
  // Refused, not dropped: consent is the lawful basis for holding any of this at all (PDPL), so
  // an application without it fails validation rather than being quietly stored unconsented.
  consent: z.preprocess((value) => value === true || value === "true" || value === "on", z.literal(true)),
  talentPool: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean().default(false)),
  cv: z.object({ fileName: z.string().min(1).max(200), bytes: z.instanceof(Uint8Array) }).nullable().default(null),
});

export type PublicApplicationInput = z.input<typeof applicationSchema>;
type PublicApplication = z.output<typeof applicationSchema>;

/** Required questions must be answered; an answer to a question that was not asked is dropped. */
export function answersFor(questions: readonly OpeningQuestion[], given: Record<string, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const value = (given[question.key] ?? "").trim().slice(0, PUBLIC_LIMITS.answer);
    if (value === "") {
      if (question.required) throw new ActionError("careers_answer_required");
      continue;
    }
    // A choice question accepts one of its choices and nothing else.
    if (question.kind === "choice" && !question.choices.includes(value)) throw new ActionError("careers_answer_invalid");
    answers[question.key] = value;
  }
  return answers;
}

/**
 * The candidate this application belongs to. An address or a number already on file **is** the
 * same person: their new application joins the record they already have, which is the entire point
 * of duplicate detection and is also why the public form cannot be used to discover whether an
 * address is known — both paths end in the same thank-you.
 *
 * A bare *name* match is not a match here. Inside the company a recruiter is shown the possible
 * duplicates and decides; out here there is nobody to decide, and merging two strangers who happen
 * to share a common Vietnamese name would be far worse than keeping two records.
 */
async function candidateFor(input: PublicApplication, tx: Executor): Promise<string> {
  const duplicates = await findLikelyCandidateDuplicates({ fullName: input.fullName, email: input.email, phone: input.phone }, undefined, tx);
  const certain = duplicates.find((match) => match.certain);
  if (certain) {
    // Consent is re-recorded: they have just agreed to the current notice, and a talent-pool tick
    // this time is a new permission — never a withdrawn one, which only they may do.
    await tx
      .update(schema.candidate)
      .set({ consentAt: now(), consentVersion: CONSENT_VERSION, ...(input.talentPool ? { talentPoolConsent: true } : {}), updatedAt: now() })
      .where(eq(schema.candidate.id, certain.id));
    return certain.id;
  }
  const created = await createCandidate(
    {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      currentTitle: input.currentTitle,
      currentEmployer: input.currentEmployer,
      location: input.location,
      links: input.links,
      source: "careers_page",
      sourceDetail: null,
      referredByPersonId: null,
      tags: [],
      notes: null,
    },
    null,
    // A name-only warning has nobody to answer it out here; see the note above.
    { confirmedNotDuplicate: true, consent: { at: now(), version: CONSENT_VERSION, talentPool: input.talentPool } },
    tx,
  );
  return created.id;
}

/**
 * What the applicant is told. Always the same, whatever happened: received. It is not a lie — a
 * dropped submission, a repeat application and a fresh one all leave the applicant with nothing
 * further to do — and it is the only answer that tells a prober nothing.
 */
export type ApplyOutcome = { received: true };

const applyPipeline = createPublicAction({
  name: "careers.apply",
  input: applicationSchema,
  rateLimit: ({ visitor }) => countPublicHit("apply", visitor),
  spamCheck: (input) => {
    // Nobody can see this field, so anything in it is a machine filling in every input it finds.
    if (input.website.trim() !== "") return { verdict: "drop", reason: "honeypot" };
    const verdict = verifyFormToken(env().BETTER_AUTH_SECRET, input.formToken, { slug: input.slug, now: now() });
    if (verdict === "ok") return { verdict: "ok" };
    // Too fast is a machine and is dropped silently; a stale or forged token is an honest error a
    // person can act on ("reload the page and try again"), so it is refused out loud.
    if (verdict === "token_too_fast") return { verdict: "drop", reason: "too_fast" };
    return { verdict: "refuse", reason: verdict === "token_expired" ? "careers_form_expired" : "careers_form_invalid" };
  },
  dropped: (): ApplyOutcome => ({ received: true }),
  run: async ({ input }) => {
    const opening = await findOpeningBySlug(input.slug);
    // The job closed between the page loading and the form being sent. Not a 404: the applicant
    // did nothing wrong and deserves to be told the job is gone.
    if (!opening) throw new ActionError("careers_opening_closed");
    const answers = answersFor(opening.questions, input.answers);

    // The bytes are checked and stored before the transaction, because storage is a network call
    // and a transaction is not the place to make one. `ownerId` is corrected the moment the
    // application exists; if anything below fails the file is soft-deleted rather than orphaned.
    const stored = input.cv
      ? await storeIncomingFile({ ownerType: "job_application", ownerId: `pending:${opening.id}`, entityId: opening.entityId, tier: "personal" }, input.cv, { maxBytes: MAX_CV_BYTES })
      : null;

    try {
      const application = await db().transaction(async (tx) => {
        const candidateId = await candidateFor(input, tx);
        const [existing] = await tx
          .select({ id: schema.jobApplication.id })
          .from(schema.jobApplication)
          .where(and(eq(schema.jobApplication.candidateId, candidateId), eq(schema.jobApplication.openingId, opening.id)))
          .limit(1);
        // Already in this pipeline. Nothing is written, and the answer is the same thank-you: see
        // the note at the top of this file about membership oracles.
        if (existing) return null;
        return createApplication(
          {
            candidateId,
            openingId: opening.id,
            source: "careers_page",
            sourceDetail: null,
            coverLetter: input.coverLetter,
            answers,
            cvFileId: stored?.id ?? null,
            portfolioLinks: input.links,
            salaryExpectationVnd: input.salaryExpectationVnd,
            salaryExpectationNote: null,
          },
          null,
          tx,
        );
      });

      if (!application) {
        if (stored) await softDeleteFile(stored.id);
        return {
          data: { received: true } as ApplyOutcome,
          audit: { resource: { type: "job_opening", id: opening.id, entityId: opening.entityId }, summary: `${opening.code} — repeat application, nothing written` },
        };
      }
      if (stored) await reownFile(stored.id, { ownerId: application.id, entityId: opening.entityId });
      return {
        data: { received: true } as ApplyOutcome,
        audit: {
          resource: { type: "job_application", id: application.id, entityId: opening.entityId },
          // Never the applicant's name or address: the audit log is read across the company, and
          // who applied for a job is the applicant's business until a recruiter opens the record.
          summary: `${opening.code} — application through the careers page`,
          after: { hasCv: !!stored, answers: Object.keys(answers).length, links: input.links.length, talentPool: input.talentPool },
        },
      };
    } catch (error) {
      if (stored) await softDeleteFile(stored.id);
      throw error;
    }
  },
});

/** The one public mutation in the product. */
export async function applyToOpening(input: PublicApplicationInput, visitor: Visitor) {
  return applyPipeline(input, visitor);
}
