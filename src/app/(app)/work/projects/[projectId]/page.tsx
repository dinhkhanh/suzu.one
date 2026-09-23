import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { getDaysOff } from "@/modules/attendance/service";
import { isMonthKey, monthGrid } from "@/modules/work/engine/calendar";
import { readFilters, readGrouping, readSort } from "@/modules/work/engine/filter";
import { canContributeToProject, canManageProject, canViewProject, findProject, listAssignable, listClients, listLabels, listProjectMembers, listProjectTasks, listRecurrences, listSavedViews, listStates, listWorkTemplates, loadViewer, projectFacts, withEditable, WORK_VIEWS, type WorkView } from "@/modules/work/service";
import { canManageCustomFields, canSeeLoggedTime, listCustomFields, listOpenCycles, loggedMinutesByTask, teamFacts, toFieldViews } from "@/modules/work/service";
import { automationPanel, canManageAutomations, canManageReviewChains, canViewAutomations, contentCalendar, listReviewChains } from "@/modules/work/service";
import { AutomationManager } from "@/modules/work/ui/automations";
import { ReviewChainManager } from "@/modules/work/ui/review-chains";
import { CustomFieldManager } from "@/modules/work/ui/custom-fields";
import { TaskTableView } from "@/modules/work/ui/task-table-view";
import { BoardView } from "@/modules/work/ui/board-view";
import { CalendarView } from "@/modules/work/ui/calendar-view";
import { ViewTabs } from "@/modules/work/ui/filter-bar";
import { RecurrenceManager, TemplateUseForm } from "@/modules/work/ui/planning-forms";
import { ProjectForm } from "@/modules/work/ui/project-forms";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { auditPrivateRead } from "@/modules/projects/service";
import { ProjectTabs } from "@/modules/projects/ui/project-tabs";
import { MemberManager } from "@/modules/work/ui/team-forms";

