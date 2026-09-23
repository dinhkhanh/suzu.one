import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { baselineSlip, canRebaseline, linkedProgress, listStructure, listTaskLinks, loadTaskSlips, openProject, slipWords } from "@/modules/projects/service";
import { LinkTaskForm, MilestoneForm, MilestoneTools, PhaseForm, RebaselineForm, RemovePhaseButton, UnlinkButton } from "@/modules/projects/ui/plan-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { listAssignable } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectPlan");

/**
 * Phases and milestones (FR-PJM-04) with each milestone's progress from its linked tasks and its
 * slip against the kick-off baseline (FR-PJM-12). Billing amounts are shown and edited only with
 * `pjm:commercial`.
 */
export default async function ProjectPlanPage({ params }: PageProps<"/projects/[projectId]/plan">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, team, plan, can } = context;
  const today = todayInVietnam();
  const [t, format, structure, links, people, taskSlips] = await Promise.all([getTranslations("projects"), getFormatter(), listStructure(project.id), listTaskLinks(project.id), listAssignable(team.id, project.id), loadTaskSlips(project.id, today)]);
  const mayRebaseline = canRebaseline(context.viewer, context.facts);
  const worstTask = taskSlips.summary.worst ? links.find((link) => link.taskId === taskSlips.summary.worst!.taskId) : null;
  const { phases, milestones, deliverables } = structure;
  const slip = baselineSlip(plan.baseline, { startDate: project.startDate, dueDate: project.dueDate, budgetMinutes: plan.budgetMinutes, milestones: milestones.map((milestone) => ({ id: milestone.id, dueDate: milestone.dueDate, doneOn: milestone.doneAt ? todayInVietnam(milestone.doneAt) : null })) }, today);
  const slipOf = new Map(slip?.milestones.map((milestone) => [milestone.id, milestone.slipDays]) ?? []);
  const date = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const days = (value: number | null | undefined) => (value === null || value === undefined ? null : t("plan.slip", slipWords(value)));
  const phaseName = new Map(phases.map((phase) => [phase.id, phase.name]));
  const ownerName = new Map(people.map((person) => [person.id, person.fullName]));
  const tasksOf = Map.groupBy(links.filter((link) => link.milestoneId), (link) => link.milestoneId!);
  const unlinked = links.filter((link) => !link.milestoneId && !link.deliverableId && !link.phaseId);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="plan" />

      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="text-base font-medium">{t("plan.baseline")}</h2>
        {plan.baseline ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("fields.startDate")}</dt>
              <dd>
                {date(project.startDate)} <span className="text-xs text-muted-foreground">({t("plan.baselineWas", { value: date(plan.baseline.startDate) })})</span> {days(slip?.startSlipDays) ? <SlipBadge days={slip!.startSlipDays!} label={days(slip!.startSlipDays)!} /> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("fields.dueDate")}</dt>
              <dd>
                {date(project.dueDate)} <span className="text-xs text-muted-foreground">({t("plan.baselineWas", { value: date(plan.baseline.dueDate) })})</span> {days(slip?.dueSlipDays) ? <SlipBadge days={slip!.dueSlipDays!} label={days(slip!.dueSlipDays)!} /> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("fields.budgetHours")}</dt>
              <dd>
                {plan.budgetMinutes === null ? "—" : format.number(plan.budgetMinutes / 60, { maximumFractionDigits: 1 })} <span className="text-xs text-muted-foreground">({t("plan.baselineWas", { value: plan.baseline.budgetMinutes === null ? "—" : format.number(plan.baseline.budgetMinutes / 60, { maximumFractionDigits: 1 }) })})</span>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("plan.noBaseline")}</p>
        )}
        {taskSlips.summary.compared > 0 ? (
          <div className="flex flex-col gap-1 border-t pt-2 text-sm">
            <p>
              {t("baseline.taskSummary", { compared: taskSlips.summary.compared, late: taskSlips.summary.late, early: taskSlips.summary.early, onTime: taskSlips.summary.onTime })}
            </p>
            {taskSlips.summary.worst && worstTask ? (
              <p className="text-xs text-muted-foreground">
                {t("baseline.worst", { days: taskSlips.summary.worst.slipDays })}{" "}
                <Link href={`/work/tasks/${worstTask.taskId}`} className="underline">
                  <span className="font-mono">{worstTask.key}</span> {worstTask.title}
                </Link>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <Link href={`/projects/${project.id}/timeline`} className="underline">
                {t("baseline.onTimeline")}
              </Link>
            </p>
          </div>
        ) : null}
        {mayRebaseline ? <RebaselineForm projectId={project.id} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("plan.phases")}</h2>
        {phases.length === 0 ? <p className="text-sm text-muted-foreground">{t("plan.noPhases")}</p> : null}
        <ol className="flex flex-col gap-2">
          {phases.map((phase) =>
            can.editPlan ? (
              <li key={phase.id} className="flex flex-col gap-1 rounded-lg border p-3">
                <PhaseForm projectId={project.id} phase={phase} />
                <div>
                  <RemovePhaseButton phaseId={phase.id} />
                </div>
              </li>
            ) : (
              <li key={phase.id} className="flex flex-wrap gap-x-3 text-sm">
                <span className="font-medium">{phase.name}</span>
                <span className="text-muted-foreground">
                  {date(phase.startDate)} → {date(phase.endDate)}
                </span>
              </li>
            ),
          )}
        </ol>
        {can.editPlan ? (
          <div className="rounded-lg border border-dashed p-3">
            <PhaseForm projectId={project.id} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("plan.milestones")}</h2>
        {milestones.length === 0 ? <p className="text-sm text-muted-foreground">{t("plan.noMilestones")}</p> : null}
        <ol className="flex flex-col gap-3">
          {milestones.map((milestone) => {
            const own = tasksOf.get(milestone.id) ?? [];
            const progress = linkedProgress(own.map((task) => task.status as "todo"));
            const late = !milestone.doneAt && milestone.dueDate !== null && milestone.dueDate < today;
            const slipDays = slipOf.get(milestone.id);
            const lines = deliverables.filter((line) => line.milestoneId === milestone.id && !line.cancelledAt);
            return (
              <li key={milestone.id} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{milestone.name}</span>
                  <span className="text-sm text-muted-foreground">{date(milestone.dueDate)}</span>
                  {milestone.doneAt ? <Badge variant="success">{t("plan.done")}</Badge> : late ? <Badge variant="destructive">{t("plan.late")}</Badge> : null}
                  {milestone.isClientFacing ? <Badge variant="outline">{t("fields.isClientFacing")}</Badge> : null}
                  {milestone.isBilling ? <Badge variant="outline">{t("fields.isBilling")}</Badge> : null}
                  {slipDays ? <SlipBadge days={slipDays} label={days(slipDays)!} /> : null}
                  {can.seeFees && milestone.isBilling && milestone.billingAmountVnd !== null ? <span className="text-sm">{format.number(milestone.billingAmountVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })}</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[milestone.phaseId ? phaseName.get(milestone.phaseId) : null, milestone.ownerPersonId ? ownerName.get(milestone.ownerPersonId) : null, progress.total ? t("plan.progress", { done: progress.done, total: progress.total, percent: progress.percent ?? 0 }) : t("plan.noLinkedTasks"), lines.length ? t("plan.linesCount", { count: lines.length }) : null].filter(Boolean).join(" · ")}
                </p>
                {own.length ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {own.map((task) => (
                      <li key={task.taskId} className="flex flex-wrap items-center gap-2">
                        <Link href={`/work/tasks/${task.taskId}`} className="hover:underline">
                          <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                        </Link>
                        <Badge variant="secondary">{t(`plan.taskStatus.${task.status as "todo"}`)}</Badge>
                        {can.editPlan ? <UnlinkButton taskId={task.taskId} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {can.editPlan ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">{t("plan.edit")}</summary>
                    <div className="flex flex-col gap-2 pt-2">
                      <MilestoneForm projectId={project.id} milestone={{ id: milestone.id, name: milestone.name, dueDate: milestone.dueDate, phaseId: milestone.phaseId, ownerPersonId: milestone.ownerPersonId, isClientFacing: milestone.isClientFacing, isBilling: milestone.isBilling, sortOrder: milestone.sortOrder, ...(can.seeFees ? { billingAmountVnd: milestone.billingAmountVnd } : {}) }} phases={phases.map(({ id, name }) => ({ id, name }))} people={people} showAmount={can.seeFees} />
                      <MilestoneTools milestoneId={milestone.id} done={!!milestone.doneAt} />
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
        {can.editPlan ? (
          <div className="rounded-xl border border-dashed p-3">
            <MilestoneForm projectId={project.id} phases={phases.map(({ id, name }) => ({ id, name }))} people={people} showAmount={can.seeFees} />
          </div>
        ) : null}
      </section>

      {can.editPlan ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium">{t("plan.linkTasks")}</h2>
          <p className="text-sm text-muted-foreground">{t("plan.linkHint", { count: unlinked.length })}</p>
          <LinkTaskForm
            tasks={links.filter((link) => link.status === "todo" || link.status === "in_progress").map((link) => ({ id: link.taskId, key: link.key, title: link.title }))}
            milestones={milestones.map(({ id, name }) => ({ id, name }))}
            lines={deliverables.filter((line) => !line.cancelledAt).map(({ id, title, quantity }) => ({ id, name: `${quantity} × ${title}` }))}
            phases={phases.map(({ id, name }) => ({ id, name }))}
          />
        </section>
      ) : null}
    </div>
  );
}

function SlipBadge({ days, label }: { days: number; label: string }) {
  return <Badge variant={days > 0 ? "destructive" : "success"}>{label}</Badge>;
}
