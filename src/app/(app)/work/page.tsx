import { ArchiveIcon, ChevronRightIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { cn } from "cn";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { canManageWorkspace, canViewTeam, listClients, listCreateTargets, listTeams, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { accentOf, projectShelf, type Shelf, teamShelf, type TeamStatus, teamStatusOf } from "@/modules/work/enums";
import { ProjectPoster } from "@/modules/work/ui/project-poster";
import { CreateProjectButton, CreateTeamButton } from "@/modules/work/ui/edit-dialogs";
import { ColorSquare } from "@/modules/work/ui/task-row";
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

  // Each shelf looks its part: a set-aside card is faded, an archived one greyed out and plain.
  const cardClass = (shelf: Shelf) =>
    cn(
      "press flex h-full min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4 transition-colors hover:bg-canvas",
      shelf === "inactive" && "border-dashed opacity-80 hover:opacity-100",
      shelf === "archived" && "border-dashed text-muted-foreground grayscale hover:grayscale-0",
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
    const total = project.openTasks + project.doneTasks;
    const percent = total ? Math.round((project.doneTasks / total) * 100) : 0;
    return (
      <li key={project.id} data-accent={shelf === "current" ? accent : undefined} className="min-w-0">
        <Link href={`/work/projects/${project.id}`} className={cardClass(shelf)}>
          <span className="flex min-w-0 items-start gap-3">
            <ProjectPoster project={project} size="sm" className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.01em]">
                <ColorSquare color={accent} />
                <span className="truncate">{project.name}</span>
              </span>
              <span className="truncate text-xs text-muted-foreground">{[project.teamName, project.clientName, project.leadName].filter(Boolean).join(" · ")}</span>
            </span>
          </span>
          {project.visibility === "private" || projectBadge(project) ? (
            <span className="flex flex-wrap gap-1.5">
              {project.visibility === "private" ? <Badge variant="outline">{t("visibility.private")}</Badge> : null}
              {projectBadge(project)}
            </span>
          ) : null}
          <span className="mt-auto flex flex-col gap-2">
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t("projects.progress", { done: project.doneTasks, total })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span className={cn("block h-full rounded-full transition-[width] duration-300 ease-(--ease-settle)", shelf === "current" ? "bg-primary" : "bg-faint/50")} style={{ width: `${percent}%` }} />
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
              <span>{t("projects.open", { count: project.openTasks })}</span>
              <span>{t("projects.done", { count: project.doneTasks })}</span>
              {project.overdueTasks > 0 && shelf === "current" ? <span className="font-medium text-destructive">{t("projects.overdue", { count: project.overdueTasks })}</span> : null}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  const teamCard = (team: (typeof teams)[number]) => {
    const status = teamStatusOf(team);
    const shelf = teamShelf(status);
    return (
      <li key={team.id} data-accent={shelf === "current" ? accentOf(team.color) : undefined} className="min-w-0">
        <Link href={`/work/teams/${team.id}`} className={cn(cardClass(shelf), "gap-1.5")}>
          <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.01em]">
            <ColorSquare color={accentOf(team.color)} />
            <span className="font-mono text-xs font-normal text-faint">{team.key}</span>
            <span className="truncate">{team.name}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {team.entityName ?? t("teams.wholeGroup")} · {t("teams.memberCount", { count: team.memberCount })}
          </span>
          {viewer.teamRoles.get(team.id) === "lead" || status !== "active" ? (
            <span className="flex flex-wrap gap-1.5 pt-1">
              {viewer.teamRoles.get(team.id) === "lead" ? <Badge variant="secondary">{t("members.roles.lead")}</Badge> : null}
              {status === "archived" ? <ArchivedBadge label={t("teams.status.archived")} /> : status === "inactive" ? <Badge variant="outline">{t("teams.status.inactive")}</Badge> : null}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  const grid = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const inactiveProjects = projectsOn("inactive");
  const archivedProjects = projectsOn("archived");
  const inactiveTeams = teamsOn("inactive");
  const archivedTeams = teamsOn("archived");
  const canSeeWorkload = [...viewer.teamRoles.values()].includes("lead") || canManageWorkspace(viewer);

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <nav className="tab-row" aria-label={t("title")}>
        <Link href="/work" aria-current="page">{t("projects.title")}</Link>
        <Link href="/tasks">{t("myWork")}</Link>
        <Link href="/work/calendar">{t("calendar.title")}</Link>
        <Link href="/work/leader">{t("leader.title")}</Link>
        {canSeeWorkload ? <Link href="/work/workload">{t("workload.title")}</Link> : null}
        <Link href="/work/intake">{t("intake.title")}</Link>
        <Link href="/work/templates">{t("templates.title")}</Link>
        {viewer.principal.workforceType === "collaborator" ? null : <Link href="/work/clients">{t("clients.title")}</Link>}
      </nav>

      <Section
        title={t("projects.title")}
        count={projectsOn("current").length || undefined}
        action={projectTeams.length ? <CreateProjectButton teams={projectTeams.map((team) => ({ id: team.id, name: team.name, defaultVisibility: team.defaultVisibility }))} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} /> : undefined}
      >
        {projectsOn("current").length === 0 ? <p className="text-sm text-muted-foreground">{t("projects.empty")}</p> : <ul className={grid}>{projectsOn("current").map(projectCard)}</ul>}
        {inactiveProjects.length ? (
          <>
            <h3 className="section-label pt-3">{t("shelves.inactiveProjects", { count: inactiveProjects.length })}</h3>
            <ul className={grid}>{inactiveProjects.map(projectCard)}</ul>
          </>
        ) : null}
        {archivedProjects.length ? <ArchivedShelf label={t("shelves.archivedProjects", { count: archivedProjects.length })}><ul className={grid}>{archivedProjects.map(projectCard)}</ul></ArchivedShelf> : null}
      </Section>

      <Section
        title={t("teams.mine")}
        count={mine.length || undefined}
        action={canCreateTeam ? <CreateTeamButton entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} /> : undefined}
      >
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("teams.mineEmpty")}</p> : <ul className={grid}>{mine.map(teamCard)}</ul>}
        {others.length ? (
          <>
            <h3 className="section-label pt-3">{t("teams.others")}</h3>
            <ul className={grid}>{others.map(teamCard)}</ul>
          </>
        ) : null}
        {inactiveTeams.length ? (
          <>
            <h3 className="section-label pt-3">{t("shelves.inactiveTeams", { count: inactiveTeams.length })}</h3>
            <ul className={grid}>{inactiveTeams.map(teamCard)}</ul>
          </>
        ) : null}
        {archivedTeams.length ? <ArchivedShelf label={t("shelves.archivedTeams", { count: archivedTeams.length })}><ul className={grid}>{archivedTeams.map(teamCard)}</ul></ArchivedShelf> : null}
      </Section>
    </Page>
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
    <Collapsible className="flex flex-col gap-3 pt-2">
      <CollapsibleTrigger className="group section-label flex w-full items-center gap-1.5 rounded-md text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon className="size-3.5 transition-transform duration-200 ease-(--ease-settle) group-data-[panel-open]:rotate-90" />
        <ArchiveIcon className="size-3.5" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
