// Weekly reports (FR-PJM-23): each person's week and each work team's week, generated from the
// week's daily reports, completed work and logged time; the team's lead adds a summary. The Monday
// job makes last week's and tells the leads — and, for a team, the department head above it — once.
import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listPeopleWithRole } from "@/modules/platform/rbac/service";
import { listWorkActivityBetween } from "@/modules/work/service";
import { daysOf } from "./days";
import { type PersonWeek, summarisePersonWeek, summariseTeamWeek, type TeamWeek, type WeekDayReport } from "./engine/weekly";
import { loadSubjects } from "./people";
import { canOverseeReport, canViewReport, type ReportReader } from "./policy";
import { listTimeOf } from "./time";

export type WeeklyRow = typeof schema.dailyWeeklyReport.$inferSelect;
const weekLabel = (weekStart: IsoDate) => weekStart.split("-").reverse().join("/");

/** Each person's week, from their reports, completed work and time. */
async function personWeeks(personIds: readonly string[], weekStart: IsoDate): Promise<Map<string, PersonWeek>> {
  const weekEnd = addDays(weekStart, 6);
  const ids = [...new Set(personIds)];
  const result = new Map<string, PersonWeek>();
  if (ids.length === 0) return result;
  const [reports, events, time, days] = await Promise.all([
    db()
      .select()
      .from(schema.dailyReport)
      .where(and(inArray(schema.dailyReport.personId, ids), inArray(schema.dailyReport.date, Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))))),
    listWorkActivityBetween(ids, weekStart, weekEnd),
    listTimeOf(ids, weekStart, weekEnd),
    daysOf(ids, weekStart, weekEnd),
  ]);
  for (const personId of ids) {
    const own: WeekDayReport[] = reports.filter((row) => row.personId === personId).map((row) => ({ date: row.date, status: row.status as WeekDayReport["status"], late: row.late, done: row.done, notDone: row.notDone, blockers: row.blockers }));
    const completed = events.filter((event) => event.personId === personId && event.kind === "completed").map((event) => ({ taskId: event.taskId, title: event.title, ref: event.key }));
    const requiredDays = [...(days.get(personId)?.values() ?? [])].filter((day) => day.report.required).length;
    result.set(personId, summarisePersonWeek({ reports: own, completed, time: time.filter((entry) => entry.personId === personId), requiredDays }));
  }
  return result;
}

async function upsertWeekly(subjectType: "person" | "team", subjectId: string, weekStart: IsoDate, content: PersonWeek | TeamWeek): Promise<WeeklyRow> {
  const [row] = await db()
    .insert(schema.dailyWeeklyReport)
    .values({ subjectType, subjectId, weekStart, content: content as unknown as Record<string, unknown> })
    // Generating again refreshes the facts and keeps the lead's summary.
    .onConflictDoUpdate({ target: [schema.dailyWeeklyReport.subjectType, schema.dailyWeeklyReport.subjectId, schema.dailyWeeklyReport.weekStart], set: { content: content as unknown as Record<string, unknown>, updatedAt: new Date() } })
    .returning();
  return row;
}

type TeamWithMembers = { id: string; name: string; entityId: string | null; departmentId: string | null; members: { personId: string; name: string; role: string }[] };

async function activeTeams(teamIds?: readonly string[]): Promise<TeamWithMembers[]> {
  const rows = await db()
    .select({ id: schema.workTeam.id, name: schema.workTeam.name, entityId: schema.workTeam.entityId, departmentId: schema.workTeam.departmentId, personId: schema.workTeamMember.personId, personName: schema.person.fullName, role: schema.workTeamMember.role, status: schema.person.status })
    .from(schema.workTeam)
    .innerJoin(schema.workTeamMember, eq(schema.workTeamMember.teamId, schema.workTeam.id))
    .innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId))
    .where(and(eq(schema.workTeam.isActive, true), teamIds ? inArray(schema.workTeam.id, [...teamIds]) : undefined));
  return [...Map.groupBy(rows, (row) => row.id)].map(([id, members]) => ({
    id,
    name: members[0].name,
    entityId: members[0].entityId,
    departmentId: members[0].departmentId,
    members: members.filter((row) => row.status !== "offboarded").map((row) => ({ personId: row.personId, name: row.personName, role: row.role })),
  }));
}

/**
 * Generates the weekly reports of a week: one per person in an active team, one per team.
 * Safe to run again — the rows are refreshed, the summaries kept, and each team's notice
 * (`sent_at`) goes out once. `notify: false` for a lead's refresh from the screen.
 */
