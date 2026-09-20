import "server-only";
// Offers, and the moment a candidate becomes an employee (FR-REC-08, FR-REC-09).
//
// Four things in this file carry the weight.
//
// **The figure never leaves this table.** An offer's salary is a compensation-tier fact. It is not
// in the approval request's payload or summary, not in a notification, not in the candidate's
// email, not in the audit log and not in `application_event`. Everything that has to travel — an
// inbox line, a chat card, a history entry — travels as the offer's *number* and the candidate's
// name. `getOfferView` cuts the figure out by tier before the row leaves the service, so a page
// that forgot to check still cannot render what it was never given.
//
// **The letter is never stored.** It is re-made from its template every time it is opened and the
// tier is re-checked *then* — the rule `src/modules/documents/` set in Phase 6. A candidate is not
// a `person`, so `generateDocument` cannot be used; what is reused is the part that matters, the
// pure engine and its placeholder catalogue, through `offerLetterContext` below.
//
// **The company's refusal and the candidate's decline are different things.** `rejected` means we
// decided not to make this offer and the candidate never heard of it; `declined` means they said
// no. Conflating them would make the funnel report lie about why people do not join.
//
// **Conversion goes through core-HR and payroll, never round them.** `hireInTransaction` is the one
// code path that puts a person on the books (Phase 1), and `submitSalaryChange` is the one that
// sets a salary (SRS D17: C&B proposes, the owner decides). Recruitment hands each of them what
// the candidate already typed and gets out of the way — that, and not a copy-and-paste screen, is
// what "no retyping" means.
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { hireInTransaction, listPositionNames } from "@/modules/core-hr/service";
import { atLeast, type LetterheadFields, renderTemplate, vietnameseWords } from "@/modules/documents/service";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { notify } from "@/modules/platform/notifications/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { submitSalaryChange } from "@/modules/payroll/service";
import {
  DEFAULT_OFFER_VALID_DAYS,
  type EmploymentType,
  OFFER_LIMITS,
  OFFER_LIVE,
  type OfferDeclineReason,
  type OfferStatus,
} from "./enums";
import { defaultExpiry, effectiveOfferStatus, mayMove, nextStatus, offerProblems, offerTotalVnd, probationMonthlyVnd } from "./engine/offer";
import { canConvertToEmployee, canMakeOffer, canReadOfferMoney, canReadRecruitMoney, canRecordOfferResponse, canViewOffer, type OpeningTarget } from "./policy";
import { findApplication, findCandidate, findOpening, isOpeningMember, recordApplicationEvent } from "./service";

type Executor = Tx | ReturnType<typeof db>;

export type OfferRow = typeof schema.jobOffer.$inferSelect;

const now = () => new Date();
const targetOf = (opening: { entityId: string; departmentId: string | null; teamId: string | null }): OpeningTarget => ({ entityId: opening.entityId, departmentId: opening.departmentId, teamId: opening.teamId });

type PgError = { code?: string; constraint?: string; constraint_name?: string };

/**
 * Was this a unique-index violation on `constraint`? Drizzle wraps the driver's error, so the
 * SQLSTATE lives on `cause` rather than on the error itself — reading the outer error alone lets a
 * raw "Failed query: insert into …" reach a form, which is how this was found.
 */
function uniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: PgError } | null)?.cause ?? (error as PgError | null);
  return cause?.code === "23505" && (cause.constraint === constraint || cause.constraint_name === constraint);
}

// ── The approval (FR-REC-08) ────────────────────────────────────────────────────────────────

/** What the approval request's payload holds. As with a hiring request: no figure among it. */
export type OfferPayload = { offerId: string; applicationId: string; number: string; positionName: string; candidateName: string; startDate: IsoDate };

/**
 * Two steps, and both are deliberate.
 *
 * The **hiring manager's** department head signs off that this is the person — a `role` rule, so it
 * resolves against the opening's own department rather than against whoever happens to be filing.
 * Then whoever may **approve payroll** signs off on the money, because that is what an offer is.
 * An administrator may replace the whole thing per entity in Admin → Approval flows.
 *
 * `conditionFields` names `employmentType` and nothing else. A flow condition's value is stored on
 * the approval request and shown in the flow administration, so branching on the amount would put
 * the figure exactly where this module spends its time keeping it out of. "Above twenty million
 * also needs the CEO" is therefore not expressible — the second step already requires
 * `payroll:approve`, which is the authority that question is really asking for.
 */
