// Who may see and do what in recruitment. Pure.
//
// Recruitment holds the most sensitive data in the product that is not about an employee: people
// outside the company who have told us they want to leave their current job. So the shape here is
// narrower than anywhere else, and it has two sources of authority rather than one:
//
//   · **`recruit:manage` over the opening's entity** — HR and recruiters. This is the authority
//     that creates openings, moves candidates and browses the candidate database.
//   · **membership of the opening's hiring team** (`job_opening_member`) — this, and not a role,
//     is how a department head sees *the opening they are hiring for* and no other. It is
//     deliberately per-opening: a hiring manager gets the candidates for their job, never a
//     directory of everybody who has ever applied to the group.
//
// Nobody else has any access at all. Not finance, not the auditors, not a colleague, not a
// department head who is not on the team. Deny by default (CLAUDE.md), and the tests say so
// one role at a time.
//
// **Money** is narrower still. A hiring request's budget, an opening's salary band and a
// candidate's salary expectation are compensation-tier facts, and reading them takes a grant
// covering the opening whose role may read compensation — `hr_admin`, the owner. A plain
// `recruiter` (maxTier `public_internal`) runs the entire pipeline and is never shown a figure,
// and a hiring manager on the team is not either: line managers never see compensation (SRS §2.2).
import { can, type Principal, scopeCovers, type Target } from "../platform/rbac/policy";
import { type Permission, ROLE_DEFINITIONS, type Tier, tierRank } from "../platform/rbac/roles";

/** Where an opening sits, as far as the rules care. */
export type OpeningTarget = { entityId: string; departmentId?: string | null; teamId?: string | null };

/** Whether the asker is on this opening's hiring team. Resolved by the service; the rules only read it. */
export type Membership = boolean;

const over = (target: OpeningTarget | undefined): Target | undefined => (target ? { entityId: target.entityId, departmentId: target.departmentId ?? null, teamId: target.teamId ?? null } : undefined);

/**
 * The highest tier of data a principal's *recruitment* grants admit over this opening. Not
 * `readableTier`: that one is about a person's own record and leans on `person:read` and the line
 * management chain, neither of which says anything about a stranger's CV.
 */
function recruitTier(principal: Principal, target: OpeningTarget | undefined): Tier | null {
  let best: Tier | null = null;
  for (const grant of principal.grants) {
    const definition = ROLE_DEFINITIONS[grant.role];
    const permissions: readonly Permission[] = definition.permissions;
    if (!permissions.includes("*") && !permissions.includes("recruit:manage")) continue;
    if (target && !scopeCovers(grant.scope, over(target)!)) continue;
    if (best === null || tierRank(definition.maxTier) > tierRank(best)) best = definition.maxTier;
  }
  return best;
}

// ── Running recruitment ─────────────────────────────────────────────────────────────────────

/**
 * The recruiter's authority over an opening: create it, edit it, publish it, move candidates,
 * reject them. Without a target the question is "anywhere at all" — navigation only, never data.
 */
export const canRunRecruitment = (principal: Principal, opening?: OpeningTarget): boolean => can(principal, "recruit:manage", over(opening));

/** The pipeline library belongs to the group: editing it takes a group-wide grant. */
export const canManagePipelines = (principal: Principal): boolean => can(principal, "recruit:manage", {});

/**
 * One opening's page: whoever runs recruitment where it sits, and whoever is on its hiring team.
 * A hiring team member reads the opening and its candidates; they do not get the rest of the
 * module, which is what `canBrowseCandidates` below is for.
 */
export const canViewOpening = (principal: Principal, opening: OpeningTarget, member: Membership): boolean => canRunRecruitment(principal, opening) || (member && !!principal.personId);

/**
 * Editing the advertisement, the hiring team and the status. Kept to `recruit:manage`: a hiring
 * manager says what they want in a hiring request, and a recruiter writes the posting.
 */
export const canEditOpening = (principal: Principal, opening: OpeningTarget): boolean => canRunRecruitment(principal, opening);

/** Moving an application along, rejecting it, noting on it: the recruiter, and the hiring team. */
export const canActOnApplication = (principal: Principal, opening: OpeningTarget, member: Membership): boolean => canViewOpening(principal, opening, member);

/**
 * **The candidate database itself** — everyone who has ever applied, across openings, including
 * the talent pool. This is `recruit:manage` and nothing else: a hiring manager's access is to the
 * people applying for their job, which they reach through the opening.
 */
