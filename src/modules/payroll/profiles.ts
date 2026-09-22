// Pay profiles (SRS D18, FR-PAY-07, FR-PAY-08): Statutory or Simple per employment, effective-dated.
// A first Statutory profile takes effect at once; being put on the Simple profile, and every
// move between profiles, is proposed by C&B and takes effect only when the owner approves — then
// it is an event on the person's timeline.
import "server-only";
import { and, desc, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts, listPayrollFacts, recordPayEvent } from "@/modules/core-hr/service";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval } from "@/modules/platform/statutory/engine/versions";
import { getParameter } from "@/modules/platform/statutory/service";
import type { SimpleBasis } from "./enums";
import { type ExposureFlag, exposureFlags, monthsOn } from "./engine/exposure";
import { type EntityReach, withinReach } from "./reach";

type Executor = Tx | ReturnType<typeof db>;
export type PayProfileRow = typeof schema.payProfile.$inferSelect;

export type ProfileInput = Pick<PayProfileRow, "profile" | "simpleBasis" | "reviewDate" | "taxResidency" | "pitMethod" | "pitCommitment" | "insuranceExemption" | "unionMember" | "note"> & { personId: string; validFrom: IsoDate };

/** The approved profile of each person on `date`. No authorization inside: for payroll's own use-cases. */
export async function getProfilesOn(personIds: readonly string[], date: IsoDate, executor: Executor = db()): Promise<Map<string, PayProfileRow>> {
  if (personIds.length === 0) return new Map();
  const table = schema.payProfile;
  const rows = await executor.select().from(table).where(and(inArray(table.personId, [...personIds]), eq(table.status, "approved"), lte(table.validFrom, date), or(isNull(table.validTo), gte(table.validTo, date))));
  return new Map(rows.map((row) => [row.personId, row]));
}

/** Every approved profile overlapping a period, per person — a run needs them when someone moved mid-month. */
export async function listProfilesBetween(entityId: string, from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<PayProfileRow[]> {
  const table = schema.payProfile;
  return executor.select().from(table).where(and(eq(table.entityId, entityId), eq(table.status, "approved"), lte(table.validFrom, to), or(isNull(table.validTo), gte(table.validTo, from)))).orderBy(table.personId, table.validFrom);
}

/** One person's profile versions, newest first. The caller has checked `canViewCompensationOf` / `canManageCompensation`. */
export async function listProfileHistory(personId: string, executor: Executor = db()): Promise<PayProfileRow[]> {
  return executor.select().from(schema.payProfile).where(eq(schema.payProfile.personId, personId)).orderBy(desc(schema.payProfile.validFrom), desc(schema.payProfile.createdAt));
}

export type ProfileProposal = PayProfileRow & { personName: string; proposedByName: string | null; currentProfile: PayProfileRow["profile"] | null };

/** Proposals waiting for the owner, within the entities the viewer reaches (filtered in SQL). */
export async function listProfileProposals(reach: EntityReach, executor: Executor = db()): Promise<ProfileProposal[]> {
  const table = schema.payProfile;
  const today = todayInVietnam();
  // One query: the proposal, whose it is, who proposed it and the profile in force today.
  const proposer = alias(schema.person, "proposer");
  const current = alias(schema.payProfile, "current");
  const inForce = executor
    .select({ profile: current.profile })
    .from(current)
    .where(and(eq(current.personId, table.personId), eq(current.status, "approved"), lte(current.validFrom, today), or(isNull(current.validTo), gte(current.validTo, today))))
    .limit(1)
    .as("in_force");
  const rows = await executor
    .select({ row: table, personName: schema.person.fullName, proposedByName: proposer.fullName, currentProfile: inForce.profile })
    .from(table)
    .innerJoin(schema.person, eq(schema.person.id, table.personId))
    .leftJoin(proposer, eq(proposer.id, table.proposedByPersonId))
    .leftJoinLateral(inForce, sql`true`)
    .where(and(eq(table.status, "proposed"), withinReach(table.entityId, reach)))
    .orderBy(table.createdAt);
  return rows.map(({ row, personName, proposedByName, currentProfile }) => ({ ...row, personName, proposedByName: proposedByName ?? null, currentProfile: currentProfile ?? null }));
}

function checkShape(input: ProfileInput) {
  if ((input.profile === "simple") !== (input.simpleBasis !== null)) throw new ActionError("profile_basis_required");
  if (input.profile === "statutory" && input.reviewDate) throw new ActionError("profile_review_date_simple_only");
  if (input.taxResidency === "non_resident" && input.profile === "statutory" && input.pitMethod !== "flat_non_resident") throw new ActionError("profile_non_resident_method");
  if (input.taxResidency === "resident" && input.pitMethod === "flat_non_resident") throw new ActionError("profile_non_resident_method");
}

/**
 * C&B sets or changes someone's profile. Returns the row and whether it is already in force
 * (`approved`: a first Statutory profile) or waits for the owner (`proposed`).
 */
export async function submitProfile(input: ProfileInput, actorPersonId: string): Promise<PayProfileRow> {
  checkShape(input);
  const [facts] = await listEmploymentFacts({ personIds: [input.personId] });
  if (!facts?.employmentId || !facts.entityId) throw new ActionError("person_without_employment");
  if (facts.startDate && input.validFrom < facts.startDate) throw new ActionError("profile_before_employment");

  return db().transaction(async (tx) => {
    const table = schema.payProfile;
    const existing = await tx.select().from(table).where(and(eq(table.employmentId, facts.employmentId!), inArray(table.status, ["approved", "proposed"]))).for("update");
    if (existing.some((row) => row.status === "proposed")) throw new ActionError("profile_proposal_open");
    const approved = existing.filter((row) => row.status === "approved");
    const plan = planApproval(approved, input.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`rule_${plan.reason}`);

    const first = approved.length === 0 && input.profile === "statutory";
    const { personId, ...values } = input;
    const [created] = await tx
      .insert(table)
      .values({ ...values, personId, employmentId: facts.employmentId!, entityId: facts.entityId!, proposedByPersonId: actorPersonId, status: first ? "approved" : "proposed", ...(first ? { decidedAt: new Date() } : {}) })
      .returning();
    if (!first) await notify({ recipients: await listOwnerPersonIds(tx), kind: "payroll.profile_proposed", params: { person: facts.fullName, validFrom: created.validFrom }, link: "/payroll/profiles" }, tx);
    return created;
  });
}

/** The owner's decision. Approving closes the profile in force the day before and writes the timeline event. */
export async function decideProfile(id: string, decision: "approve" | "reject", actorPersonId: string): Promise<{ before: PayProfileRow; after: PayProfileRow }> {
  return db().transaction(async (tx) => {
    const table = schema.payProfile;
    const [before] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!before || before.status !== "proposed") throw new ActionError("proposal_not_found");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() };
    if (decision === "reject") {
      const [after] = await tx.update(table).set({ status: "rejected", ...decided }).where(eq(table.id, id)).returning();
      return { before, after };
    }
    const approved = await tx.select().from(table).where(and(eq(table.employmentId, before.employmentId), eq(table.status, "approved"))).for("update");
    const plan = planApproval(approved, before.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`rule_${plan.reason}`);
    if (plan.kind === "succeed") await tx.update(table).set({ validTo: plan.closeOn, updatedAt: new Date() }).where(eq(table.id, plan.closeId));
    const [after] = await tx.update(table).set({ status: "approved", ...decided }).where(eq(table.id, id)).returning();
    // FR-PAY-07: a move between profiles is a lifecycle event. A first profile is not a move.
    if (approved.length > 0) await recordPayEvent(tx, { type: "pay_profile_change", personId: after.personId, employmentId: after.employmentId, entityId: after.entityId, effectiveDate: after.validFrom, reason: null, details: {} }, actorPersonId);
    return { before, after };
  });
}

