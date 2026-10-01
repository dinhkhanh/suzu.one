import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  const tone = burn.level === "over" ? "destructive" : burn.level === "warning" ? "warning" : undefined;

  return (
    <Page>
      <ProjectHeader context={context} current="budget" />

      <Section title={t("budget.burn")} action={burn.level !== "none" ? <Badge variant={burn.level === "over" ? "destructive" : burn.level === "warning" ? "warning" : "success"}>{t(`budget.level.${burn.level}`, { percent: burn.percent ?? 0 })}</Badge> : null}>
        <TileGrid>
          <Tile label={t("budget.logged")} value={hours(burn.loggedMinutes)} />
          <Tile label={t("budget.remaining")} value={hours(burn.remainingMinutes)} />
          <Tile label={t("budget.forecast")} value={hours(burn.burnMinutes)} tone={tone} />
          <Tile label={t("fields.budgetHours")} value={hours(burn.budgetMinutes)} />
        </TileGrid>
        <Card>
          <CardContent className="flex flex-col gap-3">
            {burn.budgetMinutes ? (
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("budget.barLabel", { logged: hours(burn.loggedMinutes), forecast: hours(burn.burnMinutes), budget: hours(burn.budgetMinutes) })}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: width(burn.burnMinutes) }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: width(burn.loggedMinutes) }} />
                {BUDGET_THRESHOLDS.filter((threshold) => threshold < 100).map((threshold) => (
                  <div key={threshold} className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${threshold}%` }} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("budget.noBudget")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("budget.explain")}</p>
          </CardContent>
        </Card>
      </Section>

      {plan.budgetByRole.length || budgetedPhases.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {plan.budgetByRole.length ? (
            <TableCard>
              <TableCardHeader title={t("settings.byRole")} />
              <Table numbered={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="select">{t("bookings.placeholderRole")}</TableHead>
                    <TableHead kind="time">{t("reports.hours")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.budgetByRole.map((role) => (
                    <TableRow key={role.role}>
                      <TableCell>{role.role}</TableCell>
                      <TableCell kind="time">{t("budget.hours", { hours: hours(role.minutes) })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          ) : null}
          {budgetedPhases.length ? (
            <TableCard>
              <TableCardHeader title={t("budget.byPhase")} />
              <Table numbered={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="text">{t("fields.phase")}</TableHead>
                    <TableHead kind="time">{t("reports.hours")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgetedPhases.map((phase) => (
                    <TableRow key={phase.id}>
                      <TableCell>{phase.name}</TableCell>
                      <TableCell kind="time">{t("budget.hours", { hours: hours(phase.budgetMinutes) })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          ) : null}
        </div>
      ) : null}

      {can.seeFees ? (
        <Section title={t("budget.fee")}>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <p className="font-mono text-2xl font-medium tracking-[-0.02em] tabular-nums">{plan.feeVnd === null || plan.feeVnd === undefined ? "—" : format.number(plan.feeVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-muted-foreground">{t("budget.feeNote")}</p>
              {can.editFees ? <FeeForm projectId={project.id} feeVnd={plan.feeVnd ?? null} /> : null}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      {can.editPlan ? (
        <Section title={t("budget.edit")}>
          <Card>
            <CardContent>
              <PlanSettingsForm projectId={project.id} values={{ kind: plan.kind, budgetMinutes: plan.budgetMinutes, budgetByRole: plan.budgetByRole, updateCadenceDays: plan.updateCadenceDays, driveUrl: plan.driveUrl }} kinds={PROJECT_KINDS} />
            </CardContent>
          </Card>
        </Section>
      ) : null}
    </Page>
  );
}