export const offerRequestType = defineRequestType({
  type: "offer",
  flow: {
    steps: [
      { key: "hiring_manager", mode: "any", approvers: [{ rule: "role", role: "department_head" }] },
      { key: "compensation", mode: "any", approvers: [{ rule: "permission", permission: "payroll:approve" }] },
    ],
  },
  conditionFields: ["employmentType"],
  // Never from the inbox without opening it: an offer is a salary, and the salary is on its page.
  bulkApprovable: () => false,
  // Nobody beyond the parties to the request. An offer is read on its own page, where the tier and
  // the step-up decide; the approval request itself is a line in an inbox and stays that way.
  canView: () => false,
});

// ── Numbering ───────────────────────────────────────────────────────────────────────────────

/** "SZM-TM-2026-0001". Counted from what is already on the books, per entity and year. */
async function nextOfferNumber(executor: Executor, entityCode: string, year: number): Promise<string> {
  const prefix = `${entityCode}-TM-${year}-`;
  const rows = await executor.select({ number: schema.jobOffer.number }).from(schema.jobOffer).where(like(schema.jobOffer.number, `${prefix}%`));
  const highest = rows.reduce((top, row) => {
    const tail = row.number.slice(prefix.length);
    return /^\d+$/.test(tail) ? Math.max(top, Number(tail)) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

// ── Making one ──────────────────────────────────────────────────────────────────────────────

export type OfferInput = {
  applicationId: string;
  positionName: string;
  jobLevel: string | null;
  employmentType: EmploymentType;
  workLocation: string | null;
  managerPersonId: string | null;
  startDate: IsoDate;
  expiresOn: IsoDate | null;
  probationMonths: number;
  probationSalaryPercent: number;
  baseSalaryVnd: number;
  allowancesVnd: number;
  letterTemplateId: string | null;
  note: string | null;
};

function checkDraft(input: OfferInput, today: IsoDate): IsoDate {
  const expiresOn = input.expiresOn ?? defaultExpiry(input.startDate, today, DEFAULT_OFFER_VALID_DAYS);
  const problems = offerProblems({ ...input, expiresOn }, today);
  if (problems.length) throw new ActionError(problems[0]);
  if (input.note && input.note.length > OFFER_LIMITS.note) throw new ActionError("offer_note_too_long");
  return expiresOn;
}

/**
 * Drafts the offer. The job is copied off the opening *now* — position, department, team,
 * work location — because the opening may be edited or closed later and the offer must keep
 * saying what was actually promised.
 */
export async function makeOffer(input: OfferInput, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<OfferRow> {
  const expiresOn = checkDraft(input, today);

  return db().transaction(async (tx) => {
    const application = await findApplication(input.applicationId, tx);
    if (!application) throw new ActionError("recruit_application_not_found");
    if (application.status !== "active") throw new ActionError("recruit_application_closed");
    const opening = await findOpening(application.openingId, tx);
    if (!opening) throw new ActionError("recruit_opening_not_found");

    const [entity] = await tx.select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, opening.entityId)).limit(1);
    const number = await nextOfferNumber(tx, entity?.code ?? "SZ", Number(today.slice(0, 4)));

    const [offer] = await tx
      .insert(schema.jobOffer)
      .values({
        applicationId: application.id,
        openingId: opening.id,
        candidateId: application.candidateId,
        entityId: opening.entityId,
        number,
        positionName: input.positionName,
        jobLevel: input.jobLevel,
        departmentId: opening.departmentId,
        teamId: opening.teamId,
        managerPersonId: input.managerPersonId,
        employmentType: input.employmentType,
        workLocation: input.workLocation ?? opening.workLocation,
        startDate: input.startDate,
        probationMonths: input.probationMonths,
        probationSalaryPercent: input.probationSalaryPercent,
        baseSalaryVnd: input.baseSalaryVnd,
        allowancesVnd: input.allowancesVnd,
        status: "draft",
        expiresOn,
        letterTemplateId: input.letterTemplateId,
        note: input.note,
        createdByPersonId: actorPersonId,
      })
      .returning()
      .catch((error: unknown) => {
        // The partial unique index: one live offer per application. Read back rather than raced.
        // Drizzle wraps the driver's error, so the code is on `cause` — a check on the outer error
        // alone silently lets a raw "Failed query: …" through to the form.
        if (uniqueViolation(error, "job_offer_live_key")) throw new ActionError("offer_already_open");
        throw error;
      });

    // The history says an offer was made. It does not say how much — `application_event` is read
    // by everybody who can open the application.
    await recordApplicationEvent(tx, { applicationId: application.id, type: "offer_made", actorPersonId, detail: { number: offer.number, startDate: offer.startDate } });
    return offer;
  });
}

/** Changing a draft. Only a draft: once it is under approval the figure is in front of an approver. */
export async function updateOffer(offerId: string, input: OfferInput, today: IsoDate = todayInVietnam()): Promise<{ before: OfferRow; after: OfferRow }> {
  const expiresOn = checkDraft(input, today);

  return db().transaction(async (tx) => {
    const before = await findOffer(offerId, tx);
    if (!before) throw new ActionError("offer_not_found");
    if (!mayMove(before.status, "edit")) throw new ActionError("offer_not_editable");

    const [after] = await tx
      .update(schema.jobOffer)
      .set({
        positionName: input.positionName,
        jobLevel: input.jobLevel,
        employmentType: input.employmentType,
        workLocation: input.workLocation,
        managerPersonId: input.managerPersonId,
        startDate: input.startDate,
        expiresOn,
        probationMonths: input.probationMonths,
        probationSalaryPercent: input.probationSalaryPercent,
        baseSalaryVnd: input.baseSalaryVnd,
        allowancesVnd: input.allowancesVnd,
        letterTemplateId: input.letterTemplateId,
        note: input.note,
        updatedAt: now(),
      })
      .where(eq(schema.jobOffer.id, offerId))
      .returning();
    return { before, after };
  });
}

// ── Its life ────────────────────────────────────────────────────────────────────────────────

/** Sends the draft for approval. Validated again here: an approver is never shown a refused figure. */
export async function submitOfferForApproval(offerId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ offer: OfferRow; requestId: string }> {
  return db().transaction(async (tx) => {
    const offer = await findOffer(offerId, tx);
    if (!offer) throw new ActionError("offer_not_found");
    const status = nextStatus(offer.status, "submit");
    if (!status) throw new ActionError("offer_not_submittable");
    const problems = offerProblems({ ...offer, expiresOn: offer.expiresOn as IsoDate, startDate: offer.startDate as IsoDate }, today);
    if (problems.length) throw new ActionError(problems[0]);

    const candidate = await findCandidate(offer.candidateId, tx);
    const payload: OfferPayload = {
      offerId: offer.id,
      applicationId: offer.applicationId,
      number: offer.number,
      positionName: offer.positionName,
      candidateName: candidate?.fullName ?? "",
      startDate: offer.startDate as IsoDate,
    };
    const { request } = await submitRequest(tx, offerRequestType, {
      entityId: offer.entityId,
      requesterPersonId: actorPersonId,
      /**
       * **No subject person, on purpose.** An offer is about a candidate, who is not on the books,
       * and `resolveFlow` ignores `target` whenever a subject is given: naming the filer as the
       * subject would resolve the `department_head` step against *HR's* department rather than the
       * one that is hiring, find nobody, and fall back to the owner. (Which is exactly what it did
       * the first time this ran — found by making an offer, not by testing one.) With no subject,
       * `target` below is what the `role` and `permission` rules see.
       */
      subjectPersonId: null,
      subjectType: "job_offer",
      subjectId: offer.id,
      // Read in an inbox, an email and a chat card. A name, a job and a date. Never a figure.
      summary: `${payload.candidateName} — ${offer.positionName}`,
      payload: payload as unknown as Record<string, unknown>,
      conditionData: { employmentType: offer.employmentType },
      link: (requestId) => `/recruit/offers/${offer.id}?request=${requestId}`,
      target: { entityId: offer.entityId, departmentId: offer.departmentId, teamId: offer.teamId },
    });

    const [after] = await tx.update(schema.jobOffer).set({ status, approvalRequestId: request.id, updatedAt: now() }).where(eq(schema.jobOffer.id, offerId)).returning();
    return { offer: after, requestId: request.id };
  });
}

/** One approver's answer. Approval authorises the offer; it does not send it — a person does that. */
export async function decideOfferRequest(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, offerRequestType, requestId, actorPersonId, decision);
    const offerId = (request.payload as unknown as OfferPayload).offerId;
    let offer: OfferRow | undefined;

    if (outcome === "approved" || outcome === "rejected") {
      const status: OfferStatus = outcome === "approved" ? "approved" : "rejected";
      [offer] = await tx
        .update(schema.jobOffer)
        .set({ status, decidedByPersonId: actorPersonId, updatedAt: now() })
        .where(and(eq(schema.jobOffer.id, offerId), eq(schema.jobOffer.status, "pending_approval")))
        .returning();
    }

    if (offer && outcome === "approved") {
      const maker = offer.createdByPersonId;
      await notify(
        {
          recipients: maker === actorPersonId ? [] : [maker],
          kind: "recruit.offer_approved",
          params: { number: offer.number, title: offer.positionName },
          link: `/recruit/offers/${offer.id}`,
        },
        tx,
      );
    }
    return { request, before, outcome, offerId, offer };
  });
}