export async function generateWeek(weekStart: IsoDate, options: { teamIds?: readonly string[]; notify?: boolean } = {}): Promise<{ people: number; teams: number; notified: number }> {
  const teams = await activeTeams(options.teamIds);
  const personIds = [...new Set(teams.flatMap((team) => team.members.map((member) => member.personId)))];
  const weeks = await personWeeks(personIds, weekStart);
  for (const [personId, week] of weeks) await upsertWeekly("person", personId, weekStart, week);
  let notified = 0;
  for (const team of teams) {
    const content = summariseTeamWeek(team.members.map((member) => ({ personId: member.personId, name: member.name, week: weeks.get(member.personId)! })));
    const row = await upsertWeekly("team", team.id, weekStart, content);
    if (options.notify === false || row.sentAt) continue;
    const leads = team.members.filter((member) => member.role === "lead").map((member) => member.personId);
    const heads = team.departmentId ? await listPeopleWithRole("department_head", { unitPath: [team.departmentId], entityId: team.entityId }) : [];
    await db().transaction(async (tx) => {
      // Claimed first, so two runs at once tell nobody twice.
      const [claimed] = await tx.update(schema.dailyWeeklyReport).set({ sentAt: new Date() }).where(and(eq(schema.dailyWeeklyReport.id, row.id), isNull(schema.dailyWeeklyReport.sentAt))).returning({ id: schema.dailyWeeklyReport.id });
      if (!claimed) return;
      await notify({ recipients: [...leads, ...heads], kind: "daily.weekly_report", params: { subject: team.name, week: weekLabel(weekStart) }, link: `/daily/weekly?week=${weekStart}&team=${team.id}` }, tx);
      notified += 1;
    });
  }
  return { people: weeks.size, teams: teams.length, notified };
}

export type WeeklyTeamView = { row: WeeklyRow; team: { id: string; name: string }; content: TeamWeek };
export type WeeklyPersonView = { row: WeeklyRow; personId: string; name: string; content: PersonWeek; canSummarise: boolean };

/**
 * The weekly reports a reader may see for a week: the teams they may run (`canRunTeam`, the work
 * policy's team admin — the team's leads and `work:manage` over it, the department head among
 * them), and the people whose daily reports they may read.
 */
export async function listWeekly(reader: ReportReader, weekStart: IsoDate, canRunTeam: (team: { id: string; entityId: string | null; departmentId: string | null; defaultVisibility: string }) => boolean): Promise<{ teams: WeeklyTeamView[]; people: WeeklyPersonView[] }> {
  const rows = await db().select().from(schema.dailyWeeklyReport).where(eq(schema.dailyWeeklyReport.weekStart, weekStart)).orderBy(desc(schema.dailyWeeklyReport.updatedAt));
  const teamRows = rows.filter((row) => row.subjectType === "team");
  const teamFacts = teamRows.length ? await db().select({ id: schema.workTeam.id, name: schema.workTeam.name, entityId: schema.workTeam.entityId, departmentId: schema.workTeam.departmentId, defaultVisibility: schema.workTeam.defaultVisibility }).from(schema.workTeam).where(inArray(schema.workTeam.id, teamRows.map((row) => row.subjectId))) : [];
  const teams = teamRows.flatMap((row) => {
    const team = teamFacts.find((facts) => facts.id === row.subjectId);
    return team && canRunTeam(team) ? [{ row, team: { id: team.id, name: team.name }, content: row.content as unknown as TeamWeek }] : [];
  });
  const personRows = rows.filter((row) => row.subjectType === "person");
  const subjects = await loadSubjects(personRows.map((row) => row.subjectId));
  const people = personRows.flatMap((row) => {
    const subject = subjects.get(row.subjectId);
    return subject && canViewReport(reader, subject) ? [{ row, personId: subject.personId, name: subject.fullName, content: row.content as unknown as PersonWeek, canSummarise: canOverseeReport(reader, subject) }] : [];
  });
  people.sort((a, b) => Number(b.personId === reader.personId) - Number(a.personId === reader.personId) || a.name.localeCompare(b.name, "vi"));
  teams.sort((a, b) => a.team.name.localeCompare(b.team.name, "vi"));
  return { teams, people };
}

export async function findWeekly(id: string): Promise<WeeklyRow | null> {
  const [row] = await db().select().from(schema.dailyWeeklyReport).where(eq(schema.dailyWeeklyReport.id, id)).limit(1);
  return row ?? null;
}

export async function saveWeeklySummary(id: string, summary: string | null, authorPersonId: string): Promise<{ before: WeeklyRow; after: WeeklyRow }> {
  const before = await findWeekly(id);
  if (!before) throw new ActionError("weekly_not_found");
  const [after] = await db().update(schema.dailyWeeklyReport).set({ summary, authorPersonId, updatedAt: new Date() }).where(eq(schema.dailyWeeklyReport.id, id)).returning();
  return { before, after };
}
