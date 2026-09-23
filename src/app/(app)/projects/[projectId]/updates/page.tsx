import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { StatusDraftButton } from "@/modules/ai/ui/draft-button";
import { requireUser } from "@/modules/platform/auth/session";
import { HEALTHS, isStale, listStatusUpdates, loadStatusFacts, openProject, slipWords, type StatusFacts, updateDueOn } from "@/modules/projects/service";
import { StatusUpdateForm } from "@/modules/projects/ui/plan-forms";
import { healthVariant, ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectUpdates");

/**
 * Status updates (FR-PJM-27): the facts are prefilled from the record — the lead adds health,
 * summary, highlights and next steps. The history is kept; an update older than the cadence is
 * stale and says so here and in the portfolio.
 */
export default async function ProjectUpdatesPage({ params }: PageProps<"/projects/[projectId]/updates">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, can } = context;
  const today = todayInVietnam();
  const [t, format, updates, facts] = await Promise.all([getTranslations("projects"), getFormatter(), listStatusUpdates(project.id), loadStatusFacts(project.id, plan, today)]);
  const cadence = { projectStatus: project.status, lastUpdateOn: plan.healthUpdatedAt ? todayInVietnam(plan.healthUpdatedAt) : null, since: todayInVietnam(plan.briefApprovedAt ?? plan.createdAt), cadenceDays: plan.updateCadenceDays };
  const dueOn = updateDueOn(cadence);
  const stale = isStale(cadence, today);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="updates" />

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{t("updates.now")}</h2>
          {dueOn ? <Badge variant={stale ? "warning" : "secondary"}>{stale ? t("updates.stale") : t("updates.nextDue", { date: format.dateTime(new Date(`${dueOn}T00:00:00`), { dateStyle: "medium" }) })}</Badge> : null}
        </div>
        <Facts facts={facts} />
        {can.postStatus ? <StatusUpdateForm projectId={project.id} healths={HEALTHS} draft={<StatusDraftButton projectId={project.id} targetId="summary" healthTargetId="status-health-draft" />} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("updates.history")}</h2>
        {updates.length === 0 ? <p className="text-sm text-muted-foreground">{t("updates.none")}</p> : null}
        <ol className="flex flex-col gap-4">
          {updates.map((update) => (
            <li key={update.id} className="flex flex-col gap-2 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={healthVariant(update.health)}>{t(`health.${update.health as "on_track"}`)}</Badge>
                <span className="text-sm text-muted-foreground">{[update.authorName, format.dateTime(update.createdAt, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}</span>
              </div>
              <p className="text-sm whitespace-pre-line">{update.summary}</p>
              {update.highlights ? (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">{t("fields.highlights")}</p>
                  <p className="whitespace-pre-line">{update.highlights}</p>
                </div>
              ) : null}
              {update.nextSteps ? (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">{t("fields.nextSteps")}</p>
                  <p className="whitespace-pre-line">{update.nextSteps}</p>
                </div>
              ) : null}
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">{t("updates.factsThen")}</summary>
                <div className="pt-2">
                  <Facts facts={update.facts} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
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
    [t("nextMilestone"), facts.nextMilestone ? [facts.nextMilestone.name, facts.nextMilestone.dueDate ? format.dateTime(new Date(`${facts.nextMilestone.dueDate}T00:00:00`), { dateStyle: "medium" }) : null].filter(Boolean).join(" · ") : "—"],
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
