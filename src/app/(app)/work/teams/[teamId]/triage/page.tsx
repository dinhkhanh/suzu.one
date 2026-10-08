import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canDecideTriage, canViewTriage, findTeam, listAssignable, listLabels, listMergeTargets, listTeamIntakeForms, listTriage, listTriageRules, loadViewer, teamFacts, visibleProjects } from "@/modules/work/service";
import { TriageQueue, TriageRuleManager } from "@/modules/work/ui/triage";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("triage");

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
    <Page width="default">
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
        title={t("triage.title")}
        description={t("triage.description")}
      />

      <TriageQueue
        items={items.map(({ id, key, title, description, source, triageStatus, snoozedUntil, requesterPersonId, requesterName, formName, createdAt, assigneePersonId, projectId, dueDate, priority, labelIds }) => ({
          id,
          key,
          title,
          description,
          source,
          triageStatus,
          snoozedUntil,
          requesterPersonId,
          requesterName,
          formName,
          createdAt,
          assigneePersonId,
          projectId,
          dueDate,
          priority,
          labelIds,
        }))}
        choices={{ ...choices, mergeTargets }}
        canDecide={decide}
        today={today}
      />

      {decide ? (
        <Section title={t("triage.rules.title")}>
          <TriageRuleManager teamId={team.id} rules={rules.map(({ id, name, match, set, sortOrder, isActive }) => ({ id, name, match, set, sortOrder, isActive }))} choices={choices} canManage={decide} />
        </Section>
      ) : null}
    </Page>
  );
}
