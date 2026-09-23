import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { BUDGET_THRESHOLDS, listStructure, loadBurns, openProject, PROJECT_KINDS } from "@/modules/projects/service";
import { FeeForm, PlanSettingsForm } from "@/modules/projects/ui/plan-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectBudget");

/**
 * The hours budget and its burn (FR-PJM-09): logged hours plus the estimates still open, against
 * the budget, with the 80% / 100% marks. Hours are for whoever may read the plan; the fee in VND is
 * on this page only for a reader with `pjm:commercial` over the project's entity.
 */
export default async function ProjectBudgetPage({ params }: PageProps<"/projects/[projectId]/budget">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, can } = context;
  const [t, format, burns, structure] = await Promise.all([getTranslations("projects"), getFormatter(), loadBurns([project.id], new Map([[project.id, plan.budgetMinutes]])), listStructure(project.id)]);
  const burn = burns.get(project.id)!;
  const hours = (minutes: number | null) => (minutes === null ? "—" : format.number(minutes / 60, { maximumFractionDigits: 1 }));
  const width = (minutes: number) => (burn.budgetMinutes ? `${Math.min(100, (minutes / burn.budgetMinutes) * 100)}%` : "0%");
  const budgetedPhases = structure.phases.filter((phase) => phase.budgetMinutes);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="budget" />

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{t("budget.burn")}</h2>
          {burn.level !== "none" ? <Badge variant={burn.level === "over" ? "destructive" : burn.level === "warning" ? "warning" : "success"}>{t(`budget.level.${burn.level}`, { percent: burn.percent ?? 0 })}</Badge> : null}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t("budget.logged")}</dt>
            <dd className="text-lg font-medium">{hours(burn.loggedMinutes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("budget.remaining")}</dt>
            <dd className="text-lg font-medium">{hours(burn.remainingMinutes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("budget.forecast")}</dt>
            <dd className="text-lg font-medium">{hours(burn.burnMinutes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.budgetHours")}</dt>
            <dd className="text-lg font-medium">{hours(burn.budgetMinutes)}</dd>
          </div>
        </dl>
        {burn.budgetMinutes ? (
          <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("budget.barLabel", { logged: hours(burn.loggedMinutes), forecast: hours(burn.burnMinutes), budget: hours(burn.budgetMinutes) })}>
            <div className="absolute inset-y-0 left-0 bg-primary/30" style={{ width: width(burn.burnMinutes) }} />
            <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: width(burn.loggedMinutes) }} />
            {BUDGET_THRESHOLDS.filter((threshold) => threshold < 100).map((threshold) => (
              <div key={threshold} className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${threshold}%` }} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("budget.noBudget")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("budget.explain")}</p>
      </section>

      {plan.budgetByRole.length || budgetedPhases.length ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {plan.budgetByRole.length ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("settings.byRole")}</h2>
              <ul className="flex flex-col divide-y rounded-lg border text-sm">
                {plan.budgetByRole.map((role) => (
                  <li key={role.role} className="flex justify-between gap-2 px-3 py-2">
                    <span>{role.role}</span>
                    <span>{t("budget.hours", { hours: hours(role.minutes) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {budgetedPhases.length ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("budget.byPhase")}</h2>
              <ul className="flex flex-col divide-y rounded-lg border text-sm">
                {budgetedPhases.map((phase) => (
                  <li key={phase.id} className="flex justify-between gap-2 px-3 py-2">
                    <span>{phase.name}</span>
                    <span>{t("budget.hours", { hours: hours(phase.budgetMinutes) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {can.seeFees ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("budget.fee")}</h2>
          <p className="text-lg font-medium">{plan.feeVnd === null || plan.feeVnd === undefined ? "—" : format.number(plan.feeVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-muted-foreground">{t("budget.feeNote")}</p>
          {can.editFees ? <FeeForm projectId={project.id} feeVnd={plan.feeVnd ?? null} /> : null}
        </section>
      ) : null}

      {can.editPlan ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{t("budget.edit")}</h2>
          <PlanSettingsForm projectId={project.id} values={{ kind: plan.kind, budgetMinutes: plan.budgetMinutes, budgetByRole: plan.budgetByRole, updateCadenceDays: plan.updateCadenceDays, driveUrl: plan.driveUrl }} kinds={PROJECT_KINDS} />
        </section>
      ) : null}
    </div>
  );
}