export const canBrowseCandidates = (principal: Principal): boolean => can(principal, "recruit:manage");

/** Creating and editing a candidate record by hand (a CV somebody forwarded). */
export const canManageCandidates = (principal: Principal): boolean => canBrowseCandidates(principal);

// ── Money ───────────────────────────────────────────────────────────────────────────────────

/**
 * The budget on a hiring request, the salary band on an opening, the expectation on an
 * application. A grant covering the opening whose role may read compensation — in the catalogue as
 * it stands, `owner` and `hr_admin`. Every other way into this module stops at the figure.
 */
export const canReadRecruitMoney = (principal: Principal, opening?: OpeningTarget): boolean => recruitTier(principal, opening) === "compensation";

/** Setting a band or a budget is the same authority as reading one: you cannot type what you may not see. */
export const canSetRecruitMoney = canReadRecruitMoney;

// ── Hiring requests (FR-REC-01) ─────────────────────────────────────────────────────────────

/**
 * Asking for a head is not a privilege: a manager who needs somebody says so, and the approval
 * flow — their line manager, then whoever holds `recruit:manage` — is what decides. Requiring a
 * role here would mean a team lead has to ask HR to ask on their behalf, which is how hiring
 * requests end up in chat instead of in the system.
 */
export const canFileHiringRequest = (principal: Principal): boolean => !!principal.personId;

/**
 * Reading one: its author, its hiring manager, and whoever runs recruitment where it sits. The
 * approvers of the request reach it through the approval engine, which grants a party to the
 * request its own access — this rule is for everybody else.
 */
export const canViewHiringRequest = (principal: Principal, request: OpeningTarget & { requestedByPersonId: string; hiringManagerPersonId: string | null }): boolean =>
  canRunRecruitment(principal, request) ||
  (!!principal.personId && (principal.personId === request.requestedByPersonId || principal.personId === request.hiringManagerPersonId));

/** Turning an approved ask into an opening: the recruiter's job, over the entity that asked. */
export const canOpenFromHiringRequest = (principal: Principal, request: OpeningTarget): boolean => canRunRecruitment(principal, request);

// ── Interviews (FR-REC-06) ──────────────────────────────────────────────────────────────────

/**
 * Whether the asker is in the room for *this* interview. Resolved by the service from
 * `interview_interviewer`; the rules only read it.
 */
export type Interviewing = boolean;

/** Booking, moving and cancelling an interview: the recruiter and the hiring team, as with any other move. */
export const canScheduleInterview = (principal: Principal, opening: OpeningTarget, member: Membership): boolean => canActOnApplication(principal, opening, member);

/**
 * Opening one interview. Two ways in, and the second is the interesting one:
 *
 *   · whoever runs the opening — recruiter, hiring team;
 *   · **whoever is interviewing**, who may be neither. A colleague pulled in for one technical
 *     round needs the candidate's name, their CV and the kit, and gets exactly that: this rule
 *     admits them to *the interview*, and nothing anywhere admits them to the opening's other
 *     candidates or to the candidate database. That is why being an interviewer is not a
 *     `job_opening_member` row — see the note on the table.
 */
export const canViewInterview = (principal: Principal, opening: OpeningTarget, member: Membership, interviewing: Interviewing): boolean =>
  canViewOpening(principal, opening, member) || (interviewing && !!principal.personId);

/**
 * Writing a scorecard: only somebody who was in the room. A recruiter cannot score an interview
 * they did not sit in, however senior — a scorecard is testimony, not an opinion.
 */
export const canScoreInterview = (principal: Principal, interviewing: Interviewing): boolean => interviewing && !!principal.personId;

// ── Take-home assignments (FR-REC-07) ───────────────────────────────────────────────────────

/** Sending a brief and rating what comes back: the same people who move the application along. */
export const canRunAssignment = (principal: Principal, opening: OpeningTarget, member: Membership): boolean => canActOnApplication(principal, opening, member);

// ── Offers (FR-REC-08) and becoming an employee (FR-REC-09) ─────────────────────────────────

/**
 * Making an offer means typing a salary, so it is the money authority and nothing less —
 * `owner` and `hr_admin` in the catalogue as it stands. A recruiter runs the pipeline right up to
 * this point and then hands over, which is how it works in the room as well.
 */
