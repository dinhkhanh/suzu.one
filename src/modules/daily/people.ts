// Readers and subjects of daily reports, as the policy wants them: the teams a reader leads, and
// for a subject their teams and the chain of managers above them. The reporting lines come from
// the performance module's directory (the same walk its goals and reviews use), read once per
// request.
import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { loadDirectory, reportsBelow } from "@/modules/performance/service";
import { canViewReport, type ReportReader, type ReportSubject, type TimeReader } from "./policy";
import { rulesOfPeople } from "./team-rules";

export type Subject = ReportSubject & { fullName: string };

/** The reader: who they are and which active work teams they lead. Inside a transaction, pass it. */
export async function loadReportReader(personId: string, executor: Tx | ReturnType<typeof db> = db()): Promise<ReportReader> {
  const rows = await executor
    .select({ teamId: schema.workTeamMember.teamId })
    .from(schema.workTeamMember)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTeamMember.teamId))
    .where(and(eq(schema.workTeamMember.personId, personId), eq(schema.workTeamMember.role, "lead"), eq(schema.workTeam.isActive, true)));
  return { personId, ledTeamIds: new Set(rows.map((row) => row.teamId)) };
}

/**
 * The reader of time entries: the report reader, and the projects they lead — named as the
 * project's lead, or holding the project role "lead" — whose rows they may also read.
 */
export async function loadTimeReader(personId: string): Promise<TimeReader> {
  const [reader, projects] = await Promise.all([
    loadReportReader(personId),
    db()
      .selectDistinct({ projectId: schema.workProject.id })
      .from(schema.workProject)
      .leftJoin(schema.workProjectMember, and(eq(schema.workProjectMember.projectId, schema.workProject.id), eq(schema.workProjectMember.personId, personId), eq(schema.workProjectMember.role, "lead")))
      .where(or(eq(schema.workProject.leadPersonId, personId), eq(schema.workProjectMember.personId, personId))),
  ]);
  return { ...reader, ledProjectIds: new Set(projects.map((row) => row.projectId)) };
}

/** Subjects by id; people unknown to the directory are left out. */
export async function loadSubjects(personIds: readonly string[]): Promise<Map<string, Subject>> {
  const [directory, teams] = await Promise.all([loadDirectory(), rulesOfPeople(personIds)]);
  const result = new Map<string, Subject>();
  for (const personId of new Set(personIds)) {
    const person = directory.get(personId);
    if (!person) continue;
    result.set(personId, { personId, fullName: person.fullName, teamIds: teams.get(personId)?.teamIds ?? [], chainAbove: person.chainAbove });
  }
  return result;
}

/** May this reader see that person's reports? One subject, loaded on the spot. */
export async function readerMaySee(reader: ReportReader, personId: string): Promise<Subject | null> {
  const subject = (await loadSubjects([personId])).get(personId);
  return subject && canViewReport(reader, subject) ? subject : null;
}

export type OverseenGroup = { kind: "team"; teamId: string; name: string; personIds: string[] } | { kind: "reports"; personIds: string[] };

/**
 * Everyone whose reports the reader oversees (not themselves), grouped as the board shows them:
 * one group per team they lead, then the people below them in the reporting line. A person may be
 * in two groups. This is the list form of `canViewReport`; a test keeps the two in step.
 */
export async function listOverseen(reader: ReportReader): Promise<OverseenGroup[]> {
  const self = reader.personId;
  if (!self) return [];
  const directory = await loadDirectory();
  const present = (personId: string) => personId !== self && directory.get(personId)?.status !== "offboarded" && directory.has(personId);
  const groups: OverseenGroup[] = [];
  if (reader.ledTeamIds.size > 0) {
    const rows = await db()
      .select({ teamId: schema.workTeam.id, name: schema.workTeam.name, personId: schema.workTeamMember.personId })
      .from(schema.workTeam)
      .innerJoin(schema.workTeamMember, eq(schema.workTeamMember.teamId, schema.workTeam.id))
      .where(and(eq(schema.workTeam.isActive, true), inArray(schema.workTeam.id, [...reader.ledTeamIds])));
    for (const [teamId, members] of Map.groupBy(rows, (row) => row.teamId)) {
      groups.push({ kind: "team", teamId, name: members[0].name, personIds: members.map((row) => row.personId).filter(present) });
    }
    groups.sort((a, b) => (a.kind === "team" && b.kind === "team" ? a.name.localeCompare(b.name, "vi") : 0));
  }
  const below = reportsBelow(directory, self)
    .filter((person) => present(person.personId))
    .map((person) => person.personId);
  if (below.length > 0) groups.push({ kind: "reports", personIds: below });
  return groups;
}
