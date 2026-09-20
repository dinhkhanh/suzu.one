import "server-only";
// Candidate retention (FR-REC-13, PDPL): the nightly job that empties out the records of people
// who applied, did not get the job, did not ask to be kept, and whose window has passed.
//
// **Anonymise, never delete.** The rows stay, with everything that says who the person was taken
// out of them: the funnel report can still say that 40 people applied in March and 3 were hired,
// and none of those 40 is a person any more. Deleting would either lie to the report or cascade
// through half the module.
//
// What is emptied, and why each one:
//   · the candidate — name, mailbox, number, both normalised keys, employer, title, town, links,
//     tags, notes. The keys go too: a hash of a phone number is still a way of recognising a phone
//     number, which is the whole reason the duplicate check works.
//   · the application — cover letter, answers to the custom questions, portfolio links, and the
//     salary expectation. What somebody asked to be paid is about them.
//   · the scorecards — strengths, concerns, notes: free text written *about a named person*. The
//     ratings and the recommendation stay, because a 1-to-4 with no name attached says nothing
//     about anybody and is the only record of how the decision was reached.
//   · the take-home — the submission note and links. The brief stays; it is the company's.
//   · the files — every CV and every submission, soft-deleted so the bytes go with the next
//     storage sweep. `purgeAbandonedUploads` only ever looked at uploads nobody finished.
//
// The job is idempotent by construction: `anonymised_at` is set in the same statement that empties
// the row, and `retentionOutcome` answers `already_done` for anything that carries it.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { softDeleteFile } from "@/modules/platform/files/service";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { ANONYMISED_NAME, PUBLIC_HIT_RETENTION_DAYS, type RetentionFacts, retentionOutcome } from "./engine/retention";
import { APPLICATION_CLOSED } from "./enums";
import { purgePublicHits } from "./public";
import { recordApplicationEvent } from "./service";

const now = () => new Date();

export type RetentionResult = {
  /** Candidates looked at, of the ones whose window has passed. */
  considered: number;
  anonymised: number;
  /** Applications emptied out beside them. */
  applications: number;
  /** CVs and take-home submissions soft-deleted. */
  files: number;
  /** Rate-limit counters swept. */
  publicHits: number;
};

/**
 * The candidates whose window has passed, with the facts the decision needs. Narrowed in SQL to
 * the ones that could possibly be due — everything else is decided by the pure function, so the
 * rules live in one readable place rather than half here and half in a WHERE clause.
 *
 * **Two queries, not one with correlated subqueries.** Embedding a drizzle column in a `sql`
 * fragment renders it *unqualified* (`"id"`, not `"candidate"."id"`), so inside a subquery
 * Postgres resolves it against the subquery's own table and the correlation silently compares the
 * wrong two columns — a count that is always zero, with typecheck, lint and build all green. A
 * grouped query says what it means and cannot be read two ways.
 */
async function candidatesPastTheirWindow(today: IsoDate, executor: Tx | ReturnType<typeof db> = db()) {
  const candidates = await executor
    .select({
      id: schema.candidate.id,
      retainUntil: schema.candidate.retainUntil,
      createdAt: schema.candidate.createdAt,
      talentPoolConsent: schema.candidate.talentPoolConsent,
      anonymisedAt: schema.candidate.anonymisedAt,
    })
    .from(schema.candidate)
    .where(
      and(
        isNull(schema.candidate.anonymisedAt),
        eq(schema.candidate.talentPoolConsent, false),
        // A null window is decided by the pure function from the creation date, so it must not be
        // filtered out here.
        or(isNull(schema.candidate.retainUntil), sql`${schema.candidate.retainUntil} < ${today}::date`),
      ),
    )
    .limit(500);

  if (candidates.length === 0) return [];

  const tallies = await executor
    .select({
      candidateId: schema.jobApplication.candidateId,
      openApplications: sql<number>`count(*) filter (where ${schema.jobApplication.status} not in ('hired','rejected','withdrawn'))`.as("open_applications"),
      hires: sql<number>`count(*) filter (where ${schema.jobApplication.hiredPersonId} is not null)`.as("hire_count"),
    })
    .from(schema.jobApplication)
    .where(inArray(schema.jobApplication.candidateId, candidates.map((row) => row.id)))
    .groupBy(schema.jobApplication.candidateId);

  const byCandidate = new Map(tallies.map((row) => [row.candidateId, row]));
  return candidates.map((row) => {
    const tally = byCandidate.get(row.id);
    return { ...row, openApplications: Number(tally?.openApplications ?? 0), hires: Number(tally?.hires ?? 0) };
  });
}

