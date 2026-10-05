import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { DailyRulesSection } from "@/modules/daily/ui/team-rules-section";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { readFilters, readGrouping, readSort, taskSliceFor } from "@/modules/work/engine/filter";
import { addableMembers, canAdminTeam, canContributeToTeam, canManageWorkspace, canViewTeam, canViewTeamBacklog, findTeam, listAssignable, listClients, listDeletedTasks, listRecurrences, listSavedViews, listTeamIntakeForms, listLabels, listStates, listTaskSlice, listTeamMembers, loadViewer, RESTORE_WINDOW_DAYS, teamFacts, visibleProjects, withEditable, WORK_VIEWS, type WorkView } from "@/modules/work/service";
import { getDaysOff } from "@/modules/attendance/service";
import { isMonthKey, monthGrid } from "@/modules/work/engine/calendar";
import { BoardView } from "@/modules/work/ui/board-view";
import { CalendarView } from "@/modules/work/ui/calendar-view";
import { DeletedTasks } from "@/modules/work/ui/deleted-tasks";
import { RecurrenceManager } from "@/modules/work/ui/planning-forms";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { canManageCustomFields, canSeeLoggedTime, canViewTriage, countTriage, listCustomFields, loggedMinutesByTask, toFieldViews } from "@/modules/work/service";
import { CustomFieldManager } from "@/modules/work/ui/custom-fields";
import { ViewTabs } from "@/modules/work/ui/filter-bar";
import { TaskTableView } from "@/modules/work/ui/task-table-view";
import { IntakeFormManager } from "@/modules/work/ui/intake-forms";
import { canViewAutomations, listOpenCycles } from "@/modules/work/service";
import { accentOf, teamStatusOf } from "@/modules/work/enums";
import { ArchiveButton, EditTeamButton } from "@/modules/work/ui/edit-dialogs";
import { ProjectPoster } from "@/modules/work/ui/project-poster";
import { ColorSquare } from "@/modules/work/ui/task-row";
import { ProjectStatusBadge } from "@/modules/work/ui/status-badge";
import { LabelManager, MemberManager, StateManager } from "@/modules/work/ui/team-forms";
import { checklistChoices, listStateChecklists, projectStatusNames, projectStatusSetChoices } from "@/modules/work/service";
import { StageChecklists } from "@/modules/work/ui/checklists";
import { SaveWorkflowToLibrary } from "@/modules/work/ui/status-sets";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("team");

