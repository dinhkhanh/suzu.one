import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { StatusDraftButton } from "@/modules/ai/ui/draft-button";
import { proposalDraft } from "@/modules/ai/service";
import { requireUser } from "@/modules/platform/auth/session";
import { HEALTHS, isStale, listStatusUpdates, loadStatusFacts, openProject, slipWords, type StatusFacts, updateDueOn } from "@/modules/projects/service";
import { StatusUpdateForm } from "@/modules/projects/ui/plan-forms";
import { healthVariant, ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("projectUpdates");

/**
 * Status updates (FR-PJM-27): the facts are prefilled from the record — the lead adds health,
 * summary, highlights and next steps. The history is kept; an update older than the cadence is
 * stale and says so here and in the portfolio. `?proposal=<id>` starts the form from the assistant's
 * proposal of the asker's own.
 */
export default async function ProjectUpdatesPage({ params, searchParams }: PageProps<"/projects/[projectId]/updates">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, can } = context;
  const today = todayInVietnam();
  const { proposal } = await searchParams;
  const [t, format, updates, facts, proposed] = await Promise.all([
    getTranslations("projects"),
    getFormatter(),
    listStatusUpdates(project.id),
    loadStatusFacts(project.id, plan, today),
    can.postStatus && typeof proposal === "string" ? proposalDraft(user.person.id, proposal, ["projects.status.post"]) : null,
  ]);
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const initial = proposed?.projectId === project.id ? { health: text(proposed.health), summary: text(proposed.summary), highlights: text(proposed.highlights), nextSteps: text(proposed.nextSteps) } : undefined;
  const cadence = { projectStatus: project.status, lastUpdateOn: plan.healthUpdatedAt ? todayInVietnam(plan.healthUpdatedAt) : null, since: todayInVietnam(plan.briefApprovedAt ?? plan.createdAt), cadenceDays: plan.updateCadenceDays };
  const dueOn = updateDueOn(cadence);
  const stale = isStale(cadence, today);

  return (
    <Page>
      <ProjectHeader context={context} current="updates" />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2>{t("updates.now")}</h2>
            {dueOn ? <Badge variant={stale ? "warning" : "secondary"}>{stale ? t("updates.stale") : t("updates.nextDue", { date: format.dateTime(new Date(`${dueOn}T00:00:00`), { dateStyle: "medium" }) })}</Badge> : null}
          </div>
          <Facts facts={facts} />
          {can.postStatus ? <StatusUpdateForm projectId={project.id} healths={HEALTHS} initial={initial} draft={<StatusDraftButton projectId={project.id} targetId="summary" healthTargetId="status-health-draft" />} /> : null}
        </CardContent>
      </Card>

      <TableCard>
        <TableCardHeader title={t("updates.history")} count={updates.length || null} />
        <List>
          {updates.length === 0 ? <ListEmpty>{t("updates.none")}</ListEmpty> : null}
          {updates.map((update) => (
            <ListItem key={update.id} className="flex-col items-stretch gap-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={healthVariant(update.health)}>{t(`health.${update.health as "on_track"}`)}</Badge>
                <span className="text-sm text-muted-foreground">
                  {update.authorName ? (
                    <>
                      <RecordLink kind="person" id={update.authorPersonId}>
                        {update.authorName}
                      </RecordLink>
                      {" · "}
                    </>
                  ) : null}
                  {format.dateTime(update.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              <RichText text={update.summary} className="text-sm" />
              {update.highlights ? (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">{t("fields.highlights")}</p>
                  <RichText text={update.highlights} />
                </div>
              ) : null}
              {update.nextSteps ? (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">{t("fields.nextSteps")}</p>
                  <RichText text={update.nextSteps} />
                </div>
              ) : null}
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">{t("updates.factsThen")}</summary>
                <div className="pt-2">
                  <Facts facts={update.facts} />
                </div>
              </details>
            </ListItem>
          ))}
        </List>
      </TableCard>
    </Page>
  );
}

async function Facts({ facts }: { facts: StatusFacts }) {
  const t = await getTranslations("projects.facts");
  const format = await getFormatter();
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const items: [string, string][] = [
    [t("tasks"), t("tasksValue", { done: facts.tasksDone, open: facts.tasksOpen })],
    [t("overdue"), String(facts.overdue)],
    [t("blocked"), String(facts.blocked)],
    [t("milestoneSlip"), facts.milestoneSlipDays === null ? "—" : t("days", slipWords(facts.milestoneSlipDays))],
    [
      t("nextMilestone"),
      facts.nextMilestone ? [facts.nextMilestone.name, facts.nextMilestone.dueDate ? format.dateTime(new Date(`${facts.nextMilestone.dueDate}T00:00:00`), { dateStyle: "medium" }) : null].filter(Boolean).join(" · ") : "—",
    ],
    [t("hours"), facts.budgetMinutes ? t("hoursOfBudget", { used: hours(facts.minutesLogged), budget: hours(facts.budgetMinutes) }) : hours(facts.minutesLogged)],
    [t("deliverables"), facts.deliverablesPromised ? t("deliverablesValue", { accepted: facts.deliverablesAccepted, promised: facts.deliverablesPromised }) : "—"],
    // Updates posted before the RAID log existed carry no counts: a dash, not a zero.
    [t("highRisks"), facts.highRisks === undefined ? "—" : String(facts.highRisks)],
    [t("openIssues"), facts.openIssues === undefined ? "—" : String(facts.openIssues)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
