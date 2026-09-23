import "server-only";
// The employee referral programme (FR-REC-10).
//
// Three things decide the shape of this file.
//
//   · **A referral is an ordinary application with a name attached to it.** The candidate is made
//     by `createCandidate` and the application by `createApplication` — the same duplicate check,
//     the same first stage, the same history, the same retention clock. There is no second way
//     into the pipeline, which is the only way to be sure a referred candidate is treated (and
//     purged) exactly like anybody else.
//   · **A referrer must not learn who is already in the candidate database.** Referring somebody
//     the company is already talking to answers *identically* to referring a stranger: the
//     referral is quietly attached to the record that exists, or quietly not written at all when
//     somebody else already referred them. An employee may put a name forward; they may not use
//     the form as a lookup for "is my friend already interviewing here?". That covers the list
//     of their own referrals too: it shows the name *they typed* and a neutral "received", never
//     the name on file, the stage or the status — see `listMyReferrals`.
//   · **A referral attached to an application that already existed earns nothing.** The candidate
//     had applied (or been added by a recruiter) before the colleague spoke up, so the colleague
//     did not bring them in. The fact is read, not stored: the application is older than the
//     referral (see `preexisting` in `baseQuery`).
//   · **No amount lives here.** `engine/referral.ts` says when a bonus has been *earned*; what it
//     is worth, and paying it, is payroll's. All this module stores is that somebody settled it.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { reownFile, storeIncomingFile, softDeleteFile } from "@/modules/platform/files/service";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { type ReferralBonusState, referralBonusState } from "./engine/referral";
import { type ApplicationStatus, OPENING_PUBLIC_STATUSES } from "./enums";
import { canRunRecruitment } from "./policy";
import { createApplication, createCandidate, findLikelyCandidateDuplicates, findOpening, inTransaction, recordApplicationEvent } from "./service";

type Executor = Tx | ReturnType<typeof db>;

const now = () => new Date();

export type ReferralRow = typeof schema.referral.$inferSelect;

/** A referral's CV is a CV: the same allow-list, the same size, the same magic-byte check. */
export const MAX_REFERRAL_CV_BYTES = 5 * 1024 * 1024;

export type ReferralInput = {
  openingId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  links: string[];
  note: string | null;
  cv: { fileName: string; bytes: Uint8Array } | null;
};

/**
 * What the referrer is told, whatever happened: thank you. See the note at the top of this file —
 * every other answer would make the form a way of reading the candidate database.
 */
export type ReferralOutcome = { received: true };

/** The openings an employee may put a name forward for: the published ones, and nothing else. */
export async function listOpeningsForReferral(executor: Executor = db()): Promise<{ id: string; title: string; code: string; departmentName: string | null; entityName: string | null }[]> {
  return executor
    .select({
      id: schema.jobOpening.id,
      title: schema.jobOpening.title,
      code: schema.jobOpening.code,
      departmentName: schema.orgUnit.name,
      entityName: schema.entity.shortName,
    })
    .from(schema.jobOpening)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.jobOpening.departmentId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.jobOpening.entityId))
    .where(and(inArray(schema.jobOpening.status, [...OPENING_PUBLIC_STATUSES]), sql`${schema.jobOpening.publishedAt} is not null`))
    .orderBy(schema.jobOpening.title);
}

/**
 * Somebody puts a colleague-to-be forward.
 *
 * The bytes are stored before the transaction (a network call does not belong inside one) and the
 * file's owner is corrected once the application exists — the pattern the public form uses. If the
 * work below decides there is nothing to write, the file is soft-deleted rather than left orphaned.
 */
