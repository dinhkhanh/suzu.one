import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
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
import { accentOf, teamStatusOf } from "@/modules/work/enums";
import { ArchiveButton, EditTeamButton } from "@/modules/work/ui/edit-dialogs";
import { ProjectPoster } from "@/modules/work/ui/project-poster";
import { ColorSquare } from "@/modules/work/ui/task-row";
import { LabelManager, MemberManager, StateManager } from "@/modules/work/ui/team-forms";
import { checklistChoices, listStateChecklists } from "@/modules/work/service";
import { StageChecklists } from "@/modules/work/ui/checklists";
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
  const [fieldRows, triageCounts, checklists, stageHooks] = await Promise.all([listCustomFields({ teamId: team.id }, { includeInactive: true }), canViewTriage(viewer, facts) ? countTriage([team.id]) : null, checklistChoices(), listStateChecklists(states.map((state) => state.id))]);
  const fields = toFieldViews(fieldRows);
  // FR-PJM-10: the team's open cycles, for the filter and bulk edit.
  const cycles = (await listOpenCycles([team.id])).map((cycle) => ({ id: cycle.id, label: t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") }) }));
  const backlogView = query.view === "table" ? "table" : "list";
  const logged = seesBacklog && backlogView === "table" && canSeeLoggedTime(viewer, { team: facts, project: null }) ? Object.fromEntries(await loggedMinutesByTask(backlog.map((task) => task.id))) : null;
  const intakeProjects = projects.filter((project) => project.teamId === team.id && project.status !== "archived" && project.status !== "done").map(({ id, name }) => ({ id, name }));
  const filters = readFilters(query);
  const grouping = readGrouping(query.group);
  const sort = readSort(query.sort);
  const teamProjects = projects.filter((project) => project.teamId === team.id);

  const listOptions = { states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })), fields: fields.filter((field) => field.projectId === null), cycles };

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
              <EditTeamButton team={team} entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} departments={departments} allowGroup={canManageWorkspace(viewer, { entityId: null, departmentId: null })} />
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
                  <Badge dot variant={statusTone(project.status)}>{t(`projects.status.${project.status}`)}</Badge>
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
        <Section title={t("teams.backlog")} count={backlog.length || undefined} action={<ViewTabs current={backlogView} views={["list", "table"]} />}>
          {backlogView === "table" ? (
            <TaskTableView tasks={backlog} options={listOptions} initialFilters={filters} initialSort={sort} selfId={user.person.id} today={today} canContribute={canContributeToTeam(viewer, facts)} logged={logged} />
          ) : (
            <TaskListView tasks={backlog} options={listOptions} scope={{ teamId: team.id, projectId: null }} initialFilters={filters} initialGrouping={grouping} initialSort={sort} selfId={user.person.id} today={today} canContribute={canContributeToTeam(viewer, facts)} />
          )}
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