export const canMakeOffer = (principal: Principal, opening: OpeningTarget): boolean => canSetRecruitMoney(principal, opening);

/**
 * Seeing that an offer *exists* — its status, its start date, whether the candidate has answered.
 * Deliberately wider than the figure: a recruiter has to know the candidate said yes in order to
 * do anything about it, and `canReadOfferMoney` still decides whether they are shown a đồng.
 *
 * `party` is "the approval engine has already decided this person is a party to the request", and
 * it is not optional politeness: without it the flow asks somebody to approve an offer they cannot
 * open. (Which is exactly what happened the first time an offer went out for approval — the CEO's
 * inbox had the request and the offer's page answered 404.)
 */
export const canViewOffer = (principal: Principal, opening: OpeningTarget, member: Membership, party = false): boolean => canViewOpening(principal, opening, member) || (party && !!principal.personId);

/**
 * The offer's figure. Two authorities, because two different people need it:
 *
 *   · a **compensation-tier recruitment grant** over the opening — the person who typed it;
 *   · **`payroll:approve`** over the entity — the person the flow asks to approve the money. The
 *     second step of the flow is a `permission: payroll:approve` rule, so this is not a widening:
 *     it is the same authority, read on the page instead of in an inbox.
 *
 * Everybody else stops at the figure, including the department head who approved the *person*.
 */
export const canReadOfferMoney = (principal: Principal, opening: OpeningTarget): boolean => canReadRecruitMoney(principal, opening) || can(principal, "payroll:approve", over(opening));

/**
 * Writing down what the candidate said. The recruiter takes the phone call, so this is the
 * pipeline authority rather than the money authority — recording an acceptance does not require,
 * and does not grant, sight of the amount that was accepted.
 */
export const canRecordOfferResponse = (principal: Principal, opening: OpeningTarget, member: Membership): boolean => canActOnApplication(principal, opening, member);

/**
 * Turning an accepted candidate into a person on the books (FR-REC-09). This writes to the
 * **employee register**, so recruitment authority alone is not enough: it takes `person:manage`
 * over the entity the person will belong to, the same permission the hire form asks for. A
 * recruiter who may run every opening in the group still cannot create an employee.
 */
export const canConvertToEmployee = (principal: Principal, opening: OpeningTarget): boolean => canRunRecruitment(principal, opening) && can(principal, "person:manage", over(opening));

// ── Referrals (FR-REC-10) ───────────────────────────────────────────────────────────────────

/**
 * Putting a name forward is **everybody's**, like filing a request: the referral programme exists
 * precisely so that people who are not recruiters bring candidates in. What it does *not* grant is
 * any sight of the candidate database — `referrals.ts` answers a referrer identically whether the
 * person is already on file or not, so the form cannot be used as a lookup.
 */
export const canRefer = (principal: Principal): boolean => !!principal.personId;

/** Reading the whole referral book, and settling a bonus on it: the recruitment desk's. */
export const canManageReferrals = (principal: Principal): boolean => canRunRecruitment(principal);

// ── Reports (FR-REC-11) ─────────────────────────────────────────────────────────────────────

/**
 * The funnel, time-to-hire and source effectiveness. `report:read` is what admits somebody to the
 * page at all; **which** openings the numbers are counted over is not decided here but in the
 * query, by the same `openingScope` every other list goes through. A department head with
 * `report:read` sees the funnel of the opening they are hiring for and an empty report otherwise —
 * there is no figure on this page that its reader could not already reach one opening at a time.
 */
export const canReadRecruitReports = (principal: Principal): boolean => can(principal, "report:read");

// ── Candidate files ─────────────────────────────────────────────────────────────────────────

/**
 * A CV uploaded through the public careers page, or a take-home submission. **Uploads are marked
 * `not_scanned`** — there is no virus scanner in this system yet — so the file is kept to the
 * people who are hiring for that opening and reaches nobody else in the company, and the download
 * path says so out loud.
 *
 * An interviewer on one of this application's interviews is included: reading the CV before the
 * conversation is the conversation. It admits them to that candidate's file, never to the opening.
 */
export const canOpenCandidateFile = (principal: Principal, opening: OpeningTarget, member: Membership, interviewing: Interviewing = false): boolean =>
  canViewInterview(principal, opening, member, interviewing);