export async function submitReferral(input: ReferralInput, referrerPersonId: string): Promise<ReferralOutcome> {
  const opening = await findOpening(input.openingId);
  // Not `recruit_opening_not_found`: an employee has no business knowing which ids exist. An
  // unpublished opening is simply not something they can refer into.
  if (!opening || !OPENING_PUBLIC_STATUSES.includes(opening.status) || !opening.publishedAt) throw new ActionError("recruit_opening_not_open");

  const stored = input.cv
    ? await storeIncomingFile({ ownerType: "job_application", ownerId: `pending:${opening.id}`, entityId: opening.entityId, tier: "personal" }, input.cv, { maxBytes: MAX_REFERRAL_CV_BYTES })
    : null;

  try {
    const applicationId = await inTransaction(async (tx) => {
      const candidateId = await candidateForReferral(input, referrerPersonId, tx);

      const [existing] = await tx
        .select({ id: schema.jobApplication.id })
        .from(schema.jobApplication)
        .where(and(eq(schema.jobApplication.candidateId, candidateId), eq(schema.jobApplication.openingId, opening.id)))
        .limit(1);

      // They have already applied, or somebody has already referred them. Either way the referrer
      // is told the same thing as everybody else and nothing is written twice.
      // The row that is written is excluded from any bonus (the application is older than it), and
      // the referrer's list shows it exactly as it shows a stranger's: their words, "received".
      if (existing) {
        const [alreadyReferred] = await tx.select({ id: schema.referral.id }).from(schema.referral).where(eq(schema.referral.applicationId, existing.id)).limit(1);
        if (alreadyReferred) return null;
        await tx.insert(schema.referral).values({ referredByPersonId: referrerPersonId, candidateId, openingId: opening.id, applicationId: existing.id, note: input.note });
        await recordReferralEvent(tx, existing.id, referrerPersonId, input);
        return null;
      }

      const application = await createApplication(
        {
          candidateId,
          openingId: opening.id,
          source: "referral",
          sourceDetail: null,
          coverLetter: null,
          answers: {},
          cvFileId: stored?.id ?? null,
          portfolioLinks: input.links,
          // A referrer does not negotiate on the candidate's behalf.
          salaryExpectationVnd: null,
          salaryExpectationNote: null,
        },
        referrerPersonId,
        tx,
      );
      await tx.insert(schema.referral).values({ referredByPersonId: referrerPersonId, candidateId, openingId: opening.id, applicationId: application.id, note: input.note });
      await recordReferralEvent(tx, application.id, referrerPersonId, input);
      return application.id;
    });

    if (applicationId && stored) await reownFile(stored.id, { ownerId: applicationId, entityId: opening.entityId });
    else if (stored) await softDeleteFile(stored.id);
    return { received: true };
  } catch (error) {
    if (stored) await softDeleteFile(stored.id).catch(() => undefined);
    throw error;
  }
}

/**
 * The referral in the application's history, carrying **the name the referrer typed**. That name is
 * what the referrer's own list shows back to them: the name on file may differ from it, and showing
 * that one would say the person was on file already.
 */
async function recordReferralEvent(tx: Tx, applicationId: string, referrerPersonId: string, input: ReferralInput): Promise<void> {
  await recordApplicationEvent(tx, { applicationId, type: "note", actorPersonId: referrerPersonId, note: input.note, detail: { referral: true, referredName: input.fullName } });
}

/**
 * The candidate this referral is about. A *certain* duplicate (the same mailbox or the same
 * number) is the same person, so the referral joins their record; a bare name match is not enough
 * to merge two strangers, so a new record is made. Neither answer reaches the referrer.
 *
 * **No consent is recorded**, because the candidate has not agreed to anything — a colleague
 * passed on their details. The retention clock still starts (`createCandidate` sets it), and the
 * recruiter obtains consent when they make contact. The form says so to the referrer.
 */