export default async function TeamPage({ params, searchParams }: PageProps<"/work/teams/[teamId]">) {
  const user = await requireUser();
  const { teamId } = await params;
  const query = await searchParams;
  const [team, viewer, t, tChecklists] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work"), getTranslations("checklists.stages")]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const facts = teamFacts(team);
  const admin = canAdminTeam(viewer, facts);
  const status = teamStatusOf(team);
  const seesBacklog = canViewTeamBacklog(viewer, facts);
  const today = todayInVietnam();
  const filters = readFilters(query);
  const backlogView: WorkView = WORK_VIEWS.includes(query.view as WorkView) ? (query.view as WorkView) : "list";
  const month = isMonthKey(query.month) ? query.month : today.slice(0, 7);
  const grid = monthGrid(month);

  const [members, states, labels, projects, { items: backlog, total: backlogTotal }, clients, assignable, intakeForms, [addable, entities, departments]] = await Promise.all([
    listTeamMembers(team.id),
    listStates([team.id]),
    listLabels([team.id]),
    visibleProjects(viewer, { today }),
    // PERF-03: open work, and closed work only as far as this view shows it.
    seesBacklog ? listTaskSlice({ backlogOf: team.id }, taskSliceFor(backlogView, filters, today, grid)) : { items: [], total: 0 },
    listClients({ activeOnly: true }),
    listAssignable(team.id, null),
    listTeamIntakeForms(team.id),
    // The picker offers only the people this viewer may actually add (`canAddTeamMember`).
    admin ? Promise.all([addableMembers(viewer, facts), listEntities(), unitChoices()]) : ([{ people: [], narrowed: false }, [], []] as [Awaited<ReturnType<typeof addableMembers>>, Awaited<ReturnType<typeof listEntities>>, Awaited<ReturnType<typeof unitChoices>>]),
  ]);
  const contribute = canContributeToTeam(viewer, facts) && team.isActive;
  const [fieldRows, triageCounts, checklists, stageHooks, statusNames, statusSets, views, recurrences, deleted] = await Promise.all([
    listCustomFields({ teamId: team.id }, { includeInactive: true }),
    canViewTriage(viewer, facts) ? countTriage([team.id]) : null,
    checklistChoices(),
    listStateChecklists(states.map((state) => state.id)),
    projectStatusNames(),
    admin ? projectStatusSetChoices(team.id, team.projectStatusSetId) : [],
    // The backlog is a list of its own (WRK-02): its saved filters, its recurring tasks, and — for
    // whoever runs the team — what was deleted from it lately.
    seesBacklog ? listSavedViews({ teamId: team.id }, user.person.id) : [],
    seesBacklog ? listRecurrences({ teamId: team.id }, today) : [],
    admin && seesBacklog ? listDeletedTasks({ teamId: team.id }) : [],
  ]);
  const fields = toFieldViews(fieldRows);
  // FR-PJM-10: the team's open cycles, for the filter and bulk edit.
  const cycles = (await listOpenCycles([team.id])).map((cycle) => ({ id: cycle.id, label: t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") }) }));
  const logged = seesBacklog && backlogView === "table" && canSeeLoggedTime(viewer, { team: facts, project: null }) ? Object.fromEntries(await loggedMinutesByTask(backlog.map((task) => task.id))) : null;
  const intakeProjects = projects.filter((project) => project.teamId === team.id && project.status !== "archived" && project.status !== "done").map(({ id, name }) => ({ id, name }));
  const grouping = readGrouping(query.group);
  const sort = readSort(query.sort);
  const teamProjects = projects.filter((project) => project.teamId === team.id);

  const listOptions = { states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields: fields.filter((field) => field.projectId === null), cycles };
  const scope = { teamId: team.id, projectId: null };
  // The backlog's calendar: its dated tasks on the team's own working calendar (no content posts — those belong to projects).
  const [calendarTasks, daysOff] = seesBacklog && backlogView === "calendar" ? await Promise.all([withEditable(viewer, backlog), getDaysOff(team.entityId, grid.from, grid.to)]) : [[], []];

  return (
    <Page width="wide" data-accent={accentOf(team.color)}>
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ColorSquare color={accentOf(team.color)} className="size-2.5 rounded-[3px]" />
            <span className="font-mono text-base font-normal text-faint">{team.key}</span> {team.name}
            {status === "active" ? null : <Badge variant={status === "archived" ? "secondary" : "outline"}>{t(`teams.status.${status}`)}</Badge>}
          </span>
        }
        description={team.description}
        actions={
          admin ? (
            <>
              <EditTeamButton team={team} entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} statusSets={statusSets} />
              <ArchiveButton target={{ teamId: team.id }} name={team.name} archived={status === "archived"} />
            </>
          ) : undefined
        }
      />
      <nav className="tab-row" aria-label={t("teams.settings")}>
        <Link href={`/work/teams/${team.id}`} aria-current="page">
          {t("task.overview")}
        </Link>
        {triageCounts ? (
          <Link href={`/work/teams/${team.id}/triage`}>
            {t("teams.triage")}
            <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{triageCounts.get(team.id) ?? 0}</span>
          </Link>
        ) : null}
        <Link href={`/work/teams/${team.id}/cycles`}>{t("cycles.title")}</Link>
        <Link href={`/work/teams/${team.id}/handoffs`}>{t("handoff.packages.title")}</Link>
        <Link href={`/work/teams/${team.id}/reviews`}>{t("chains.title")}</Link>
        {canViewAutomations(viewer, facts) ? <Link href={`/work/teams/${team.id}/automations`}>{t("automations.title")}</Link> : null}
      </nav>

      <Section title={t("projects.title")} count={teamProjects.length || undefined}>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("projects.fields.name")}</TableHead>
              <TableHead kind="status">{t("projects.fields.status")}</TableHead>
              <TableHead kind="number">{t("projects.openTasks")}</TableHead>
              <TableHead kind="select">{t("projects.fields.visibility")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamProjects.map((project) => (
              <TableRow key={project.id} data-accent={accentOf(project.color, team.color)}>
                <TableCell className="max-w-96">
                  <span className="flex items-center gap-3">
                    <ProjectPoster project={project} size="sm" />
                    <ColorSquare color={accentOf(project.color, team.color)} />
                    <Link href={`/work/projects/${project.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {project.name}
                    </Link>
                  </span>
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge status={project.status} name={(project.statusId && statusNames.get(project.statusId)) || t(`projects.status.${project.status}`)} />
                </TableCell>
                <TableCell kind="number">{project.openTasks}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`visibility.${project.visibility}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {teamProjects.length === 0 ? <TableEmpty>{t("projects.empty")}</TableEmpty> : null}
          </TableBody>
        </Table>
      </TableCard>
      </Section>

      {seesBacklog ? (
        <Section title={t("teams.backlog")} count={backlogTotal || undefined} action={<ViewTabs current={backlogView} />}>
          {backlogTotal > backlog.length ? <p className="text-sm text-muted-foreground">{t("list.truncated", { shown: backlog.length, total: backlogTotal })}</p> : null}
          {backlogView === "table" ? (
            <TaskTableView tasks={backlog} options={listOptions} initialFilters={filters} initialSort={sort} selfId={user.person.id} today={today} canContribute={contribute} logged={logged} scope={scope} />
          ) : backlogView === "board" ? (
            <BoardView tasks={backlog} options={listOptions} initialFilters={filters} selfId={user.person.id} today={today} canContribute={contribute} scope={scope} />
          ) : backlogView === "calendar" ? (
            <CalendarView
              tasks={calendarTasks.map((task) => ({ ...task, editable: task.editable && team.isActive }))}
              options={listOptions}
              month={month}
              daysOff={daysOff.map(({ date, name }) => ({ date, name }))}
              initialFilters={filters}
              initialExtra={{ channel: typeof query.channel === "string" ? query.channel : undefined }}
              selfId={user.person.id}
              today={today}
              scope={contribute ? scope : undefined}
            />
          ) : (
            <TaskListView
              tasks={backlog}
              options={listOptions}
              scope={scope}
              initialFilters={filters}
              initialGrouping={grouping}
              initialSort={sort}
              selfId={user.person.id}
              today={today}
              canContribute={contribute}
              // One's own view is one's own to change; a shared one of somebody else's, the team's leads'.
              savedViews={views.map((view) => ({ id: view.id, name: view.name, isShared: view.isShared, mine: view.ownerPersonId === user.person.id, canEdit: view.ownerPersonId === user.person.id || admin, canDelete: view.ownerPersonId === user.person.id || admin, filters: view.filters }))}
            />
          )}
        </Section>
      ) : null}

      {seesBacklog ? (
        <Section title={t("recurrence.heading")} count={recurrences.filter((row) => row.isActive).length || undefined}>
          <RecurrenceManager
            target={{ teamId: team.id }}
            recurrences={recurrences.map(({ id, title, rule, startDate, endDate, leadDays, onDayOff, isActive, draft, assigneeName, nextDate, made }) => ({ id, title, rule, startDate, endDate, leadDays, onDayOff, isActive, assigneePersonId: draft.assigneePersonId ?? null, estimateMinutes: draft.estimateMinutes ?? null, assigneeName, nextDate, made }))}
            people={assignable}
            canManage={contribute}
            today={today}
          />
        </Section>
      ) : null}

      {deleted.length ? (
        <Section title={t("deleted.title", { count: deleted.length })}>
          <DeletedTasks tasks={deleted.map(({ id, key, title, deletedAt, deletedByPersonId, deletedByName, subtasks }) => ({ id, key, title, deletedAt: deletedAt.toISOString(), deletedByPersonId, deletedByName, subtasks }))} days={RESTORE_WINDOW_DAYS} />
        </Section>
      ) : null}

      <Section title={t("members.title")} count={members.length || undefined}>
        {/* A lead adds people from the team's own place; anyone else takes `work:manage` over where they sit. */}
        {admin && addable.narrowed ? <p className="text-xs text-muted-foreground">{t("members.narrowed")}</p> : null}
        <MemberManager members={members} people={addable.people} canManage={admin} target={{ teamId: team.id }} />
      </Section>

      <Section title={t("states.title")}>
        <p className="text-xs text-muted-foreground">{t("states.description")}</p>
        <StateManager teamId={team.id} states={states.map(({ id, name, category, sortOrder, isActive }) => ({ id, name, category, sortOrder, isActive }))} canManage={admin} />
        {admin ? <SaveWorkflowToLibrary teamId={team.id} teamName={team.name} /> : null}
      </Section>

      <Section title={tChecklists("title")}>
        <p className="text-xs text-muted-foreground">{tChecklists("description")}</p>
        <StageChecklists states={states.filter((state) => state.isActive).map(({ id, name }) => ({ id, name }))} hooks={stageHooks.map(({ stateId, checklistId, required }) => ({ stateId, checklistId, required }))} choices={checklists} canManage={admin} />
      </Section>

      <Section title={t("labels.title")}>
        <LabelManager teamId={team.id} labels={labels.map(({ id, teamId: owner, name, color }) => ({ id, teamId: owner, name, color }))} canManage={admin} />
      </Section>

      <Section title={t("customFields.title")}>
        <CustomFieldManager teamId={team.id} projectId={null} fields={fields} canManage={canManageCustomFields(viewer, facts)} />
      </Section>

      <Section title={t("intake.title")}>
        <IntakeFormManager teamId={team.id} forms={intakeForms.map(({ id, name, description, projectId, audience, fields, checklistIds, isActive, submissions }) => ({ id, name, description, projectId, audience, fields, checklistIds, isActive, submissions }))} projects={intakeProjects} checklists={checklists} canManage={admin} />
      </Section>

      <DailyRulesSection teamId={team.id} canManage={admin} />
    </Page>
  );
}