/** The offer goes out. What actually leaves the building is a letter and an email, not this row. */
export async function sendOffer(offerId: string, actorPersonId: string): Promise<OfferRow> {
  return db().transaction(async (tx) => {
    const offer = await findOffer(offerId, tx);
    if (!offer) throw new ActionError("offer_not_found");
    const status = nextStatus(offer.status, "send");
    if (!status) throw new ActionError("offer_not_sendable");
    if (offer.expiresOn < todayInVietnam()) throw new ActionError("offer_expired");

    const [after] = await tx.update(schema.jobOffer).set({ status, sentAt: now(), updatedAt: now() }).where(eq(schema.jobOffer.id, offerId)).returning();
    await recordApplicationEvent(tx, { applicationId: offer.applicationId, type: "emailed", actorPersonId, detail: { offer: offer.number, sent: true } });
    return after;
  });
}

/**
 * What the candidate said, written down by the recruiter who heard it.
 *
 * **The candidate does not answer over the public surface.** They could — week 2 built the
 * machinery for a signed expiring link, and it would work. It is not built because an offer is
 * the one conversation in hiring that is a conversation: somebody rings, asks about the start
 * date, negotiates, and *then* says yes. A button on a web page would record a decision the
 * company would rather have heard, and a link to a salary sitting in a mailbox is a hazard nobody
 * asked for. The decision is recorded here, by a named person, with the instant it happened.
 */
