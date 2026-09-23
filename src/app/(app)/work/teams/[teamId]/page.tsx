import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { DailyRulesSection } from "@/modules/daily/ui/team-rules-section";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { readFilters, readGrouping, readSort } from "@/modules/work/engine/filter";
import { addableMembers, canAdminTeam, canContributeToTeam, canManageWorkspace, canViewTeam, canViewTeamBacklog, findTeam, listAssignable, listClients, listTeamIntakeForms, listLabels, listStates, listTeamBacklog, listTeamMembers, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { canManageCustomFields, canSeeLoggedTime, canViewTriage, countTriage, listCustomFields, loggedMinutesByTask, toFieldViews } from "@/modules/work/service";
import { CustomFieldManager } from "@/modules/work/ui/custom-fields";
import { ViewTabs } from "@/modules/work/ui/filter-bar";
import { TaskTableView } from "@/modules/work/ui/task-table-view";
import { IntakeFormManager } from "@/modules/work/ui/intake-forms";
import { canViewAutomations, listOpenCycles } from "@/modules/work/service";
import { LabelManager, MemberManager, StateManager, TeamForm } from "@/modules/work/ui/team-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("team");

export default async function TeamPage({ params, searchParams }: PageProps<"/work/teams/[teamId]">) {
  const user = await requireUser();
  const { teamId } = await params;
  const query = await searchParams;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const facts = teamFacts(team);
  const admin = canAdminTeam(viewer, facts);
  const seesBacklog = canViewTeamBacklog(viewer, facts);
  const today = todayInVietnam();

  const [members, states, labels, projects, backlog, clients, assignable, intakeForms, [addable, entities, departments]] = await Promise.all([
    listTeamMembers(team.id),
    listStates([team.id]),
    listLabels([team.id]),
    visibleProjects(viewer, { today }),
    seesBacklog ? listTeamBacklog(team.id) : [],
    listClients({ activeOnly: true }),
    listAssignable(team.id, null),
    listTeamIntakeForms(team.id),
    // The picker offers only the people this viewer may actually add (`canAddTeamMember`).
    admin ? Promise.all([addableMembers(viewer, facts), listEntities(), unitChoices()]) : ([{ people: [], narrowed: false }, [], []] as [Awaited<ReturnType<typeof addableMembers>>, Awaited<ReturnType<typeof listEntities>>, Awaited<ReturnType<typeof unitChoices>>]),
  ]);
  const [fieldRows, triageCounts] = await Promise.all([listCustomFields({ teamId: team.id }, { includeInactive: true }), canViewTriage(viewer, facts) ? countTriage([team.id]) : null]);
  const fields = toFieldViews(fieldRows);
  // FR-PJM-10: the team's open cycles, for the filter and bulk edit.
  const cycles = (await listOpenCycles([team.id])).map((cycle) => ({ id: cycle.id, label: t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") }) }));
  const backlogView = query.view === "table" ? "table" : "list";
  const logged = seesBacklog && backlogView === "table" && canSeeLoggedTime(viewer, { team: facts, project: null }) ? Object.fromEntries(await loggedMinutesByTask(backlog.map((task) => task.id))) : null;
  const intakeProjects = projects.filter((project) => project.teamId === team.id && project.status !== "archived" && project.status !== "done").map(({ id, name }) => ({ id, name }));
  const filters = readFilters(query);
  const grouping = readGrouping(query.group);
  const sort = readSort(query.sort);

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base text-muted-foreground">{team.key}</span> {team.name}
          {team.isActive ? null : <Badge variant="outline">{t("teams.inactive")}</Badge>}
        </h1>
        {team.description ? <p className="text-sm text-muted-foreground">{team.description}</p> : null}
        <p className="flex flex-wrap gap-x-4 pt-1 text-sm">
          {triageCounts ? (
            <Link href={`/work/teams/${team.id}/triage`} className="underline">
              {t("teams.triageCount", { count: triageCounts.get(team.id) ?? 0 })}
            </Link>
          ) : null}
          <Link href={`/work/teams/${team.id}/cycles`} className="underline">
            {t("cycles.title")}
          </Link>
          <Link href={`/work/teams/${team.id}/handoffs`} className="underline">
            {t("handoff.packages.title")}
          </Link>
          <Link href={`/work/teams/${team.id}/reviews`} className="underline">
            {t("chains.title")}
          </Link>
          {canViewAutomations(viewer, facts) ? (
            <Link href={`/work/teams/${team.id}/automations`} className="underline">
              {t("automations.title")}
            </Link>
          ) : null}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("projects.title")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {projects
            .filter((project) => project.teamId === team.id)
            .map((project) => (
              <li key={project.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Link href={`/work/projects/${project.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {project.name}
                </Link>
                <span className="text-xs text-muted-foreground">{t("projects.open", { count: project.openTasks })}</span>
                <Badge variant="outline">{t(`visibility.${project.visibility}`)}</Badge>
              </li>
            ))}
          {projects.every((project) => project.teamId !== team.id) ? <li className="p-3 text-sm text-muted-foreground">{t("projects.empty")}</li> : null}
        </ul>
      </section>

      {seesBacklog ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("teams.backlog")}</h2>
          <ViewTabs current={backlogView} views={["list", "table"]} />
          {backlogView === "table" ? (
            <TaskTableView
              tasks={backlog}
              options={{ states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields: fields.filter((field) => field.projectId === null), cycles }}
              initialFilters={filters}
              initialSort={sort}
              selfId={user.person.id}
              today={today}
              canContribute={canContributeToTeam(viewer, facts)}
              logged={logged}
            />
          ) : (
            <TaskListView
              tasks={backlog}
              options={{ states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields: fields.filter((field) => field.projectId === null), cycles }}
              scope={{ teamId: team.id, projectId: null }}
              initialFilters={filters}
              initialGrouping={grouping}
              initialSort={sort}
              selfId={user.person.id}
              today={today}
              canContribute={canContributeToTeam(viewer, facts)}
            />
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("members.title")}</h2>
        {/* A lead adds people from the team's own place; anyone else takes `work:manage` over where they sit. */}
        {admin && addable.narrowed ? <p className="text-xs text-muted-foreground">{t("members.narrowed")}</p> : null}
        <MemberManager members={members} people={addable.people} canManage={admin} target={{ teamId: team.id }} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("states.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("states.description")}</p>
        <StateManager teamId={team.id} states={states.map(({ id, name, category, sortOrder, isActive }) => ({ id, name, category, sortOrder, isActive }))} canManage={admin} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("labels.title")}</h2>
        <LabelManager teamId={team.id} labels={labels.map(({ id, teamId: owner, name, color }) => ({ id, teamId: owner, name, color }))} canManage={admin} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("customFields.title")}</h2>
        <CustomFieldManager teamId={team.id} projectId={null} fields={fields} canManage={canManageCustomFields(viewer, facts)} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("intake.title")}</h2>
        <IntakeFormManager teamId={team.id} forms={intakeForms.map(({ id, name, description, projectId, audience, fields, isActive, submissions }) => ({ id, name, description, projectId, audience, fields, isActive, submissions }))} projects={intakeProjects} canManage={admin} />
      </section>

      <DailyRulesSection teamId={team.id} canManage={admin} />

      {admin ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("teams.settings")}</h2>
          <TeamForm team={team} entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} />
        </section>
      ) : null}
    </div>
  );
}
