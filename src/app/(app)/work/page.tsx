import { ArchiveIcon, ChevronRightIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "cn";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { canManageWorkspace, canViewTeam, listClients, listCreateTargets, listTeams, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { accentOf, projectShelf, type Shelf, teamShelf, type TeamStatus, teamStatusOf } from "@/modules/work/enums";
import { ProjectPoster } from "@/modules/work/ui/project-poster";
import { CreateProjectButton, CreateTeamButton } from "@/modules/work/ui/edit-dialogs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("work");

export default async function WorkPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const t = await getTranslations("work");
  const today = todayInVietnam();
  // Archived projects too: they are shelved apart below, not hidden.
  const [allTeams, projects, targets, clients] = await Promise.all([listTeams(), visibleProjects(viewer, { today, includeArchived: true }), listCreateTargets(viewer), listClients({ activeOnly: true })]);
  const teams = allTeams.filter((team) => canViewTeam(viewer, teamFacts(team)));
  // A project without a colour of its own wears its team's, so the cards of one team read as one.
  const teamColors = new Map(allTeams.map((team) => [team.id, team.color]));
  const teamStatuses = new Map(allTeams.map((team) => [team.id, teamStatusOf(team)]));
  const teamStatus = (teamId: string): TeamStatus => teamStatuses.get(teamId) ?? "active";
  const shelfOfProject = (project: (typeof projects)[number]) => projectShelf(project.status, teamStatus(project.teamId));
  const shelfOfTeam = (team: (typeof teams)[number]) => teamShelf(teamStatusOf(team));
  const projectsOn = (shelf: Shelf) => projects.filter((project) => shelfOfProject(project) === shelf);
  const teamsOn = (shelf: Shelf) => teams.filter((team) => shelfOfTeam(team) === shelf);
  const current = teamsOn("current");
  const mine = current.filter((team) => viewer.teamRoles.has(team.id));
  const others = current.filter((team) => !viewer.teamRoles.has(team.id));
  const projectTeams = targets.teams.filter((team) => team.canCreateProject);
  const canCreateTeam = canManageWorkspace(viewer);
  const [entities, departments, people] = canCreateTeam || projectTeams.length ? await Promise.all([listEntities(), unitChoices(), listPersonNames()]) : [[], [], []];

  // Each shelf looks its part: a set-aside card is dashed and faded, an archived one greyed out and plain.
  const cardClass = (shelf: Shelf, accent: boolean) =>
    cn(
      "flex h-full flex-col rounded-xl border p-4 hover:bg-muted/50",
      shelf === "current" && accent && "border-l-4 border-l-primary",
      shelf === "inactive" && "border-dashed bg-muted/20 opacity-80 hover:opacity-100",
      shelf === "archived" && "border-dashed bg-muted/40 text-muted-foreground grayscale hover:grayscale-0",
    );

  /** Why a card is set aside: its own status, else its team's. */
  const projectBadge = (project: (typeof projects)[number]) => {
    if (project.status === "archived") return <ArchivedBadge label={t("projects.status.archived")} />;
    if (project.status !== "active") return <Badge variant="secondary">{t(`projects.status.${project.status}`)}</Badge>;
    const status = teamStatus(project.teamId);
    return status === "active" ? null : <Badge variant="outline">{t(`shelves.team.${status}`)}</Badge>;
  };

  const projectCard = (project: (typeof projects)[number]) => {
    const shelf = shelfOfProject(project);
    const accent = accentOf(project.color, teamColors.get(project.teamId));
    return (
      <li key={project.id} data-accent={shelf === "current" ? accent : undefined}>
        <Link href={`/work/projects/${project.id}`} className={cn(cardClass(shelf, !!accent), "gap-2")}>
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <ProjectPoster project={project} size="sm" />
            {project.name}
            {project.visibility === "private" ? <Badge variant="outline">{t("visibility.private")}</Badge> : null}
            {projectBadge(project)}
          </span>
          <span className="text-xs text-muted-foreground">{[project.teamName, project.clientName, project.leadName].filter(Boolean).join(" · ")}</span>
          <span className="mt-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{t("projects.open", { count: project.openTasks })}</span>
            <span>{t("projects.done", { count: project.doneTasks })}</span>
            {project.overdueTasks > 0 && shelf === "current" ? <span className="font-medium text-destructive">{t("projects.overdue", { count: project.overdueTasks })}</span> : null}
          </span>
        </Link>
      </li>
    );
  };

  const teamCard = (team: (typeof teams)[number]) => {
    const status = teamStatusOf(team);
    const shelf = teamShelf(status);
    return (
      <li key={team.id} data-accent={shelf === "current" ? accentOf(team.color) : undefined}>
        <Link href={`/work/teams/${team.id}`} className={cn(cardClass(shelf, !!team.color), "gap-1")}>
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="font-mono text-xs text-muted-foreground">{team.key}</span> {team.name}
            {viewer.teamRoles.get(team.id) === "lead" ? <Badge variant="secondary">{t("members.roles.lead")}</Badge> : null}
            {status === "archived" ? <ArchivedBadge label={t("teams.status.archived")} /> : status === "inactive" ? <Badge variant="outline">{t("teams.status.inactive")}</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {team.entityName ?? t("teams.wholeGroup")} · {t("teams.memberCount", { count: team.memberCount })}
          </span>
        </Link>
      </li>
    );
  };

  const grid = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const inactiveProjects = projectsOn("inactive");
  const archivedProjects = projectsOn("archived");
  const inactiveTeams = teamsOn("inactive");
  const archivedTeams = teamsOn("archived");

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("projects.title")}</h2>
          {projectTeams.length ? <CreateProjectButton teams={projectTeams.map((team) => ({ id: team.id, name: team.name, defaultVisibility: team.defaultVisibility }))} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} /> : null}
        </div>
        {projectsOn("current").length === 0 ? <p className="text-sm text-muted-foreground">{t("projects.empty")}</p> : <ul className={grid}>{projectsOn("current").map(projectCard)}</ul>}
        {inactiveProjects.length ? (
          <>
            <h3 className="pt-2 text-sm font-medium text-muted-foreground">{t("shelves.inactiveProjects", { count: inactiveProjects.length })}</h3>
            <ul className={grid}>{inactiveProjects.map(projectCard)}</ul>
          </>
        ) : null}
        {archivedProjects.length ? <ArchivedShelf label={t("shelves.archivedProjects", { count: archivedProjects.length })}><ul className={grid}>{archivedProjects.map(projectCard)}</ul></ArchivedShelf> : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("teams.mine")}</h2>
          {canCreateTeam ? <CreateTeamButton entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} /> : null}
        </div>
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("teams.mineEmpty")}</p> : <ul className={grid}>{mine.map(teamCard)}</ul>}
        {others.length ? (
          <>
            <h2 className="pt-2 text-sm font-medium text-muted-foreground">{t("teams.others")}</h2>
            <ul className={grid}>{others.map(teamCard)}</ul>
          </>
        ) : null}
        {inactiveTeams.length ? (
          <>
            <h2 className="pt-2 text-sm font-medium text-muted-foreground">{t("shelves.inactiveTeams", { count: inactiveTeams.length })}</h2>
            <ul className={grid}>{inactiveTeams.map(teamCard)}</ul>
          </>
        ) : null}
        {archivedTeams.length ? <ArchivedShelf label={t("shelves.archivedTeams", { count: archivedTeams.length })}><ul className={grid}>{archivedTeams.map(teamCard)}</ul></ArchivedShelf> : null}
      </section>
    </div>
  );
}

function ArchivedBadge({ label }: { label: string }) {
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <ArchiveIcon />
      {label}
    </Badge>
  );
}

/** Archived teams or projects: out of the way, shut until opened. */
function ArchivedShelf({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Collapsible className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/20 p-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md text-left text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon className="size-4 transition-transform group-data-[panel-open]:rotate-90" />
        <ArchiveIcon className="size-4" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