export async function recordOfferResponse(
  offerId: string,
  response: { answer: "accept" | "decline"; reason: OfferDeclineReason | null; note: string | null },
  actorPersonId: string,
  today: IsoDate = todayInVietnam(),
): Promise<{ before: OfferRow; after: OfferRow }> {
  return db().transaction(async (tx) => {
    const before = await findOffer(offerId, tx);
    if (!before) throw new ActionError("offer_not_found");
    // An offer that has lapsed is not answerable: re-offer, or extend it first.
    if (effectiveOfferStatus({ status: before.status, expiresOn: before.expiresOn as IsoDate }, today) === "expired") throw new ActionError("offer_expired");
    const status = nextStatus(before.status, response.answer === "accept" ? "accept" : "decline");
    if (!status) throw new ActionError("offer_not_answerable");

    const [after] = await tx
      .update(schema.jobOffer)
      .set({
        status,
        respondedAt: now(),
        decidedByPersonId: actorPersonId,
        declineReason: response.answer === "decline" ? response.reason : null,
        declineNote: response.answer === "decline" ? response.note : null,
        updatedAt: now(),
      })
      .where(eq(schema.jobOffer.id, offerId))
      .returning();

    if (response.answer === "decline") {
      // The application ends where it stands, so the funnel can say people fall out at the offer.
      await tx
        .update(schema.jobApplication)
        .set({ status: "rejected", rejectionReason: "salary", rejectionNote: response.note, closedAt: now(), decidedByPersonId: actorPersonId, updatedAt: now() })
        .where(and(eq(schema.jobApplication.id, before.applicationId), eq(schema.jobApplication.status, "active")));
    }

    await recordApplicationEvent(tx, {
      applicationId: before.applicationId,
      type: response.answer === "accept" ? "offer_accepted" : "offer_declined",
      actorPersonId,
      note: response.note,
      detail: { number: before.number, ...(response.answer === "decline" && response.reason ? { reason: response.reason } : {}) },
    });

    if (response.answer === "accept") {
      // Whoever may put somebody on the books in that entity: there is now a person to create
      // before they turn up. The card carries a name and a date, as every card in this module does.
      const target = { entityId: before.entityId, departmentId: before.departmentId, teamId: before.teamId };
      const hrPeople = await listPeopleHolding("person:manage", target, { includeWildcard: false, executor: tx });
      const candidate = await findCandidate(before.candidateId, tx);
      await notify(
        {
          recipients: hrPeople.filter((id) => id !== actorPersonId),
          kind: "recruit.offer_accepted",
          params: { name: candidate?.fullName ?? before.number, date: before.startDate as string },
          link: `/recruit/offers/${before.id}`,
        },
        tx,
      );
    }
    return { before, after };
  });
}

