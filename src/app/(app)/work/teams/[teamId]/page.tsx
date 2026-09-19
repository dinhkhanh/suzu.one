import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listDepartments, listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { FILTER_KEYS, GROUPINGS, type Grouping, type TaskFilters } from "@/modules/work/engine/filter";
import { canAdminTeam, canContributeToTeam, canManageWorkspace, canViewTeam, canViewTeamBacklog, findTeam, listAssignable, listClients, listTeamIntakeForms, listLabels, listStates, listTeamBacklog, listTeamMembers, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { IntakeFormManager } from "@/modules/work/ui/intake-forms";
import { LabelManager, MemberManager, StateManager, TeamForm } from "@/modules/work/ui/team-forms";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params, searchParams }: PageProps<"/work/teams/[teamId]">) {
  const user = await requireUser();
  const { teamId } = await params;
  const query = await searchParams;
  const team = /^[0-9a-f-]{36}$/.test(teamId) ? await findTeam(teamId) : undefined;
  const viewer = await loadViewer(user);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const t = await getTranslations("work");
  const facts = teamFacts(team);
  const admin = canAdminTeam(viewer, facts);
  const seesBacklog = canViewTeamBacklog(viewer, facts);
  const today = todayInVietnam();

  const [members, states, labels, projects, backlog, clients, assignable] = await Promise.all([
    listTeamMembers(team.id),
    listStates([team.id]),
    listLabels([team.id]),
    visibleProjects(viewer, { today }),
    seesBacklog ? listTeamBacklog(team.id) : [],
    listClients({ activeOnly: true }),
    listAssignable(team.id, null),
  ]);
  const intakeForms = await listTeamIntakeForms(team.id);
  const intakeProjects = projects.filter((project) => project.teamId === team.id && project.status !== "archived" && project.status !== "done").map(({ id, name }) => ({ id, name }));
  const [people, entities, departments] = admin ? await Promise.all([listPersonNames(), listEntities(), listDepartments()]) : [[], [], []];
  const filters: TaskFilters = Object.fromEntries(FILTER_KEYS.flatMap((key) => (typeof query[key] === "string" ? [[key, query[key]]] : [])));
  const grouping = GROUPINGS.includes(query.group as Grouping) ? (query.group as Grouping) : "none";

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          <span className="font-mono text-base text-muted-foreground">{team.key}</span> {team.name}
          {team.isActive ? null : <Badge variant="outline">{t("teams.inactive")}</Badge>}
        </h1>
        {team.description ? <p className="text-sm text-muted-foreground">{team.description}</p> : null}
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
          <TaskListView
            tasks={backlog}
            options={{ states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })) }}
            scope={{ teamId: team.id, projectId: null }}
            initialFilters={filters}
            initialGrouping={grouping}
            selfId={user.person.id}
            today={today}
            canContribute={canContributeToTeam(viewer, facts)}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("members.title")}</h2>
        <MemberManager members={members} people={people} canManage={admin} target={{ teamId: team.id }} />
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
        <h2 className="text-sm font-medium text-muted-foreground">{t("intake.title")}</h2>
        <IntakeFormManager teamId={team.id} forms={intakeForms.map(({ id, name, description, projectId, fields, isActive, submissions }) => ({ id, name, description, projectId, fields, isActive, submissions }))} projects={intakeProjects} canManage={admin} />
      </section>

      {admin ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("teams.settings")}</h2>
          <TeamForm team={team} entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments.filter((department) => department.isActive).map(({ id, name }) => ({ id, name }))} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} />
        </section>
      ) : null}
    </div>
  );
}
