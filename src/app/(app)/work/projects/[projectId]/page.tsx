import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { getDaysOff } from "@/modules/attendance/service";
import { isMonthKey, monthGrid } from "@/modules/work/engine/calendar";
import { readFilters, readGrouping, readSort, taskSliceFor } from "@/modules/work/engine/filter";
import { canContributeToProject, canManageProject, canViewProject, findProject, listAssignable, listClients, listDeletedTasks, listLabels, listProjectMembers, listRecurrences, listTaskSlice, listSavedViews, listStates, listWorkTemplates, loadViewer, projectFacts, RESTORE_WINDOW_DAYS, withEditable, WORK_VIEWS, type WorkView } from "@/modules/work/service";
import { canManageCustomFields, canSeeLoggedTime, listCustomFields, listOpenCycles, loggedMinutesByTask, teamFacts, toFieldViews } from "@/modules/work/service";
import { automationPanel, canManageAutomations, canManageReviewChains, canViewAutomations, contentCalendar, listReviewChains, projectStatusChoices, projectStatusNames } from "@/modules/work/service";
import { AutomationManager } from "@/modules/work/ui/automations";
import { ReviewChainManager } from "@/modules/work/ui/review-chains";
import { CustomFieldManager } from "@/modules/work/ui/custom-fields";
import { TaskTableView } from "@/modules/work/ui/task-table-view";
import { BoardView } from "@/modules/work/ui/board-view";
import { CalendarView } from "@/modules/work/ui/calendar-view";
import { ViewTabs } from "@/modules/work/ui/filter-bar";
import { RecurrenceManager, TemplateUseForm } from "@/modules/work/ui/planning-forms";
import { accentOf } from "@/modules/work/enums";
import { ArchiveButton, EditProjectButton } from "@/modules/work/ui/edit-dialogs";
import { ProjectPoster } from "@/modules/work/ui/project-poster";
import { ColorSquare } from "@/modules/work/ui/task-row";
import { DeletedTasks } from "@/modules/work/ui/deleted-tasks";
import { ProjectStatusBadge } from "@/modules/work/ui/status-badge";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { auditPrivateRead } from "@/modules/projects/service";
import { ProjectTabs } from "@/modules/projects/ui/project-tabs";
import { MemberManager } from "@/modules/work/ui/team-forms";
import { digitalAssetsByProject, listLinkableDigitalAssets } from "@/modules/work/service";
import { DigitalAssetChips, ProjectDigitalAssets } from "@/modules/work/ui/digital-assets";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("project");

const DETAILS_SUMMARY = "flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium select-none hover:bg-canvas [&::-webkit-details-marker]:hidden";