/** Taking the offer off the table, at any point before the candidate has answered. */
export async function withdrawOffer(offerId: string, actorPersonId: string, note: string | null): Promise<{ before: OfferRow; after: OfferRow }> {
  return db().transaction(async (tx) => {
    const before = await findOffer(offerId, tx);
    if (!before) throw new ActionError("offer_not_found");
    const status = nextStatus(before.status, "withdraw");
    if (!status) throw new ActionError("offer_not_withdrawable");
    const [after] = await tx.update(schema.jobOffer).set({ status, decidedByPersonId: actorPersonId, note, updatedAt: now() }).where(eq(schema.jobOffer.id, offerId)).returning();
    return { before, after };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export async function findOffer(offerId: string, executor: Executor = db()): Promise<OfferRow | undefined> {
  const [row] = await executor.select().from(schema.jobOffer).where(eq(schema.jobOffer.id, offerId)).limit(1);
  return row;
}

/** The live offer on an application, if there is one. */
export async function findLiveOffer(applicationId: string, executor: Executor = db()): Promise<OfferRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.jobOffer)
    .where(and(eq(schema.jobOffer.applicationId, applicationId), inArray(schema.jobOffer.status, [...OFFER_LIVE])))
    .limit(1);
  return row;
}

export async function listOffersOfApplication(applicationId: string, executor: Executor = db()): Promise<OfferRow[]> {
  return executor.select().from(schema.jobOffer).where(eq(schema.jobOffer.applicationId, applicationId)).orderBy(desc(schema.jobOffer.createdAt));
}

/** The money, or null. One place, so no screen has to remember the rule. */
export type OfferMoney = { baseSalaryVnd: number; allowancesVnd: number; totalVnd: number; probationMonthlyVnd: number };

export type OfferView = {
  offer: OfferRow;
  /** What the calendar leaves the status at — `expired` even when nothing has been written. */
  status: OfferStatus;
  candidateName: string;
  candidateEmail: string | null;
  openingCode: string;
  openingTitle: string;
  entityName: string | null;
  departmentName: string | null;
  managerName: string | null;
  createdByName: string | null;
  /** Cut by tier before it leaves the service: null = "not yours to see", not "there is none". */
  money: OfferMoney | null;
  approval: RequestView | null;
  /** The person this application became, once it has. */
  hiredPersonId: string | null;
  canEdit: boolean;
  canSubmit: boolean;
  canSend: boolean;
  canWithdraw: boolean;
  canRespond: boolean;
  canConvert: boolean;
};

export async function getOfferView(viewer: { principal: Principal; personId: string | null }, offerId: string, today: IsoDate = todayInVietnam()): Promise<OfferView | null> {
  const offer = await findOffer(offerId);
  if (!offer) return null;
  const opening = await findOpening(offer.openingId);
  if (!opening) return null;
  const member = await isOpeningMember(opening.id, viewer.personId);
  const target = targetOf(opening);
  // The approval is read **first**: `getRequest` returns null unless the viewer is a party to it,
  // which is how somebody the flow asked — and who runs no recruitment at all — reaches the offer
  // they have been asked to approve.
  const approval = offer.approvalRequestId && viewer.personId ? await getRequest({ principal: viewer.principal, personId: viewer.personId }, offerRequestType, offer.approvalRequestId) : null;
  if (!canViewOffer(viewer.principal, target, member, !!approval)) return null;

  const candidate = await findCandidate(offer.candidateId);
  const application = await findApplication(offer.applicationId);

  const [entity] = await db().select({ shortName: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, offer.entityId)).limit(1);
  const [department] = offer.departmentId ? await db().select({ name: schema.department.name }).from(schema.department).where(eq(schema.department.id, offer.departmentId)).limit(1) : [undefined];
  const [manager] = offer.managerPersonId ? await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, offer.managerPersonId)).limit(1) : [undefined];
  const [maker] = await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, offer.createdByPersonId)).limit(1);

  const status = effectiveOfferStatus({ status: offer.status, expiresOn: offer.expiresOn as IsoDate }, today);
  const money = canReadOfferMoney(viewer.principal, target)
    ? { baseSalaryVnd: offer.baseSalaryVnd, allowancesVnd: offer.allowancesVnd, totalVnd: offerTotalVnd(offer), probationMonthlyVnd: probationMonthlyVnd(offer) }
    : null;

  return {
    offer,
    status,
    candidateName: candidate?.fullName ?? "",
    candidateEmail: candidate?.email ?? null,
    openingCode: opening.code,
    openingTitle: opening.title,
    entityName: entity?.shortName ?? null,
    departmentName: department?.name ?? null,
    managerName: manager?.fullName ?? null,
    createdByName: maker?.fullName ?? null,
    money,
    approval,
    hiredPersonId: application?.hiredPersonId ?? null,
    // Each button is "the move is open from here" and "this reader may make it" — the same two
    // questions the service asks again when the button is pressed.
    canEdit: mayMove(status, "edit") && canMakeOffer(viewer.principal, target),
    canSubmit: mayMove(status, "submit") && canMakeOffer(viewer.principal, target),
    canSend: mayMove(status, "send") && canMakeOffer(viewer.principal, target),
    canWithdraw: mayMove(status, "withdraw") && canMakeOffer(viewer.principal, target),
    canRespond: mayMove(status, "accept") && canRecordOfferResponse(viewer.principal, target, member),
    canConvert: status === "accepted" && !application?.hiredPersonId && canConvertToEmployee(viewer.principal, target),
  };
}