/** Empties one candidate and everything of theirs. Returns what it touched. */
export async function anonymiseCandidate(candidateId: string): Promise<{ applications: number; files: number }> {
  // The files are read before the transaction and soft-deleted after it: storage is not something
  // to hold a transaction open across, and a file marked deleted whose row survived is harmless.
  const applications = await db().select({ id: schema.jobApplication.id }).from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidateId));
  const applicationIds = applications.map((row) => row.id);

  const fileIds = applicationIds.length === 0 ? [] : await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.ownerType, "job_application"), inArray(schema.storedFile.ownerId, applicationIds), isNull(schema.storedFile.deletedAt)));

  await db().transaction(async (tx) => {
    await tx
      .update(schema.candidate)
      .set({
        fullName: ANONYMISED_NAME,
        searchName: "",
        email: null,
        phone: null,
        emailKey: null,
        phoneKey: null,
        currentTitle: null,
        currentEmployer: null,
        location: null,
        links: [],
        tags: [],
        notes: null,
        sourceDetail: null,
        anonymisedAt: now(),
        updatedAt: now(),
      })
      // `anonymised_at is null` in the statement itself: two runs racing cannot both do the work.
      .where(and(eq(schema.candidate.id, candidateId), isNull(schema.candidate.anonymisedAt)));

    if (applicationIds.length > 0) {
      await tx
        .update(schema.jobApplication)
        .set({ coverLetter: null, answers: {}, portfolioLinks: [], cvFileId: null, salaryExpectationVnd: null, salaryExpectationNote: null, updatedAt: now() })
        .where(inArray(schema.jobApplication.id, applicationIds));

      // The opinions written about a named person go; the numbers, which are about nobody once the
      // name is gone, stay — they are how the decision can still be accounted for.
      await tx
        .update(schema.interviewScorecard)
        .set({ strengths: null, concerns: null, notes: null, updatedAt: now() })
        .where(
          inArray(
            schema.interviewScorecard.interviewId,
            db().select({ id: schema.interview.id }).from(schema.interview).where(inArray(schema.interview.applicationId, applicationIds)),
          ),
        );

      await tx
        .update(schema.recruitAssignment)
        .set({ submissionNote: null, submissionLinks: [], submissionFileId: null, updatedAt: now() })
        .where(inArray(schema.recruitAssignment.applicationId, applicationIds));

      for (const applicationId of applicationIds) {
        await recordApplicationEvent(tx, { applicationId, type: "anonymised", actorPersonId: null, detail: { reason: "retention" } });
      }
    }
  });

  for (const file of fileIds) await softDeleteFile(file.id);
  return { applications: applicationIds.length, files: fileIds.length };
}

/** One night's work. Safe to run again: everything it did is recorded on the rows it did it to. */
export async function runCandidateRetention(today: IsoDate = todayInVietnam()): Promise<RetentionResult> {
  const rows = await candidatesPastTheirWindow(today);
  const result: RetentionResult = { considered: rows.length, anonymised: 0, applications: 0, files: 0, publicHits: 0 };

  for (const row of rows) {
    const facts: RetentionFacts = {
      retainUntil: row.retainUntil as IsoDate | null,
      createdOn: row.createdAt.toISOString().slice(0, 10) as IsoDate,
      talentPoolConsent: row.talentPoolConsent,
      anonymised: !!row.anonymisedAt,
      hasOpenApplication: Number(row.openApplications) > 0,
      hasHire: Number(row.hires) > 0,
    };
    if (retentionOutcome(facts, today) !== "anonymise") continue;
    const touched = await anonymiseCandidate(row.id);
    result.anonymised++;
    result.applications += touched.applications;
    result.files += touched.files;
  }

  // The rate limiter's counters are hashes of addresses with an hour's resolution; a week on they
  // are noise. Swept here rather than in their own job — they are the same obligation.
  const cutoff = new Date(Date.now() - PUBLIC_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  result.publicHits = await purgePublicHits(cutoff);
  return result;
}

export const candidateRetentionJob: JobDefinition = {
  name: "candidate-retention",
  run: async ({ today }) => ({ ...(await runCandidateRetention(today)) }),
};

/** Exported for the tests and the demo seed: which statuses count as "no longer being considered". */
export const CLOSED_APPLICATION_STATUSES = APPLICATION_CLOSED;
