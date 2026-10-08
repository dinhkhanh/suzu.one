// Weekly reports (FR-PJM-23): each person's week and each work team's week, generated from the
// week's daily reports, completed work and logged time; the team's lead adds a summary. The Monday
// job makes last week's — for everyone the daily loop asks, in a team or not — and tells the people
// above once: a team's leads and the head of its department, and the line manager of someone no
// lead stands over.
import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listPeopleHoldingEach } from "@/modules/platform/rbac/service";
import { listWorkActivityBetween, workDirectory } from "@/modules/work/service";
import { daysOf } from "./days";
import { type ShownPersonWeek, type ShownTeamWeek, showPersonWeek, showTeamWeek } from "./engine/redact";
import { type PersonWeek, summarisePersonWeek, summariseTeamWeek, type TeamWeek, type WeekDayReport } from "./engine/weekly";
import { loadSeen, readsOwn } from "./labels";
import { firstReadersOf, listOverseen, loadSubjects } from "./people";
import { canOverseeReport, canViewReport, type ReportReader } from "./policy";
import { listDailyPeople } from "./team-rules";
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
      .where(
        and(
          inArray(schema.dailyReport.personId, ids),
          inArray(
            schema.dailyReport.date,
            Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
          ),
        ),
      ),
    listWorkActivityBetween(ids, weekStart, weekEnd),
    listTimeOf(ids, weekStart, weekEnd),
    daysOf(ids, weekStart, weekEnd),
  ]);
  // Each list is indexed by person once, not scanned again for every person: the Monday job runs
  // this over the whole company.
  const reportsOf = Map.groupBy(reports, (row) => row.personId);
  const completedOf = Map.groupBy(
    events.filter((event) => event.kind === "completed"),
    (event) => event.personId,
  );
  const timeOf = Map.groupBy(time, (entry) => entry.personId);
  for (const personId of ids) {
    const own: WeekDayReport[] = (reportsOf.get(personId) ?? []).map((row) => ({ date: row.date, status: row.status as WeekDayReport["status"], late: row.late, done: row.done, notDone: row.notDone, blockers: row.blockers }));
    const completed = (completedOf.get(personId) ?? []).map((event) => ({ taskId: event.taskId, title: event.title, ref: event.key }));
    const requiredDays = [...(days.get(personId)?.values() ?? [])].filter((day) => day.report.required).length;
    result.set(personId, summarisePersonWeek({ reports: own, completed, time: timeOf.get(personId) ?? [], requiredDays }));
  }
  return result;
}

type WeeklySubject = { subjectType: "person" | "team"; subjectId: string; content: PersonWeek | TeamWeek };

/**
 * A week's rows in one statement, whatever their number: the Monday job writes a row per person the
 * loop asks and one per team, and a company-wide run must not be a statement per person.
 * Generating again refreshes the facts and keeps the lead's summary.
 */
async function upsertWeekly(weekStart: IsoDate, subjects: readonly WeeklySubject[]): Promise<Map<string, WeeklyRow>> {
  if (subjects.length === 0) return new Map();
  const rows = await db()
    .insert(schema.dailyWeeklyReport)
    .values(subjects.map(({ subjectType, subjectId, content }) => ({ subjectType, subjectId, weekStart, content: content as unknown as Record<string, unknown> })))
    .onConflictDoUpdate({ target: [schema.dailyWeeklyReport.subjectType, schema.dailyWeeklyReport.subjectId, schema.dailyWeeklyReport.weekStart], set: { content: sql`excluded.content`, updatedAt: new Date() } })
    .returning();
  return new Map(rows.map((row) => [`${row.subjectType}:${row.subjectId}`, row]));
}

type TeamWithMembers = { id: string; name: string; entityId: string | null; departmentId: string | null; members: { personId: string; name: string; role: string }[] };