export const metadata: Metadata = { title: "Project" };

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
  await auditPrivateRead(user, viewer, facts, project.name);
  const t = await getTranslations("work");
  const manage = canManageProject(viewer, facts);
  const today = todayInVietnam();

  const [views, tasks, states, labels, clients, members, assignable, people, recurrences, templates, fieldRows] = await Promise.all([
    listSavedViews(project.id, user.person.id),
    listProjectTasks(project.id),
    listStates([team.id]),
    listLabels([team.id]),
    listClients({ activeOnly: true }),
    listProjectMembers(project.id),
    listAssignable(team.id, project.id),
    manage ? listPersonNames() : [],
    listRecurrences(project.id, today),
    listWorkTemplates([team.id], { activeOnly: true }),
    listCustomFields({ teamId: team.id, projectId: project.id }, { includeInactive: true }),
  ]);
  const [chains, automations] = await Promise.all([listReviewChains({ teamId: team.id, projectId: project.id }), canViewAutomations(viewer, teamFacts(team)) ? automationPanel({ teamId: team.id, projectId: project.id }, viewer) : null]);
  const filters = readFilters(query);
  const grouping = readGrouping(query.group);
  const sort = readSort(query.sort);
  const fields = toFieldViews(fieldRows);
  const clientName = clients.find((client) => client.id === project.clientId)?.name;
  const view: WorkView = WORK_VIEWS.includes(query.view as WorkView) ? (query.view as WorkView) : "list";
  // FR-PJM-10: the owning team's open cycles, for the filter and bulk edit.
  const cycles = (await listOpenCycles([team.id])).map((cycle) => ({ id: cycle.id, label: t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") }) }));
  const options = { states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields, cycles };
  const canContribute = canContributeToProject(viewer, facts) && project.status !== "archived";
  // Logged time per task is for the project's lead and the team's leads (PJM access rules).
  const logged = view === "table" && canSeeLoggedTime(viewer, { team: teamFacts(team), project: facts }) ? Object.fromEntries(await loggedMinutesByTask(tasks.map((task) => task.id))) : null;
  const month = isMonthKey(query.month) ? query.month : today.slice(0, 7);
  const grid = monthGrid(month);
  const [calendarTasks, daysOff, content] = view === "calendar" ? await Promise.all([withEditable(viewer, tasks), getDaysOff(project.entityId ?? team.entityId, grid.from, grid.to), contentCalendar(viewer, { ...grid, projectId: project.id }, tasks.filter((task) => task.dueDate && task.dueDate >= grid.from && task.dueDate <= grid.to))]) : [[], [], null];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
          {" / "}
          <Link href={`/work/teams/${team.id}`} className="underline">
            {team.name}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {project.name}
          <Badge variant="outline">{t(`visibility.${project.visibility}`)}</Badge>
          {project.status === "active" ? null : <Badge variant="secondary">{t(`projects.status.${project.status}`)}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">{[clientName, project.description].filter(Boolean).join(" · ")}</p>
      </header>

      <ProjectTabs projectId={project.id} current="tasks" />
      <ViewTabs current={view} />
      {view === "table" ? (
        <TaskTableView tasks={tasks} options={options} initialFilters={filters} initialSort={sort} selfId={user.person.id} today={today} canContribute={canContribute} logged={logged} />
      ) : view === "board" ? (
        <BoardView tasks={tasks} options={options} initialFilters={filters} selfId={user.person.id} today={today} canContribute={canContribute} />
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
          savedViews={views.map((view) => ({ id: view.id, name: view.name, isShared: view.isShared, mine: view.ownerPersonId === user.person.id, canDelete: view.ownerPersonId === user.person.id || manage, filters: view.filters }))}
        />
      )}

      <details className="rounded-xl border p-4" open={recurrences.length > 0 && typeof query.planning === "string"}>
        <summary className="cursor-pointer text-sm font-medium">{t("projects.planning", { count: recurrences.filter((row) => row.isActive).length })}</summary>
        <div className="flex flex-col gap-6 pt-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("recurrence.heading")}</h2>
            <RecurrenceManager
              projectId={project.id}
              recurrences={recurrences.map(({ id, title, rule, startDate, endDate, isActive, assigneeName, nextDate, made }) => ({ id, title, rule, startDate, endDate, isActive, assigneeName, nextDate, made }))}
              people={assignable}
              canManage={canContribute}
              today={today}
            />
          </section>
          {canContribute ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("templates.addToProject")}</h2>
              <TemplateUseForm templates={templates.filter((template) => template.items.length > 0).map(({ id, name, ownerId, roleKeys }) => ({ id, name, ownerId, roleKeys }))} projectId={project.id} peopleByTeam={{ "": assignable }} today={today} />
            </section>
          ) : null}
        </div>
      </details>

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">{t("projects.membersAndSettings", { count: members.length })}</summary>
        <div className="flex flex-col gap-6 pt-4">
          <MemberManager members={members} people={people} canManage={manage} target={{ projectId: project.id }} />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("customFields.title")}</h2>
            <CustomFieldManager teamId={team.id} projectId={project.id} fields={fields} canManage={canManageCustomFields(viewer, teamFacts(team), facts)} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("chains.title")}</h2>
            <ReviewChainManager teamId={team.id} projectId={project.id} chains={chains.map(({ id, name, projectId: chainProject, contentFormat, isActive, stages }) => ({ id, name, projectId: chainProject, contentFormat, isActive, stages }))} people={assignable} canManage={canManageReviewChains(viewer, teamFacts(team), facts)} />
          </section>
          {automations ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("automations.title")}</h2>
              <AutomationManager teamId={team.id} projectId={project.id} rules={automations.rules} options={automations.options} runs={automations.runs} canManage={canManageAutomations(viewer, teamFacts(team), facts)} />
            </section>
          ) : null}
          {manage ? <ProjectForm project={project} teams={[]} clients={clients.map(({ id, name }) => ({ id, name }))} people={assignable} /> : null}
        </div>
      </details>
    </div>
  );
}