export type OfferListRow = { id: string; number: string; candidateName: string; positionName: string; openingCode: string; status: OfferStatus; startDate: IsoDate; expiresOn: IsoDate; entityName: string | null; hiredPersonId: string | null };

/** Every offer the reader may see, newest first. No figure: this is a list, and a list is glanced at. */
export async function listOffers(principal: Principal, personId: string | null, filters: { status?: OfferStatus } = {}, today: IsoDate = todayInVietnam()): Promise<OfferListRow[]> {
  const rows = await db()
    .select({
      id: schema.jobOffer.id,
      number: schema.jobOffer.number,
      candidateName: schema.candidate.fullName,
      positionName: schema.jobOffer.positionName,
      openingCode: schema.jobOpening.code,
      openingEntityId: schema.jobOpening.entityId,
      openingDepartmentId: schema.jobOpening.departmentId,
      openingTeamId: schema.jobOpening.teamId,
      openingId: schema.jobOpening.id,
      status: schema.jobOffer.status,
      startDate: schema.jobOffer.startDate,
      expiresOn: schema.jobOffer.expiresOn,
      entityName: schema.entity.shortName,
      hiredPersonId: schema.jobApplication.hiredPersonId,
    })
    .from(schema.jobOffer)
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.jobOffer.candidateId))
    .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.jobOffer.openingId))
    .innerJoin(schema.jobApplication, eq(schema.jobApplication.id, schema.jobOffer.applicationId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.jobOffer.entityId))
    .orderBy(desc(schema.jobOffer.createdAt));

  const memberOf = personId
    ? new Set(
        (await db().select({ openingId: schema.jobOpeningMember.openingId }).from(schema.jobOpeningMember).where(eq(schema.jobOpeningMember.personId, personId))).map((row) => row.openingId),
      )
    : new Set<string>();

  return rows
    .filter((row) => canViewOffer(principal, { entityId: row.openingEntityId, departmentId: row.openingDepartmentId, teamId: row.openingTeamId }, memberOf.has(row.openingId)))
    .map((row) => ({
      id: row.id,
      number: row.number,
      candidateName: row.candidateName,
      positionName: row.positionName,
      openingCode: row.openingCode,
      status: effectiveOfferStatus({ status: row.status, expiresOn: row.expiresOn as IsoDate }, today),
      startDate: row.startDate as IsoDate,
      expiresOn: row.expiresOn as IsoDate,
      entityName: row.entityName,
      hiredPersonId: row.hiredPersonId,
    }))
    .filter((row) => !filters.status || row.status === filters.status);
}

// ── The offer letter (FR-REC-08) ────────────────────────────────────────────────────────────

/**
 * The facts the letter may print, gathered by tier exactly as `documents/service.ts` does it: at
 * `personal` no figure is even looked at, and the `salary.*` holes are filled only when the
 * template is a compensation-tier one. A fact that is never read cannot leak through the renderer.
 *
 * The placeholder keys are the **documents module's own catalogue** — `person.fullName`,
 * `employment.startDate`, `salary.total` — so an offer wording is designed, tiered and refused on
 * the same terms as a contract, and HR learns one set of fields rather than two.
 */
function offerLetterContext(input: { offer: OfferRow; candidateName: string; departmentName: string | null; letterhead: LetterheadFields; tier: Tier; number: string; today: IsoDate }): Record<string, string> {
  const { offer, letterhead } = input;
  const context: Record<string, string> = {
    "company.name": letterhead.companyName ?? "",
    "company.address": letterhead.address ?? "",
    "company.taxCode": letterhead.taxCode ?? "",
    "company.phone": letterhead.phone ?? "",
    "company.representative": letterhead.representative ?? "",
    "company.representativeTitle": letterhead.representativeTitle ?? "",
    "document.number": input.number,
    "document.date": formatDay(input.today),
    "document.place": letterhead.place ?? "",
  };

  if (atLeast(input.tier, "personal")) {
    Object.assign(context, {
      "person.fullName": input.candidateName,
      "person.position": offer.positionName,
      "person.department": input.departmentName ?? "",
      "employment.startDate": formatDay(offer.startDate as IsoDate),
      "employment.type": offer.employmentType,
      "offer.expiryDate": formatDay(offer.expiresOn as IsoDate),
      "offer.probationMonths": String(offer.probationMonths),
    });
  }

  if (atLeast(input.tier, "compensation")) {
    const total = offerTotalVnd(offer);
    Object.assign(context, {
      "salary.base": formatVnd(offer.baseSalaryVnd),
      "salary.allowances": formatVnd(offer.allowancesVnd),
      "salary.total": formatVnd(total),
      "salary.totalInWords": vietnameseWords(total),
      "offer.probationSalary": formatVnd(probationMonthlyVnd(offer)),
    });
  }
  return context;
}