async function activeTeams(teamIds?: readonly string[]): Promise<TeamWithMembers[]> {
  const rows = await db()
    .select({
      id: schema.workTeam.id,
      name: schema.workTeam.name,
      entityId: schema.workTeam.entityId,
      departmentId: schema.workTeam.departmentId,
      personId: schema.workTeamMember.personId,
      personName: schema.person.fullName,
      role: schema.workTeamMember.role,
      status: schema.person.status,
    })
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
 * Generates the weekly reports of a week: one per person the daily loop asks anything of
 * (`listDailyPeople` — in a work team or in none, D23; never a collaborator or an owner, of whom it
 * asks nothing) and one per active team. A team's week still counts every member's work, whoever
 * they are. With `teamIds` — a lead's refresh from the screen — only those teams and their people.
 * Safe to run again: the rows are refreshed, the summaries kept, and each notice (`sent_at`) goes
 * out once. `notify: false` for the refresh.
 */
export async function generateWeek(weekStart: IsoDate, options: { teamIds?: readonly string[]; notify?: boolean } = {}): Promise<{ people: number; teams: number; notified: number }> {
  const [teams, asked] = await Promise.all([activeTeams(options.teamIds), listDailyPeople()]);
  const members = new Set(teams.flatMap((team) => team.members.map((member) => member.personId)));
  const personIds = options.teamIds ? asked.filter((personId) => members.has(personId)) : asked;
  const weeks = await personWeeks([...members, ...personIds], weekStart);
  const rows = await upsertWeekly(weekStart, [
    ...personIds.map((personId) => ({ subjectType: "person" as const, subjectId: personId, content: weeks.get(personId)! })),
    ...teams.map((team) => ({ subjectType: "team" as const, subjectId: team.id, content: summariseTeamWeek(team.members.map((member) => ({ personId: member.personId, name: member.name, week: weeks.get(member.personId)! }))) })),
  ]);
  const notified = options.notify === false ? 0 : await tellOfWeek(weekStart, teams, personIds, rows);
  return { people: personIds.length, teams: teams.length, notified };
}

type WeekNotice = { rowId: string; recipients: string[]; subject: string; link: string };

/**
 * Who hears that a week is ready (FR-PJM-23 "sent to the chain above"), once per row:
 *   · a team's week — its leads, and whoever holds `work:manage` over the team's department (the
 *     department head; the owners' "*" is left out of a routine notice);
 *   · the week of someone no lead stands over — a person in no team, the lead of their own team —
 *     their line manager. Everyone else's week reaches their lead with the team's.
 * The grants are read once for every team and the leads once for every person; the rows are claimed
 * in one statement, so two runs at once tell nobody twice; and a person with several weeks to read
 * gets one notice that counts them, not one per week. Returns how many rows were sent.
 */
async function tellOfWeek(weekStart: IsoDate, teams: readonly TeamWithMembers[], personIds: readonly string[], rows: ReadonlyMap<string, WeeklyRow>): Promise<number> {
  const unsentTeams = teams.filter((team) => !rows.get(`team:${team.id}`)!.sentAt);
  const unsentPeople = personIds.filter((personId) => !rows.get(`person:${personId}`)!.sentAt);
  if (unsentTeams.length === 0 && unsentPeople.length === 0) return 0;
  const placed = unsentTeams.filter((team) => team.departmentId);
  const [holders, readers] = await Promise.all([
    listPeopleHoldingEach(
      "work:manage",
      placed.map((team) => ({ entityId: team.entityId, unitPath: [team.departmentId!] })),
      { includeWildcard: false },
    ),
    firstReadersOf(unsentPeople),
  ]);
  const above = new Map(placed.map((team, index) => [team.id, holders[index]]));
  const notices: WeekNotice[] = [
    ...unsentTeams.map((team) => ({
      rowId: rows.get(`team:${team.id}`)!.id,
      recipients: [...new Set([...team.members.filter((member) => member.role === "lead").map((member) => member.personId), ...(above.get(team.id) ?? [])])],
      subject: team.name,
      link: `/daily/weekly?week=${weekStart}&team=${team.id}`,
    })),
    ...unsentPeople.flatMap((personId) => {
      const own = readers.get(personId);
      return own?.manager ? [{ rowId: rows.get(`person:${personId}`)!.id, recipients: [own.manager], subject: own.fullName, link: `/daily/weekly?week=${weekStart}` }] : [];
    }),
  ];
  if (notices.length === 0) return 0;
  const week = weekLabel(weekStart);
  return db().transaction(async (tx) => {
    // Claimed first, so two runs at once tell nobody twice.
    const claimed = new Set(
      (
        await tx
          .update(schema.dailyWeeklyReport)
          .set({ sentAt: new Date() })
          .where(
            and(
              inArray(
                schema.dailyWeeklyReport.id,
                notices.map((notice) => notice.rowId),
              ),
              isNull(schema.dailyWeeklyReport.sentAt),
            ),
          )
          .returning({ id: schema.dailyWeeklyReport.id })
      ).map((row) => row.id),
    );
    const sent = notices.filter((notice) => claimed.has(notice.rowId));
    const byRecipient = new Map<string, WeekNotice[]>();
    for (const notice of sent) for (const recipient of notice.recipients) byRecipient.set(recipient, [...(byRecipient.get(recipient) ?? []), notice]);
    // One week to read: the notice names it and opens it. Several: one notice that counts them.
    const one = Map.groupBy(
      [...byRecipient].filter(([, own]) => own.length === 1),
      ([, own]) => own[0].rowId,
    );
    for (const group of one.values()) {
      const [notice] = group[0][1];
      await notify({ recipients: group.map(([recipient]) => recipient), kind: "daily.weekly_report", params: { subject: notice.subject, week }, link: notice.link }, tx);
    }
    const several = Map.groupBy(
      [...byRecipient].filter(([, own]) => own.length > 1),
      ([, own]) => own.length,
    );
    for (const [count, group] of several) await notify({ recipients: group.map(([recipient]) => recipient), kind: "daily.weekly_reports", params: { count, week }, link: `/daily/weekly?week=${weekStart}` }, tx);
    return sent.length;
  });
}

/** The stored row without its `content`: what the reader may see of it is `content` beside it, resolved for them. */
export type WeeklyRowView = Omit<WeeklyRow, "content">;
export type WeeklyTeamView = { row: WeeklyRowView; team: { id: string; name: string }; content: ShownTeamWeek };
export type WeeklyPersonView = { row: WeeklyRowView; personId: string; name: string; content: ShownPersonWeek; canSummarise: boolean };

const rowView = (row: WeeklyRow): WeeklyRowView => {
  // The stored content never leaves this function: what the reader may see of it is built beside it.
  const { content, ...rest } = row;
  void content;
  return rest;
};

/**
 * The weekly reports a reader may see for a week: the teams they may run (`canRunTeam`, the work
 * policy's team admin — the team's leads and `work:manage` over it, the department head among
 * them), and the people whose daily reports they may read.
 *
 * Running a team is not the same as reading its people's reports: a `work:manage` holder who is
 * neither their lead nor above them in the reporting line gets the team's totals and hours, not the
 * people's lines or their blockers (`showTeamWeek`). And in every week, a task or a project the
 * reader may not open is shown as private work with its hours only.
 *
 * Who may be read is settled before the query, so only those rows — with their JSON — leave
 * Postgres: the teams out of the work directory (cached reference data) that `canRunTeam` passes,
 * and the people out of `listOverseen`, the list form of `canViewReport` (with those who have
 * left: a past week is still theirs to read). Oversight (`daily:oversee`) reads every person's
 * row, so its query names no one. Each row is still put to the policy before it is shown.
 */
export async function listWeekly(
  reader: ReportReader,
  weekStart: IsoDate,
  canRunTeam: (team: { id: string; entityId: string | null; departmentId: string | null; defaultVisibility: string }) => boolean,
): Promise<{ teams: WeeklyTeamView[]; people: WeeklyPersonView[] }> {
  if (!reader.personId) return { teams: [], people: [] };
  const [directory, overseen] = await Promise.all([workDirectory(), reader.oversees ? [] : listOverseen(reader, { includeLeft: true })]);
  const runnableTeams = new Map(directory.teams.filter(canRunTeam).map((team) => [team.id, team]));
  const readable = [...new Set([reader.personId, ...overseen.flatMap((group) => group.personIds)])];
  const rows = await db()
    .select()
    .from(schema.dailyWeeklyReport)
    .where(
      and(
        eq(schema.dailyWeeklyReport.weekStart, weekStart),
        or(
          and(eq(schema.dailyWeeklyReport.subjectType, "person"), reader.oversees ? undefined : inArray(schema.dailyWeeklyReport.subjectId, readable)),
          runnableTeams.size > 0 ? and(eq(schema.dailyWeeklyReport.subjectType, "team"), inArray(schema.dailyWeeklyReport.subjectId, [...runnableTeams.keys()])) : undefined,
        ),
      ),
    )
    .orderBy(desc(schema.dailyWeeklyReport.updatedAt));
  const runnable = rows.flatMap((row) => {
    const team = row.subjectType === "team" ? runnableTeams.get(row.subjectId) : undefined;
    return team ? [{ row: rowView(row), team: { id: team.id, name: team.name }, content: row.content as unknown as TeamWeek }] : [];
  });
  const personRows = rows.filter((row) => row.subjectType === "person");
  // Everyone named anywhere on the page: the person rows and the people inside each team's week.
  const subjects = await loadSubjects([...personRows.map((row) => row.subjectId), ...runnable.flatMap((view) => view.content.people.map((person) => person.personId))]);
  const mayRead = (personId: string) => {
    const subject = subjects.get(personId);
    return !!subject && canViewReport(reader, subject);
  };
  const mine = personRows.flatMap((row) => {
    const subject = subjects.get(row.subjectId);
    return subject && canViewReport(reader, subject) ? [{ row: rowView(row), subject, content: row.content as unknown as PersonWeek }] : [];
  });

  // One read-time check for every task and project the page would name, for this reader.
  const seen = await loadSeen(reader.personId, {
    taskIds: mine
      .filter((view) => !readsOwn(reader, view.subject.personId))
      .flatMap((view) => [...view.content.done, ...view.content.slipped])
      .map((line) => line.taskId),
    projectIds: [...runnable.flatMap((view) => view.content.hoursByProject), ...mine.flatMap((view) => view.content.hoursByProject)].map((group) => group.projectId),
  });
  const teams = runnable.map((view) => ({ ...view, content: showTeamWeek(view.content, seen, mayRead) }));
  const people = mine.map((view) => ({
    row: view.row,
    personId: view.subject.personId,
    name: view.subject.fullName,
    // The person's own week is theirs as they lived it; anyone else's is named for this reader.
    content: readsOwn(reader, view.subject.personId) ? view.content : showPersonWeek(view.content, seen),
    canSummarise: canOverseeReport(reader, view.subject),
  }));
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
