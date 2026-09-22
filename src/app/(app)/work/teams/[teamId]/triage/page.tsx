import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canDecideTriage, canViewTriage, findTeam, listAssignable, listLabels, listMergeTargets, listTeamIntakeForms, listTriage, listTriageRules, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { TriageQueue, TriageRuleManager } from "@/modules/work/ui/triage";

export const metadata: Metadata = { title: "Triage" };

// FR-PJM-32: work from outside the team waits here for a lead's answer. The team's members see
// the queue; only the leads act on it and keep the rules.
export default async function TriagePage({ params }: PageProps<"/work/teams/[teamId]/triage">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewTriage(viewer, teamFacts(team))) notFound();
  const decide = canDecideTriage(viewer, teamFacts(team));
  const today = todayInVietnam();

  const [items, people, labels, projects, forms, rules, mergeTargets] = await Promise.all([
    listTriage(team.id, viewer),
    listAssignable(team.id, null),
    listLabels([team.id]),
    visibleProjects(viewer, { today }),
    decide ? listTeamIntakeForms(team.id) : [],
    decide ? listTriageRules(team.id) : [],
    decide ? listMergeTargets(team.id, viewer) : [],
  ]);
  const choices = {
    people,
    projects: projects.filter((project) => project.teamId === team.id && project.status !== "archived" && project.status !== "done").map(({ id, name }) => ({ id, name })),
    labels: labels.map(({ id, name, color }) => ({ id, name, color })),
    forms: forms.map(({ id, name }) => ({ id, name })),
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
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
        <h1>{t("triage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("triage.description")}</p>
      </header>

      <TriageQueue
        items={items.map(({ id, key, title, description, source, triageStatus, snoozedUntil, requesterName, formName, createdAt, assigneePersonId, projectId, dueDate, priority, labelIds }) => ({ id, key, title, description, source, triageStatus, snoozedUntil, requesterName, formName, createdAt, assigneePersonId, projectId, dueDate, priority, labelIds }))}
        choices={{ ...choices, mergeTargets }}
        canDecide={decide}
        today={today}
      />

      {decide ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("triage.rules.title")}</h2>
          <TriageRuleManager teamId={team.id} rules={rules.map(({ id, name, match, set, sortOrder, isActive }) => ({ id, name, match, set, sortOrder, isActive }))} choices={choices} canManage={decide} />
        </section>
      ) : null}
    </div>
  );
}
