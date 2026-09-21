import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { canManageWorkspace, canViewTeam, listClients, listCreateTargets, listTeams, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { ProjectForm } from "@/modules/work/ui/project-forms";
import { TeamForm } from "@/modules/work/ui/team-forms";

export const metadata: Metadata = { title: "Work" };

export default async function WorkPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const t = await getTranslations("work");
  const today = todayInVietnam();
  const [allTeams, projects, targets, clients] = await Promise.all([listTeams(), visibleProjects(viewer, { today }), listCreateTargets(viewer), listClients({ activeOnly: true })]);
  const teams = allTeams.filter((team) => team.isActive && canViewTeam(viewer, teamFacts(team)));
  const mine = teams.filter((team) => viewer.teamRoles.has(team.id));
  const others = teams.filter((team) => !viewer.teamRoles.has(team.id));
  const projectTeams = targets.teams.filter((team) => team.canCreateProject);
  const canCreateTeam = canManageWorkspace(viewer);
  const [entities, departments, people] = canCreateTeam || projectTeams.length ? await Promise.all([listEntities(), unitChoices(), listPersonNames()]) : [[], [], []];

  const teamCard = (team: (typeof teams)[number]) => (
    <li key={team.id}>
      <Link href={`/work/teams/${team.id}`} className="flex h-full flex-col gap-1 rounded-xl border p-4 hover:bg-muted/50">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="font-mono text-xs text-muted-foreground">{team.key}</span> {team.name}
          {viewer.teamRoles.get(team.id) === "lead" ? <Badge variant="secondary">{t("members.roles.lead")}</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {team.entityName ?? t("teams.wholeGroup")} · {t("teams.memberCount", { count: team.memberCount })}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <nav className="tab-row">
          <Link href="/tasks" className="underline">
            {t("myWork")}
          </Link>
          <Link href="/work/calendar" className="underline">
            {t("calendar.title")}
          </Link>
          <Link href="/work/leader" className="underline">
            {t("leader.title")}
          </Link>
          {[...viewer.teamRoles.values()].includes("lead") || canManageWorkspace(viewer) ? (
            <Link href="/work/workload" className="underline">
              {t("workload.title")}
            </Link>
          ) : null}
          <Link href="/work/intake" className="underline">
            {t("intake.title")}
          </Link>
          <Link href="/work/templates" className="underline">
            {t("templates.title")}
          </Link>
          {viewer.principal.workforceType === "collaborator" ? null : (
            <Link href="/work/clients" className="underline">
              {t("clients.title")}
            </Link>
          )}
        </nav>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("projects.title")}</h2>
        {projects.length === 0 ? <p className="text-sm text-muted-foreground">{t("projects.empty")}</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/work/projects/${project.id}`} className="flex h-full flex-col gap-2 rounded-xl border p-4 hover:bg-muted/50">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {project.name}
                  {project.visibility === "private" ? <Badge variant="outline">{t("visibility.private")}</Badge> : null}
                  {project.status === "active" ? null : <Badge variant="secondary">{t(`projects.status.${project.status}`)}</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{[project.teamName, project.clientName, project.leadName].filter(Boolean).join(" · ")}</span>
                <span className="mt-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{t("projects.open", { count: project.openTasks })}</span>
                  <span>{t("projects.done", { count: project.doneTasks })}</span>
                  {project.overdueTasks > 0 ? <span className="font-medium text-destructive">{t("projects.overdue", { count: project.overdueTasks })}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {projectTeams.length ? (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("projects.create")}</summary>
            <div className="pt-4">
              <ProjectForm teams={projectTeams.map((team) => ({ id: team.id, name: team.name, defaultVisibility: team.defaultVisibility }))} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("teams.mine")}</h2>
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("teams.mineEmpty")}</p> : <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map(teamCard)}</ul>}
        {others.length ? (
          <>
            <h2 className="pt-2 text-sm font-medium text-muted-foreground">{t("teams.others")}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{others.map(teamCard)}</ul>
          </>
        ) : null}
        {canCreateTeam ? (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("teams.create")}</summary>
            <div className="pt-4">
              <TeamForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} />
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