export type ExposureRow = { personId: string; fullName: string; employeeCode: string | null; entityId: string; workforceType: string; basis: SimpleBasis; since: IsoDate; months: number; reviewDate: IsoDate | null; contractType: string | null; flags: ExposureFlag[] };

/**
 * FR-PAY-08 / risk R11 — everyone on the Simple profile today, by basis and time on it. Nobody is
 * left out: not the offboarding, not collaborators. The caller is the owner (`canSeeSimpleProfileReport`).
 */
export async function listSimpleProfileExposure(today: IsoDate = todayInVietnam(), executor: Executor = db()): Promise<ExposureRow[]> {
  const table = schema.payProfile;
  const current = await executor.select().from(table).where(and(eq(table.status, "approved"), eq(table.profile, "simple"), lte(table.validFrom, today), or(isNull(table.validTo), gte(table.validTo, today))));
  if (current.length === 0) return [];
  const personIds = current.map((row) => row.personId);
  const [history, facts, limits] = await Promise.all([
    executor.select().from(table).where(and(inArray(table.personId, personIds), eq(table.status, "approved"), eq(table.profile, "simple"))).orderBy(desc(table.validFrom)),
    listPayrollFacts({ personIds }, today.slice(0, 7), executor),
    getParameter("probation.limits", today, executor),
  ]);
  return current
    .map((row) => {
      // Walk back through adjoining Simple versions: a changed basis does not restart the clock.
      let since = row.validFrom;
      for (const earlier of history.filter((candidate) => candidate.employmentId === row.employmentId && candidate.validFrom < row.validFrom)) {
        if (earlier.validTo && earlier.validTo >= addDay(since, -1)) since = earlier.validFrom;
      }
      const fact = facts.find((candidate) => candidate.personId === row.personId);
      const contractType = fact?.contract?.type ?? null;
      return {
        personId: row.personId,
        fullName: fact?.fullName ?? "",
        employeeCode: fact?.employeeCode ?? null,
        entityId: row.entityId,
        workforceType: fact?.workforceType ?? "",
        basis: row.simpleBasis!,
        since,
        months: monthsOn(since, today),
        reviewDate: row.reviewDate,
        contractType,
        flags: exposureFlags({ basis: row.simpleBasis!, since, reviewDate: row.reviewDate, contractType, today, longestProbationDays: limits.managerDays }),
      };
    })
    .sort((a, b) => b.flags.length - a.flags.length || a.since.localeCompare(b.since));
}

const addDay = (date: IsoDate, days: number): IsoDate => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
