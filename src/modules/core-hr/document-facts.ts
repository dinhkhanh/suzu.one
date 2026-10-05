// What a generated document may say about a person (FR-CHR-06), as the record stood on the day the
// paper is dated: the placement in force then, the labour contract in force then, the profile's
// contact facts. Re-exported by service.ts for the documents module. Nothing here is above the
// personal tier — the restricted facts come from `getSensitiveFields`, which checks the reader —
// and the caller (the documents module) decides at which tier it may ask at all.
import "server-only";
import { and, desc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { findLifecycleEvent, type LifecycleEventRow, type PlacementWords } from "./lifecycle-events";

export type DocumentFacts = {
  fullName: string;
  workEmail: string | null;
  employeeCode: string | null;
  startDate: IsoDate | null;
  seniorityDate: IsoDate | null;
  endDate: IsoDate | null;
  status: string;
  /** On the day: the primary assignment then in force (else the latest one of the latest employment). */
  workforceType: string | null;
  positionName: string | null;
  departmentName: string | null;
  teamName: string | null;
  managerName: string | null;
  branchName: string | null;
  workLocation: string | null;
  seniorityLevel: string | null;
  positionLevel: string | null;
  profile: { gender: string | null; dateOfBirth: IsoDate | null; phone: string | null; nationality: string | null; permanentAddress: string | null; currentAddress: string | null } | null;
  /** The labour contract in force on the day (appendices aside), else the latest one. */
  contract: { number: string; type: string; signDate: IsoDate | null; startDate: IsoDate; endDate: IsoDate | null } | null;
};

/** null = no such person. Four reads, side by side once the employment is known. */
export async function documentFactsOf(personId: string, on: IsoDate): Promise<DocumentFacts | null> {
  const [head] = await db()
    .select({ person: schema.person, employment: schema.employment })
    .from(schema.person)
    .leftJoin(schema.employment, eq(schema.employment.personId, schema.person.id))
    .where(eq(schema.person.id, personId))
    .orderBy(desc(schema.employment.startDate))
    .limit(1);
  if (!head) return null;
  const employmentId = head.employment?.id ?? null;

  const team = alias(schema.orgUnit, "doc_team");
  const manager = alias(schema.person, "doc_manager");
  const inForce = (from: typeof schema.assignment.validFrom, to: typeof schema.assignment.validTo) => and(lte(from, on), or(isNull(to), gte(to, on)));
  const [[placement], [contract], [profile]] = await Promise.all([
    employmentId
      ? db()
          .select({
            workforceType: schema.assignment.workforceType,
            positionName: schema.position.name,
            departmentName: schema.orgUnit.name,
            teamName: team.name,
            managerName: manager.fullName,
            branchName: schema.branch.name,
            workLocation: schema.assignment.workLocation,
            seniorityLevel: schema.assignment.seniorityLevel,
            positionLevel: schema.assignment.positionLevel,
          })
          .from(schema.assignment)
          .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
          .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.assignment.departmentId))
          .leftJoin(team, eq(team.id, schema.assignment.teamId))
          .leftJoin(manager, eq(manager.id, schema.assignment.managerId))
          .leftJoin(schema.branch, eq(schema.branch.id, schema.assignment.branchId))
          .where(and(eq(schema.assignment.employmentId, employmentId), eq(schema.assignment.kind, "primary")))
          // The one in force on the day first; failing that, the latest.
          .orderBy(desc(inForce(schema.assignment.validFrom, schema.assignment.validTo) ?? schema.assignment.validFrom), desc(schema.assignment.validFrom))
          .limit(1)
      : [],
    employmentId
      ? db()
          .select({ number: schema.contract.number, type: schema.contract.type, signDate: schema.contract.signDate, startDate: schema.contract.startDate, endDate: schema.contract.endDate })
          .from(schema.contract)
          .where(and(eq(schema.contract.employmentId, employmentId), isNull(schema.contract.deletedAt), ne(schema.contract.type, "appendix"), ne(schema.contract.type, "nda")))
          .orderBy(desc(and(lte(schema.contract.startDate, on), or(isNull(schema.contract.endDate), gte(schema.contract.endDate, on))) ?? schema.contract.startDate), desc(schema.contract.startDate))
          .limit(1)
      : [],
    db().select().from(schema.personProfile).where(eq(schema.personProfile.personId, personId)).limit(1),
  ]);

  const { person, employment } = head;
  return {
    fullName: person.fullName,
    workEmail: person.workEmail,
    employeeCode: employment?.employeeCode ?? null,
    startDate: employment?.startDate ?? null,
    seniorityDate: employment?.seniorityDate ?? null,
    endDate: employment?.endDate ?? null,
    status: person.status,
    workforceType: placement?.workforceType ?? person.workforceType ?? null,
    positionName: placement?.positionName ?? null,
    departmentName: placement?.departmentName ?? null,
    teamName: placement?.teamName ?? null,
    managerName: placement?.managerName ?? null,
    branchName: placement?.branchName ?? null,
    workLocation: placement?.workLocation ?? null,
    seniorityLevel: placement?.seniorityLevel ?? null,
    positionLevel: placement?.positionLevel ?? null,
    profile: profile ? { gender: profile.gender, dateOfBirth: profile.dateOfBirth, phone: profile.phone, nationality: profile.nationality, permanentAddress: profile.permanentAddress, currentAddress: profile.currentAddress } : null,
    contract: contract ?? null,
  };
}

/** The event a paper is issued for, as a decision prints it. null when there is none, or it is about somebody else. */
export async function documentEventOf(eventId: string, personId: string): Promise<(Pick<LifecycleEventRow, "id" | "type" | "effectiveDate" | "reason"> & { from: PlacementWords | null; to: PlacementWords | null }) | null> {
  const event = await findLifecycleEvent(eventId);
  if (!event || event.personId !== personId) return null;
  return { id: event.id, type: event.type, effectiveDate: event.effectiveDate, reason: event.reason, from: (event.details.from as PlacementWords | undefined) ?? null, to: (event.details.to as PlacementWords | undefined) ?? null };
}