const formatDay = (date: IsoDate | null): string => (date ? date.split("-").reverse().join("/") : "");
const formatVnd = (amount: number): string => new Intl.NumberFormat("vi-VN").format(amount);

export type RenderedOffer = { offer: OfferRow; number: string; title: string; text: string; missing: string[]; letterhead: LetterheadFields; candidateName: string };

/**
 * Re-renders the letter from its template, now, for this reader. Refuses exactly the way the
 * documents module refuses: null for a template that is not there, a reader who may not see the
 * tier, or an offer that does not exist — one answer, so a 404 says nothing about which it was.
 */
export async function offerLetter(viewer: { principal: Principal; personId: string | null }, offerId: string, today: IsoDate = todayInVietnam()): Promise<RenderedOffer | null> {
  const offer = await findOffer(offerId);
  if (!offer?.letterTemplateId) return null;
  const opening = await findOpening(offer.openingId);
  if (!opening) return null;
  const member = await isOpeningMember(opening.id, viewer.personId);
  const target = targetOf(opening);
  const party = offer.approvalRequestId && viewer.personId ? !!(await getRequest({ principal: viewer.principal, personId: viewer.personId }, offerRequestType, offer.approvalRequestId)) : false;
  if (!canViewOffer(viewer.principal, target, member, party)) return null;

  const [template] = await db().select().from(schema.documentTemplate).where(and(eq(schema.documentTemplate.id, offer.letterTemplateId), eq(schema.documentTemplate.isActive, true))).limit(1);
  if (!template) return null;
  // An offer letter prints a salary, so its template is compensation tier and the reader must hold
  // the money authority. Checked here, again, against who is asking *now*.
  if (atLeast(template.tier, "compensation") && !canReadOfferMoney(viewer.principal, target)) return null;

  const candidate = await findCandidate(offer.candidateId);
  const [department] = offer.departmentId ? await db().select({ name: schema.department.name }).from(schema.department).where(eq(schema.department.id, offer.departmentId)).limit(1) : [undefined];

  const context = offerLetterContext({
    offer,
    candidateName: candidate?.fullName ?? "",
    departmentName: department?.name ?? null,
    letterhead: template.letterhead ?? {},
    tier: template.tier,
    number: offer.number,
    today,
  });
  const { text, missing } = renderTemplate(template.body, context);
  return { offer, number: offer.number, title: template.name, text, missing, letterhead: template.letterhead ?? {}, candidateName: candidate?.fullName ?? "" };
}

/** The wordings a recruiter may pick from when drafting an offer. Names and ids only. */
export async function listOfferTemplates(executor: Executor = db()): Promise<{ id: string; name: string; entityId: string | null }[]> {
  return executor
    .select({ id: schema.documentTemplate.id, name: schema.documentTemplate.name, entityId: schema.documentTemplate.entityId })
    .from(schema.documentTemplate)
    .where(and(eq(schema.documentTemplate.kind, "offer"), eq(schema.documentTemplate.isActive, true)))
    .orderBy(asc(schema.documentTemplate.name));
}

// ── Becoming an employee (FR-REC-09) ────────────────────────────────────────────────────────

export type ConversionResult = { personId: string; employeeCode: string | null; salaryRequestId: string | null; salaryProblem: string | null };

/**
 * The accepted candidate becomes a **pre-boarding** person (FR-REC-09).
 *
 * Everything the candidate typed on the careers page and everything the offer promised is carried
 * across; nobody retypes a name, a phone number, a start date or a job title. Two deliberate
 * hand-offs:
 *
 *   · **`hireInTransaction`** is Phase 1's one code path onto the books. It sets the person to
 *     `preboarding` when the start date is in the future and opens the onboarding checklist; the
 *     daily roll-over makes them active on the morning they arrive. Nothing here writes to a
 *     core-HR table.
 *   · **`submitSalaryChange`** proposes the agreed figure as the person's initial salary, for the
 *     owner to decide (SRS D17). Recruitment does not get a second way to set a salary. If the
 *     proposal fails — no pay-component catalogue for that entity yet, an entity payroll has never
 *     been set up for — the person is still created and the reason is handed back for the screen
 *     to say out loud, because a hire that half-succeeded silently is worse than one that says so.
 *
 * Converting twice is impossible: the update below matches only an application whose
 * `hired_person_id` is still null, and a partial unique index on that column refuses a second
 * person even if somebody reaches past this function.
 */