export default async function ProjectPage({ params, searchParams }: PageProps<"/work/projects/[projectId]">) {
  const user = await requireUser();
  const { projectId } = await params;
  const query = await searchParams;
  const [found, viewer] = await Promise.all([/^[0-9a-f-]{36}$/.test(projectId) ? findProject(projectId) : undefined, loadViewer(user)]);
  // A project the viewer may not open does not exist, as far as they can tell.
  if (!found || !canViewProject(viewer, projectFacts(found.project, found.team))) notFound();
  const { project, team } = found;
  const facts = projectFacts(project, team);
  // A leader looking into a private project they are none of the people of leaves a trail (Q25).
  await auditPrivateRead(viewer, facts);
  const t = await getTranslations("work");
  const manage = canManageProject(viewer, facts);
  const today = todayInVietnam();
  const filters = readFilters(query);
  const view: WorkView = WORK_VIEWS.includes(query.view as WorkView) ? (query.view as WorkView) : "list";
  const month = isMonthKey(query.month) ? query.month : today.slice(0, 7);
  const grid = monthGrid(month);

  const [views, { items: tasks, total: taskTotal }, states, labels, clients, members, assignable, people, recurrences, templates, fieldRows, deleted] = await Promise.all([
    listSavedViews({ projectId: project.id }, user.person.id),
    // PERF-03: open work, and closed work only as far as this view shows it.
    listTaskSlice({ projectId: project.id }, taskSliceFor(view, filters, today, grid)),
    listStates([team.id]),
    listLabels([team.id]),
    listClients({ activeOnly: true }),
    listProjectMembers(project.id),
    listAssignable(team.id, project.id),
    manage ? listPersonNames() : [],
    listRecurrences({ projectId: project.id }, today),
    listWorkTemplates([team.id], { activeOnly: true }),
    listCustomFields({ teamId: team.id, projectId: project.id }, { includeInactive: true }),
    // Recently deleted, for the people who run the project: they may put a task back (FR-WRK-03).
    manage ? listDeletedTasks({ projectId: project.id }) : [],
  ]);
  const [chains, automations] = await Promise.all([listReviewChains({ teamId: team.id, projectId: project.id }), canViewAutomations(viewer, teamFacts(team)) ? automationPanel({ teamId: team.id, projectId: project.id }, viewer) : null]);
  const [statusChoices, statusNames] = await Promise.all([projectStatusChoices(team.projectStatusSetId, project.statusId), projectStatusNames()]);
  // FR-AST-09: the pages and channels the project produces for.
  const [digitalAssets, digitalOptions] = await Promise.all([digitalAssetsByProject([project.id]).then((byProject) => byProject.get(project.id) ?? []), manage ? listLinkableDigitalAssets() : []]);
  const chip = ({ id, name, platform, status }: (typeof digitalAssets)[number]) => ({ id, name, platform, status });
  const statusName = project.statusId ? statusNames.get(project.statusId) : undefined;
  const grouping = readGrouping(query.group);
  const sort = readSort(query.sort);
  const fields = toFieldViews(fieldRows);
  const clientName = clients.find((client) => client.id === project.clientId)?.name;
  // FR-PJM-10: the owning team's open cycles, for the filter and bulk edit.
  const cycles = (await listOpenCycles([team.id])).map((cycle) => ({ id: cycle.id, label: t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") }) }));
  const options = { states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields, cycles };
  const canContribute = canContributeToProject(viewer, facts) && project.status !== "archived";
  // Logged time per task is for the project's lead and the team's leads (PJM access rules).
  const logged = view === "table" && canSeeLoggedTime(viewer, { team: teamFacts(team), project: facts }) ? Object.fromEntries(await loggedMinutesByTask(tasks.map((task) => task.id))) : null;
  const [calendarTasks, daysOff, content] = view === "calendar" ? await Promise.all([withEditable(viewer, tasks), getDaysOff(project.entityId ?? team.entityId, grid.from, grid.to), contentCalendar(viewer, { ...grid, projectId: project.id }, tasks.filter((task) => task.dueDate && task.dueDate >= grid.from && task.dueDate <= grid.to))]) : [[], [], null];

  return (
    <Page width="wide" data-accent={accentOf(project.color, team.color)}>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <Link href="/work" className="hover:underline">
              {t("title")}
            </Link>
            <span className="text-faint">/</span>
            <RecordLink kind="team" id={team.id}>
              {team.name}
            </RecordLink>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <ProjectPoster project={project} />
            <ColorSquare color={accentOf(project.color, team.color)} className="size-2.5 rounded-[3px]" />
            {project.name}
            <Badge variant="outline">{t(`visibility.${project.visibility}`)}</Badge>
            <ProjectStatusBadge status={project.status} name={statusName ?? t(`projects.status.${project.status}`)} />
          </span>
        }
        description={
          clientName || project.description ? (
            <>
              {clientName ? <RecordLink kind="account" id={project.clientId}>{clientName}</RecordLink> : null}
              {clientName && project.description ? " · " : null}
              {project.description}
            </>
          ) : undefined
        }
        actions={
          manage ? (
            <>
              <EditProjectButton project={project} clients={clients.map(({ id, name }) => ({ id, name }))} people={assignable} statuses={statusChoices} />
              <ArchiveButton target={{ projectId: project.id }} name={project.name} archived={project.status === "archived"} />
            </>
          ) : undefined
        }
      >
        <DigitalAssetChips assets={digitalAssets.map(chip)} />
      </PageHeader>

      <ProjectTabs projectId={project.id} current={view === "board" ? "board" : "tasks"} />
      <Section>
        <ViewTabs current={view} />
        {taskTotal > tasks.length ? <p className="text-sm text-muted-foreground">{t("list.truncated", { shown: tasks.length, total: taskTotal })}</p> : null}
      {view === "table" ? (
        <TaskTableView tasks={tasks} options={options} initialFilters={filters} initialSort={sort} selfId={user.person.id} today={today} canContribute={canContribute} logged={logged} scope={{ teamId: team.id, projectId: project.id }} />
      ) : view === "board" ? (
        <BoardView tasks={tasks} options={options} initialFilters={filters} selfId={user.person.id} today={today} canContribute={canContribute} scope={{ teamId: team.id, projectId: project.id }} />
      ) : view === "calendar" ? (
        <CalendarView
          tasks={calendarTasks.map((task) => ({ ...task, editable: task.editable && project.status !== "archived" }))}
          options={options}
          month={month}
          daysOff={daysOff.map(({ date, name }) => ({ date, name }))}
          initialFilters={filters}
          initialExtra={{ channel: typeof query.channel === "string" ? query.channel : undefined }}
          selfId={user.person.id}
          today={today}
          posts={content?.posts}
          missingTaskIds={content?.missingTaskIds}
          scope={canContribute ? { teamId: team.id, projectId: project.id } : undefined}
        />
      ) : (
        <TaskListView
          tasks={tasks}
          options={options}
          scope={{ teamId: team.id, projectId: project.id }}
          initialFilters={filters}
          initialGrouping={grouping}
          initialSort={sort}
          selfId={user.person.id}
          today={today}
          canContribute={canContribute}
          // One's own view is one's own to change; a shared one of somebody else's, the project's leads'.
          savedViews={views.map((view) => ({ id: view.id, name: view.name, isShared: view.isShared, mine: view.ownerPersonId === user.person.id, canEdit: view.ownerPersonId === user.person.id || manage, canDelete: view.ownerPersonId === user.person.id || manage, filters: view.filters }))}
        />
      )}
      </Section>

      <details className="group/details rounded-[14px] border border-border bg-background" open={recurrences.length > 0 && typeof query.planning === "string"}>
        <summary className={DETAILS_SUMMARY}>
          <ChevronRightIcon className="size-4 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/details:rotate-90" />
          {t("projects.planning", { count: recurrences.filter((row) => row.isActive).length })}
        </summary>
        <div className="flex flex-col gap-6 border-t p-4">
          <section className="flex flex-col gap-2">
            <h2 className="section-label">{t("recurrence.heading")}</h2>
            <RecurrenceManager
              target={{ projectId: project.id }}
              recurrences={recurrences.map(({ id, title, rule, startDate, endDate, leadDays, onDayOff, isActive, draft, assigneeName, nextDate, made }) => ({ id, title, rule, startDate, endDate, leadDays, onDayOff, isActive, assigneePersonId: draft.assigneePersonId ?? null, estimateMinutes: draft.estimateMinutes ?? null, assigneeName, nextDate, made }))}
              people={assignable}
              canManage={canContribute}
              today={today}
            />
          </section>
          {canContribute ? (
            <section className="flex flex-col gap-2">
              <h2 className="section-label">{t("templates.addToProject")}</h2>
              <TemplateUseForm templates={templates.filter((template) => template.items.length > 0).map(({ id, name, ownerId, roleKeys }) => ({ id, name, ownerId, roleKeys }))} projectId={project.id} peopleByTeam={{ "": assignable }} today={today} />
            </section>
          ) : null}
        </div>
      </details>

      {manage && deleted.length ? (
        <details className="group/details rounded-[14px] border border-border bg-background">
          <summary className={DETAILS_SUMMARY}>
            <ChevronRightIcon className="size-4 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/details:rotate-90" />
            {t("deleted.title", { count: deleted.length })}
          </summary>
          <div className="border-t p-4">
            <DeletedTasks tasks={deleted.map(({ id, key, title, deletedAt, deletedByPersonId, deletedByName, subtasks }) => ({ id, key, title, deletedAt: deletedAt.toISOString(), deletedByPersonId, deletedByName, subtasks }))} days={RESTORE_WINDOW_DAYS} />
          </div>
        </details>
      ) : null}

      <details className="group/details rounded-[14px] border border-border bg-background">
        <summary className={DETAILS_SUMMARY}>
          <ChevronRightIcon className="size-4 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/details:rotate-90" />
          {t("projects.membersAndSettings", { count: members.length })}
        </summary>
        <div className="flex flex-col gap-6 border-t p-4">
          <MemberManager members={members} people={people} canManage={manage} target={{ projectId: project.id }} />
          <section className="flex flex-col gap-2">
            <h2 className="section-label">{t("digitalAssets.title")}</h2>
            <ProjectDigitalAssets projectId={project.id} linked={digitalAssets.map(chip)} options={digitalOptions.map(chip)} canManage={manage} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="section-label">{t("customFields.title")}</h2>
            <CustomFieldManager teamId={team.id} projectId={project.id} fields={fields} canManage={canManageCustomFields(viewer, teamFacts(team), facts)} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="section-label">{t("chains.title")}</h2>
            <ReviewChainManager teamId={team.id} projectId={project.id} chains={chains.map(({ id, name, projectId: chainProject, contentFormat, isActive, stages }) => ({ id, name, projectId: chainProject, contentFormat, isActive, stages }))} people={assignable} canManage={canManageReviewChains(viewer, teamFacts(team), facts)} />
          </section>
          {automations ? (
            <section className="flex flex-col gap-2">
              <h2 className="section-label">{t("automations.title")}</h2>
              <AutomationManager teamId={team.id} projectId={project.id} rules={automations.rules} options={automations.options} runs={automations.runs} canManage={canManageAutomations(viewer, teamFacts(team), facts)} />
            </section>
          ) : null}
        </div>
      </details>
    </Page>
  );
}
