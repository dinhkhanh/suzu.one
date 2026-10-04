import "server-only";
// Candidate retention (FR-REC-13, PDPL): the nightly job that empties out the records of people
// who applied, did not get the job, did not ask to be kept, and whose window has passed — and the
// same emptying done at once, by HR, when a candidate asks to be erased (NFR-PRV-04).
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
//   · the application — cover letter, answers to the custom questions, portfolio links, the salary
//     expectation, and the note written beside a rejection. What somebody asked to be paid is
//     about them, and so is why they were turned down.
//   · the application's history — every note (a recruiter's words on a move, the referrer's reason)
//     and the two names it keeps: the one typed into the public form when it matched a record, and
//     the one a referrer typed. What happened and when stays; who it happened to does not.
//   · the referral — the referrer's note. That somebody was referred, and by whom, stays.
//   · the offers — the internal note and the candidate's reason for declining.
//   · the scorecards — strengths, concerns, notes: free text written *about a named person*. The
//     ratings and the recommendation stay, because a 1-to-4 with no name attached says nothing
//     about anybody and is the only record of how the decision was reached.
//   · the take-home — the submission note and links. The brief stays; it is the company's.
//   · the letters — every row of the email outbox addressed to them: the address, the subject and
//     the text, and one not yet sent is never sent.
//   · the files — every CV and every submission, deleted and **their bytes removed at once**, not
//     after the storage sweep's grace period.
//
// The audit log is append-only and is not touched: recruitment's actions stopped writing a
// candidate's name into it (`actions.ts`), and what older rows say stays what was done.
//
// The job is idempotent by construction: `anonymised_at` is set in the same statement that empties
// the row, and `retentionOutcome` answers `already_done` for anything that carries it.
import { and, asc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { eraseFiles } from "@/modules/platform/files/service";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { ANONYMISED_NAME, PUBLIC_HIT_RETENTION_DAYS, type RetentionFacts, retentionOutcome } from "./engine/retention";
import { APPLICATION_CLOSED, DEFAULT_RETENTION_MONTHS } from "./enums";
import { purgePublicHits } from "./public";

const now = () => new Date();

/** Candidates emptied per night. Every row the query returns is due, so a backlog drains in order. */
const RETENTION_BATCH = 500;

export type RetentionResult = {
  /** Candidates looked at, of the ones whose window has passed. */
  considered: number;
  anonymised: number;
  /** Applications emptied out beside them. */
  applications: number;
  /** CVs and take-home submissions removed from storage. */
  files: number;
  /** Rate-limit counters swept. */
  publicHits: number;
};

/**
 * The candidates whose window has passed, with the facts the decision needs. **Decided in SQL**,
 * oldest window first: somebody hired, somebody still being considered and somebody whose latest
 * application closed inside the window are left out by the WHERE clause, so a page of people who
 * are *not* due can never crowd the ones who are out of the batch. The pure function is still
 * asked about every row — the rules are written once, there — but it now only confirms.
 *
 * **A grouped subquery, joined — not correlated subqueries.** Embedding a drizzle column in a `sql`
 * fragment renders it *unqualified* (`"id"`, not `"candidate"."id"`), so inside a correlated
 * subquery Postgres resolves it against the subquery's own table and the correlation silently
 * compares the wrong two columns — a count that is always zero, with typecheck, lint and build all
 * green. A grouped query says what it means and cannot be read two ways.
 */
async function candidatesPastTheirWindow(today: IsoDate, executor: Tx | ReturnType<typeof db> = db()) {
  const tally = executor
    .select({
      candidateId: schema.jobApplication.candidateId,
      openApplications: sql<number>`count(*) filter (where ${schema.jobApplication.status} not in ('hired','rejected','withdrawn'))`.as("open_applications"),
      hires: sql<number>`count(*) filter (where ${schema.jobApplication.hiredPersonId} is not null)`.as("hire_count"),
      // The day the latest application closed, in Vietnam — as text, so every driver hands back the same thing.
      lastClosedOn: sql<string | null>`(max(${schema.jobApplication.closedAt}) at time zone 'Asia/Ho_Chi_Minh')::date::text`.as("last_closed_on"),
    })
    .from(schema.jobApplication)
    .groupBy(schema.jobApplication.candidateId)
    .as("tally");

  // `date + interval` clamps to the end of a short month exactly as `retainUntilFrom` does.
  const window = sql`make_interval(months => ${DEFAULT_RETENTION_MONTHS}::int)`;
  const rows = await executor
    .select({
      id: schema.candidate.id,
      retainUntil: schema.candidate.retainUntil,
      createdAt: schema.candidate.createdAt,
      talentPoolConsent: schema.candidate.talentPoolConsent,
      anonymisedAt: schema.candidate.anonymisedAt,
      openApplications: tally.openApplications,
      hires: tally.hires,
      lastClosedOn: tally.lastClosedOn,
    })
    .from(schema.candidate)
    .leftJoin(tally, eq(tally.candidateId, schema.candidate.id))
    .where(
      and(
        isNull(schema.candidate.anonymisedAt),
        eq(schema.candidate.talentPoolConsent, false),
        sql`coalesce(${tally.openApplications}, 0) = 0`,
        sql`coalesce(${tally.hires}, 0) = 0`,
        // The window written on the record — or, where none was, the one counted from the day it was made.
        sql`coalesce(${schema.candidate.retainUntil}, ((${schema.candidate.createdAt} at time zone 'UTC')::date + ${window})::date) < ${today}::date`,
        // And the window counted from the latest application's close (see `effectiveRetainUntil`).
        or(isNull(tally.lastClosedOn), sql`(${tally.lastClosedOn}::date + ${window})::date < ${today}::date`),
      ),
    )
    .orderBy(asc(schema.candidate.retainUntil), asc(schema.candidate.id))
    .limit(RETENTION_BATCH);

  return rows.map((row) => ({ ...row, openApplications: Number(row.openApplications ?? 0), hires: Number(row.hires ?? 0), lastClosedOn: (row.lastClosedOn as IsoDate | null) ?? null }));
}

/**
 * Why a candidate is being emptied, written to each application's history: the window lapsed (the
 * nightly job, nobody behind it), or they asked and somebody in HR did it.
 */
export type AnonymiseCause = { reason: "retention"; actorPersonId: null } | { reason: "erasure"; actorPersonId: string };

/** Empties one candidate and everything of theirs. Returns what it touched. */
export async function anonymiseCandidate(candidateId: string, cause: AnonymiseCause = { reason: "retention", actorPersonId: null }): Promise<{ applications: number; files: number }> {
  // Read before the transaction: the address the outbox is searched by is gone once it has run, and
  // the files are removed after it — storage is not something to hold a transaction open across.
  const [[candidate], applications] = await Promise.all([
    db().select({ email: schema.candidate.email }).from(schema.candidate).where(eq(schema.candidate.id, candidateId)).limit(1),
    db().select({ id: schema.jobApplication.id }).from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidateId)),
  ]);
  if (!candidate) return { applications: 0, files: 0 };
  const applicationIds = applications.map((row) => row.id);

  // A CV belongs to its application, a submission to its take-home. Files already deleted but still
  // in storage are included: their bytes go now too.
  const assignments = applicationIds.length === 0 ? [] : await db().select({ id: schema.recruitAssignment.id }).from(schema.recruitAssignment).where(inArray(schema.recruitAssignment.applicationId, applicationIds));
  const assignmentIds = assignments.map((row) => row.id);
  const files = applicationIds.length === 0 ? [] : await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(
      and(
        isNull(schema.storedFile.purgedAt),
        or(
          and(eq(schema.storedFile.ownerType, "job_application"), inArray(schema.storedFile.ownerId, applicationIds)),
          assignmentIds.length > 0 ? and(eq(schema.storedFile.ownerType, "recruit_assignment"), inArray(schema.storedFile.ownerId, assignmentIds)) : undefined,
        ),
      ),
    );

  await db().transaction(async (tx) => {
    const [claimed] = await tx
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
      .where(and(eq(schema.candidate.id, candidateId), isNull(schema.candidate.anonymisedAt)))
      .returning({ id: schema.candidate.id });

    // The referrer's reason for putting them forward is about them. The referral itself stays.
    await tx.update(schema.referral).set({ note: null, updatedAt: now() }).where(eq(schema.referral.candidateId, candidateId));
    await tx.update(schema.jobOffer).set({ note: null, declineNote: null, updatedAt: now() }).where(eq(schema.jobOffer.candidateId, candidateId));

    // Every letter that was written to them. The row stays as the record that something was sent;
    // one still waiting is never sent. An address that is also a colleague's mailbox is left
    // alone — those rows are that colleague's notifications, not this candidate's letters.
    if (candidate.email) {
      await tx
        .update(schema.emailOutbox)
        .set({
          toEmail: "",
          subject: ANONYMISED_NAME,
          bodyText: "",
          lastError: null,
          status: sql`case when ${schema.emailOutbox.status} = 'pending' then 'skipped'::email_status else ${schema.emailOutbox.status} end`,
        })
        .where(
          and(
            sql`lower(${schema.emailOutbox.toEmail}) = ${candidate.email.toLowerCase()}`,
            notExists(tx.select({ one: sql`1` }).from(schema.person).where(eq(schema.person.workEmail, candidate.email.toLowerCase()))),
          ),
        );
    }

    if (applicationIds.length > 0) {
      await tx
        .update(schema.jobApplication)
        .set({ coverLetter: null, answers: {}, portfolioLinks: [], cvFileId: null, salaryExpectationVnd: null, salaryExpectationNote: null, rejectionNote: null, sourceDetail: null, updatedAt: now() })
        .where(inArray(schema.jobApplication.id, applicationIds));

      // The history keeps what happened and loses the words: a note may say anything about the
      // person, and two kinds of entry carry a name outright (`public.ts`, `referrals.ts`).
      await tx
        .update(schema.applicationEvent)
        .set({ note: null, detail: sql`${schema.applicationEvent.detail} - 'typedName'::text - 'referredName'::text` })
        .where(inArray(schema.applicationEvent.applicationId, applicationIds));

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

      // Written once, by the run that did the emptying: a second call finds nothing to claim.
      if (claimed) await tx.insert(schema.applicationEvent).values(applicationIds.map((applicationId) => ({ applicationId, type: "anonymised" as const, actorPersonId: cause.actorPersonId, detail: { reason: cause.reason } })));
    }
  });

  await eraseFiles(files.map((file) => file.id));
  return { applications: applicationIds.length, files: files.length };
}