export async function convertToEmployee(offerId: string, actorPersonId: string, options: { employeeCode?: string | null } = {}): Promise<ConversionResult> {
  const conversion = await db().transaction(async (tx) => {
    const offer = await findOffer(offerId, tx);
    if (!offer) throw new ActionError("offer_not_found");
    if (offer.status !== "accepted") throw new ActionError("offer_not_accepted");

    const application = await findApplication(offer.applicationId, tx);
    if (!application) throw new ActionError("recruit_application_not_found");
    if (application.hiredPersonId) throw new ActionError("recruit_already_converted");

    const candidate = await findCandidate(offer.candidateId, tx);
    if (!candidate) throw new ActionError("recruit_candidate_not_found");
    if (candidate.anonymisedAt) throw new ActionError("recruit_candidate_anonymised");

    const { person, employment } = await hireInTransaction(
      tx,
      {
        fullName: candidate.fullName,
        // A work address is issued during onboarding, not guessed from a personal one.
        workEmail: null,
        profile: {
          dateOfBirth: null,
          gender: null,
          maritalStatus: null,
          nationality: null,
          phone: candidate.phone,
          personalEmail: candidate.email,
          permanentAddress: null,
          currentAddress: candidate.location,
        },
        entityId: offer.entityId,
        employeeCode: options.employeeCode ?? null,
        startDate: offer.startDate as IsoDate,
        seniorityDate: null,
        placement: {
          workforceType: offer.employmentType,
          branchId: null,
          departmentId: offer.departmentId,
          teamId: offer.teamId,
          positionName: offer.positionName,
          jobLevel: offer.jobLevel,
          managerId: offer.managerPersonId,
          dottedManagerId: null,
          workLocation: offer.workLocation,
        },
      },
      actorPersonId,
    );

    // Conditional on purpose: the second conversion finds no row and is refused.
    const [claimed] = await tx
      .update(schema.jobApplication)
      .set({ hiredPersonId: person.id, status: "hired", closedAt: now(), decidedByPersonId: actorPersonId, updatedAt: now() })
      .where(and(eq(schema.jobApplication.id, application.id), sql`${schema.jobApplication.hiredPersonId} is null`))
      .returning();
    if (!claimed) throw new ActionError("recruit_already_converted");

    await recordApplicationEvent(tx, { applicationId: application.id, type: "converted", actorPersonId, detail: { number: offer.number, startDate: offer.startDate } });
    await recordApplicationEvent(tx, { applicationId: application.id, type: "hired", actorPersonId, fromStageId: application.stageId });

    return { personId: person.id, employeeCode: employment.employeeCode, offer, candidateName: candidate.fullName };
  });

  // Outside the hire's transaction on purpose: the person exists whatever payroll makes of the
  // figure, and `submitSalaryChange` opens its own.
  let salaryRequestId: string | null = null;
  let salaryProblem: string | null = null;
  try {
    const { request } = await submitSalaryChange(actorPersonId, {
      personId: conversion.personId,
      validFrom: conversion.offer.startDate as IsoDate,
      reason: "initial",
      // The base salary is the agreed base. The offer's allowance total is **not** split into pay
      // components here: this module does not know the entity's catalogue, and inventing a code
      // would put a figure under a heading nobody chose. It is named in the note for C&B to itemise.
      terms: { baseSalary: conversion.offer.baseSalaryVnd, insuranceSalary: conversion.offer.baseSalaryVnd, allowances: [] },
      note: conversion.offer.allowancesVnd > 0 ? `${conversion.offer.number} — phụ cấp theo thư mời: ${formatVnd(conversion.offer.allowancesVnd)} đ/tháng` : conversion.offer.number,
    });
    salaryRequestId = request.id;
  } catch (error) {
    salaryProblem = error instanceof ActionError ? error.message : "salary_proposal_failed";
  }

  return { personId: conversion.personId, employeeCode: conversion.employeeCode, salaryRequestId, salaryProblem };
}

/** Position names the offer form offers, borrowed from core-HR so the two agree. */
export const offerPositionNames = listPositionNames;