async function candidateForReferral(input: ReferralInput, referrerPersonId: string, tx: Tx): Promise<string> {
  const duplicates = await findLikelyCandidateDuplicates({ fullName: input.fullName, email: input.email, phone: input.phone }, undefined, tx);
  const certain = duplicates.find((match) => match.certain);
  if (certain) return certain.id;

  const created = await createCandidate(
    {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      currentTitle: input.currentTitle,
      currentEmployer: input.currentEmployer,
      location: null,
      links: input.links,
      source: "referral",
      sourceDetail: null,
      referredByPersonId: referrerPersonId,
      tags: [],
      notes: null,
    },
    referrerPersonId,
    // A name-only warning has nobody out here to answer it; see `public.ts` for the same reasoning.
    { confirmedNotDuplicate: true },
    tx,
  );
  return created.id;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type ReferralListRow = {
  id: string;
  candidateName: string;
  candidateAnonymised: boolean;
  openingId: string;
  openingCode: string;
  openingTitle: string;
  applicationId: string;
  applicationStatus: ApplicationStatus;
  stageName: string;
  referredByPersonId: string;
  referredByName: string;
  createdAt: Date;
  bonus: ReferralBonusState;
  bonusNote: string | null;
};

const baseQuery = () => {
  const referrer = schema.person;
  const acceptedOffer = schema.jobOffer;
  return db()
    .select({
      id: schema.referral.id,
      note: schema.referral.note,
      createdAt: schema.referral.createdAt,
      bonusSettledAt: schema.referral.bonusSettledAt,
      bonusNote: schema.referral.bonusNote,
      referredByPersonId: schema.referral.referredByPersonId,
      referredByName: referrer.fullName,
      candidateName: schema.candidate.fullName,
      candidateAnonymisedAt: schema.candidate.anonymisedAt,
      openingId: schema.jobOpening.id,
      openingCode: schema.jobOpening.code,
      openingTitle: schema.jobOpening.title,
      applicationId: schema.jobApplication.id,
      applicationStatus: schema.jobApplication.status,
      hiredPersonId: schema.jobApplication.hiredPersonId,
      stageName: schema.recruitPipelineStage.name,
      /**
       * The two facts the bonus state is read from — **joined, not sub-selected**. A drizzle
       * column embedded in a `sql` fragment renders unqualified, so a correlated subquery
       * comparing it silently matches against the *inner* table's own column instead. At most one
       * accepted offer can exist per application (the partial unique index), so a left join is
       * exact as well as safe. Neither figure on the offer is read here: only its dates.
       */
      offerStartDate: acceptedOffer.startDate,
      offerProbationMonths: acceptedOffer.probationMonths,
      /**
       * The application existed before the referral. A referral made with its application shares
       * the transaction, and so its `created_at` (`now()` is the transaction's start); a referral
       * attached to an older application is strictly younger than it.
       */
      preexisting: sql<boolean>`${schema.jobApplication.createdAt} < ${schema.referral.createdAt}`,
      /**
       * The name the referrer typed, from the referral's own history entry. Written out in full
       * rather than with drizzle columns — see the note above on correlated subqueries. Null for a
       * referral made before the name was kept there.
       */
      referredName: sql<string | null>`(
        select e.detail->>'referredName' from application_event e
        where e.application_id = "referral"."application_id"
          and e.actor_person_id = "referral"."referred_by_person_id"
          and e.detail->>'referral' = 'true'
        order by e.id limit 1
      )`,
      candidateReferredByPersonId: schema.candidate.referredByPersonId,
    })
    .from(schema.referral)
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.referral.candidateId))
    .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.referral.openingId))
    .innerJoin(schema.jobApplication, eq(schema.jobApplication.id, schema.referral.applicationId))
    .innerJoin(schema.recruitPipelineStage, eq(schema.recruitPipelineStage.id, schema.jobApplication.stageId))
    .innerJoin(referrer, eq(referrer.id, schema.referral.referredByPersonId))
    .leftJoin(acceptedOffer, and(eq(acceptedOffer.applicationId, schema.jobApplication.id), eq(acceptedOffer.status, "accepted")));
};

type RawRow = {
  id: string;
  note: string | null;
  createdAt: Date;
  bonusSettledAt: Date | null;
  bonusNote: string | null;
  referredByPersonId: string;
  referredByName: string;
  candidateName: string;
  candidateAnonymisedAt: Date | null;
  openingId: string;
  openingCode: string;
  openingTitle: string;
  applicationId: string;
  applicationStatus: ApplicationStatus;
  hiredPersonId: string | null;
  stageName: string;
  offerStartDate: string | null;
  offerProbationMonths: number | null;
  preexisting: boolean;
  referredName: string | null;
  candidateReferredByPersonId: string | null;
};

function toListRow(row: RawRow, today: IsoDate): ReferralListRow {
  return {
    id: row.id,
    candidateName: row.candidateName,
    candidateAnonymised: !!row.candidateAnonymisedAt,
    openingId: row.openingId,
    openingCode: row.openingCode,
    openingTitle: row.openingTitle,
    applicationId: row.applicationId,
    applicationStatus: row.applicationStatus,
    stageName: row.stageName,
    referredByPersonId: row.referredByPersonId,
    referredByName: row.referredByName,
    createdAt: row.createdAt,
    bonus: referralBonusState(
      {
        applicationStatus: row.applicationStatus,
        hired: !!row.hiredPersonId,
        startDate: (row.offerStartDate as IsoDate | null) ?? null,
        probationMonths: row.offerProbationMonths === null ? null : Number(row.offerProbationMonths),
        settled: !!row.bonusSettledAt,
        preexisting: !!row.preexisting,
      },
      today,
    ),
    bonusNote: row.bonusNote,
  };
}