/**
 * A candidate asks to be erased (PDPL; NFR-PRV-04) and HR does it now, rather than waiting for the
 * window. The same emptying as the nightly job, with two refusals that are facts rather than
 * preferences: somebody who became a colleague is in the employee register, which keeps its own
 * records under its own retention, and somebody with an application still open is being processed —
 * that application is withdrawn or rejected first, so the pipeline never holds a live card with
 * nobody behind it.
 */
export async function eraseCandidate(candidateId: string, actorPersonId: string): Promise<{ applications: number; files: number }> {
  const [[candidate], [tally]] = await Promise.all([
    db().select({ anonymisedAt: schema.candidate.anonymisedAt }).from(schema.candidate).where(eq(schema.candidate.id, candidateId)).limit(1),
    db()
      .select({
        open: sql<number>`count(*) filter (where ${schema.jobApplication.status} not in ('hired','rejected','withdrawn'))::int`,
        hires: sql<number>`count(*) filter (where ${schema.jobApplication.hiredPersonId} is not null)::int`,
      })
      .from(schema.jobApplication)
      .where(eq(schema.jobApplication.candidateId, candidateId)),
  ]);
  if (!candidate) throw new ActionError("recruit_candidate_not_found");
  if (candidate.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");
  if (Number(tally?.hires ?? 0) > 0) throw new ActionError("recruit_candidate_hired");
  if (Number(tally?.open ?? 0) > 0) throw new ActionError("recruit_candidate_in_progress");
  return anonymiseCandidate(candidateId, { reason: "erasure", actorPersonId });
}

/** One night's work. Safe to run again: everything it did is recorded on the rows it did it to. */
export async function runCandidateRetention(today: IsoDate = todayInVietnam()): Promise<RetentionResult> {
  const rows = await candidatesPastTheirWindow(today);
  const result: RetentionResult = { considered: rows.length, anonymised: 0, applications: 0, files: 0, publicHits: 0 };

  for (const row of rows) {
    const facts: RetentionFacts = {
      retainUntil: row.retainUntil as IsoDate | null,
      createdOn: row.createdAt.toISOString().slice(0, 10) as IsoDate,
      lastClosedOn: row.lastClosedOn,
      talentPoolConsent: row.talentPoolConsent,
      anonymised: !!row.anonymisedAt,
      hasOpenApplication: row.openApplications > 0,
      hasHire: row.hires > 0,
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
