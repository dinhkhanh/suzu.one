import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { FILTER_KEYS, GROUPINGS, type Grouping, type TaskFilters } from "@/modules/work/engine/filter";
import { canContributeToProject, canManageProject, canViewProject, findProject, listAssignable, listClients, listLabels, listProjectMembers, listProjectTasks, listSavedViews, listStates, loadViewer, projectFacts } from "@/modules/work/service";
import { ProjectForm } from "@/modules/work/ui/project-forms";
import { TaskListView } from "@/modules/work/ui/task-list-view";
import { MemberManager } from "@/modules/work/ui/team-forms";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/work/projects/[projectId]">) {
  const user = await requireUser();
  const { projectId } = await params;
  const query = await searchParams;
  const found = /^[0-9a-f-]{36}$/.test(projectId) ? await findProject(projectId) : undefined;
  const viewer = await loadViewer(user);
  // A project the viewer may not open does not exist, as far as they can tell.
  if (!found || !canViewProject(viewer, projectFacts(found.project, found.team))) notFound();
  const { project, team } = found;
  const facts = projectFacts(project, team);
  const t = await getTranslations("work");
  const manage = canManageProject(viewer, facts);
  const today = todayInVietnam();

  const [views, tasks, states, labels, clients, members, assignable, people] = await Promise.all([
    listSavedViews(project.id, user.person.id),
    listProjectTasks(project.id),
    listStates([team.id]),
    listLabels([team.id]),
    listClients({ activeOnly: true }),
    listProjectMembers(project.id),
    listAssignable(team.id, project.id),
    manage ? listPersonNames() : [],
  ]);
  const filters: TaskFilters = Object.fromEntries(FILTER_KEYS.flatMap((key) => (typeof query[key] === "string" ? [[key, query[key]]] : [])));
  const grouping = GROUPINGS.includes(query.group as Grouping) ? (query.group as Grouping) : "none";
  const clientName = clients.find((client) => client.id === project.clientId)?.name;

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
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          {project.name}
          <Badge variant="outline">{t(`visibility.${project.visibility}`)}</Badge>
          {project.status === "active" ? null : <Badge variant="secondary">{t(`projects.status.${project.status}`)}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">{[clientName, project.description].filter(Boolean).join(" · ")}</p>
      </header>

      <TaskListView
        tasks={tasks}
        options={{ states: states.map(({ id, name, category, isActive }) => ({ id, name, category, isActive })), people: assignable, labels: labels.map(({ id, name, color }) => ({ id, name, color })), clients: clients.map(({ id, name }) => ({ id, name })) }}
        scope={{ teamId: team.id, projectId: project.id }}
        initialFilters={filters}
        initialGrouping={grouping}
        selfId={user.person.id}
        today={today}
        canContribute={canContributeToProject(viewer, facts) && project.status !== "archived"}
        savedViews={views.map((view) => ({ id: view.id, name: view.name, isShared: view.isShared, mine: view.ownerPersonId === user.person.id, canDelete: view.ownerPersonId === user.person.id || manage, filters: view.filters }))}
      />

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">{t("projects.membersAndSettings", { count: members.length })}</summary>
        <div className="flex flex-col gap-6 pt-4">
          <MemberManager members={members} people={people} canManage={manage} target={{ projectId: project.id }} />
          {manage ? <ProjectForm project={project} teams={[]} clients={clients.map(({ id, name }) => ({ id, name }))} people={assignable} /> : null}
        </div>
      </details>
    </div>
  );
}