/**
 * One of my referrals, as its referrer may see it: **what I typed and nothing the company holds.**
 * No stage, no status, no name from the candidate record — any of those would tell a referrer that
 * the person was already on file (a stage past the first, a different spelling of the name). The
 * state is `received` until a bonus is actually earned: a rejection reads the same as an
 * application still in progress, and a referral attached to an older application never leaves
 * `received`, so it looks exactly like a stranger's that did not end in a hire.
 */
export type MyReferralRow = {
  id: string;
  /** The name the referrer typed. Null only for a referral whose typed name was not kept. */
  name: string | null;
  openingCode: string;
  openingTitle: string;
  createdAt: Date;
  referredByPersonId: string;
  state: "received" | "earned" | "settled";
};

/** What I have put forward. Mine and nobody else's — no permission required, and none granted. */
export async function listMyReferrals(personId: string, today: IsoDate = todayInVietnam()): Promise<MyReferralRow[]> {
  const rows = await baseQuery().where(eq(schema.referral.referredByPersonId, personId)).orderBy(desc(schema.referral.createdAt)).limit(200);
  return rows.map((row) => {
    const { bonus } = toListRow(row, today);
    return {
      id: row.id,
      // An older referral kept no typed name. Its record's name is shown only when this referral
      // made that record — the referrer typed it — and never for one that was already on file.
      name: row.referredName ?? (!row.preexisting && row.candidateReferredByPersonId === personId && !row.candidateAnonymisedAt ? row.candidateName : null),
      openingCode: row.openingCode,
      openingTitle: row.openingTitle,
      createdAt: row.createdAt,
      referredByPersonId: row.referredByPersonId,
      state: bonus === "earned" || bonus === "settled" ? bonus : "received",
    };
  });
}

/** Every referral in the reader's recruitment scope — the list HR settles bonuses from. */
export async function listReferrals(principal: Principal, today: IsoDate = todayInVietnam()): Promise<ReferralListRow[]> {
  if (!canRunRecruitment(principal)) return [];
  const reach = entityReach(principal, "recruit:manage");
  const scope = reach.all ? sql`true` : reach.entityIds.length > 0 ? inArray(schema.jobOpening.entityId, reach.entityIds) : sql`false`;
  const rows = await baseQuery().where(scope).orderBy(desc(schema.referral.createdAt)).limit(500);
  return rows.map((row) => toListRow(row, today));
}

export async function findReferral(referralId: string, executor: Executor = db()): Promise<ReferralRow | undefined> {
  const [row] = await executor.select().from(schema.referral).where(eq(schema.referral.id, referralId)).limit(1);
  return row;
}

/**
 * HR marks a bonus settled. Only a referral the facts say has been **earned** may be settled — a
 * bonus paid for somebody still on probation is a mistake this refuses rather than records — and
 * settling twice is refused too.
 */
export async function settleReferralBonus(referralId: string, actorPersonId: string, note: string | null, today: IsoDate = todayInVietnam()): Promise<ReferralRow> {
  const [row] = await listReferralsById(referralId, today);
  if (!row) throw new ActionError("recruit_referral_not_found");
  if (row.bonus === "settled") throw new ActionError("recruit_referral_already_settled");
  if (row.bonus !== "earned") throw new ActionError("recruit_referral_not_earned");
  const [after] = await db()
    .update(schema.referral)
    .set({ bonusSettledAt: now(), bonusSettledByPersonId: actorPersonId, bonusNote: note, updatedAt: now() })
    .where(and(eq(schema.referral.id, referralId), sql`${schema.referral.bonusSettledAt} is null`))
    .returning();
  if (!after) throw new ActionError("recruit_referral_already_settled");
  return after;
}

async function listReferralsById(referralId: string, today: IsoDate): Promise<ReferralListRow[]> {
  const rows = await baseQuery().where(eq(schema.referral.id, referralId)).limit(1);
  return rows.map((row) => toListRow(row, today));
}
