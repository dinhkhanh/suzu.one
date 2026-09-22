import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canEditRetainer, getRetainer, listPeriods, openProject, type PeriodView, RETAINER_ROLLOVERS, shapeRetainer, type Usage, type UsageLevel } from "@/modules/projects/service";
import { RetainerForm } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";

export const metadata: Metadata = { title: "Retainer" };

const levelVariant = (level: UsageLevel) => (level === "over" ? "destructive" : level === "full" ? "warning" : level === "warning" ? "warning" : "secondary");

/**
 * A retainer (FR-PJM-06): its monthly terms, this month's quota line by line — carried units,
 * consumed, overservicing — the hours allowance against what was logged, and every past month as
 * the monthly retainer report. The monthly fee and its billing state only for `pjm:commercial`.
 */
export default async function ProjectRetainerPage({ params }: PageProps<"/projects/[projectId]/retainer">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, can, viewer, facts } = context;
  const [t, tWork, format, row] = await Promise.all([getTranslations("projects.retainer"), getTranslations("work"), getFormatter(), getRetainer(project.id)]);
  const retainer = row ? shapeRetainer(row, can.seeFees) : null;
  const periods = row ? await listPeriods(row, can.seeFees) : [];
  const today = todayInVietnam();
  const current = periods.find((period) => period.period.status === "open" && period.period.month === today.slice(0, 7)) ?? null;
  const past = periods.filter((period) => period !== current);
  const editable = canEditRetainer(viewer, facts) && plan.kind === "retainer";
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const percent = (usage: Usage) => (usage.percent === null ? "—" : `${usage.percent}%`);

  const report = (view: PeriodView) => (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-normal">{t("line")}</th>
              <th className="py-1 pr-2 text-right font-normal">{t("quota")}</th>
              <th className="py-1 pr-2 text-right font-normal">{t("carried")}</th>
              <th className="py-1 pr-2 text-right font-normal">{t("consumed")}</th>
              <th className="py-1 pr-2 text-right font-normal">{t("remaining")}</th>
              <th className="py-1 text-right font-normal">{t("overservicing")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.lines.map((line) => (
              <tr key={line.id} className={line.cancelledAt ? "opacity-60" : ""}>
                <td className="py-1.5 pr-2">
                  <span className={line.cancelledAt ? "line-through" : ""}>{line.title}</span>
                  {line.format ? <span className="ml-1 text-xs text-muted-foreground">{tWork(`formats.${line.format as "post"}`)}</span> : null}
                </td>
                <td className="py-1.5 pr-2 text-right">{line.quantity}</td>
                <td className="py-1.5 pr-2 text-right">{view.period.carried[line.title] ? (view.period.carried[line.title] > 0 ? `+${view.period.carried[line.title]}` : view.period.carried[line.title]) : "—"}</td>
                <td className="py-1.5 pr-2 text-right">{line.consumed}</td>
                <td className="py-1.5 pr-2 text-right">{line.usage.remaining}</td>
                <td className="py-1.5 text-right">
                  <Badge variant={levelVariant(line.usage.level)}>{percent(line.usage)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("total")}</dt>
          <dd className="font-medium">{t("totalValue", { consumed: view.total.consumed, contracted: view.total.contracted, percent: percent(view.total) })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("hours")}</dt>
          <dd className="font-medium">{view.hours ? t("hoursValue", { logged: hours(view.loggedMinutes), allowance: hours(view.hours.contracted), percent: percent(view.hours) }) : t("hoursLogged", { logged: hours(view.loggedMinutes) })}</dd>
        </div>
        {"feeVnd" in view ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("fee")}</dt>
            <dd className="font-medium">{money(view.feeVnd)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{t("billing")}</dt>
          <dd className="font-medium">{view.billing ? `${t(`billingStatus.${view.billing.status as "ready"}`)}${view.billing.invoiceNumber ? ` · ${view.billing.invoiceNumber}` : ""}` : view.period.status === "open" ? t("billingAtMonthEnd") : "—"}</dd>
        </div>
      </dl>
    </div>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="retainer" />

      {plan.kind !== "retainer" ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("notRetainer")}</p> : null}

      {retainer ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medium">{t("terms")}</h2>
            <Badge variant={retainer.isActive ? "success" : "secondary"}>{retainer.isActive ? t("active") : t("inactive")}</Badge>
          </div>
          <p className="text-sm">{t("termsLine", { start: retainer.startMonth, end: retainer.endMonth ?? t("noEnd"), rollover: t(`rollovers.${retainer.rollover as "reset"}`) })}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {retainer.lines.map((line) => (
              <li key={line.title}>
                {line.quantity} × {line.title}
              </li>
            ))}
            {retainer.minutesPerMonth ? <li>{t("hoursPerMonthValue", { hours: hours(retainer.minutesPerMonth) })}</li> : null}
            {"feePerMonthVnd" in retainer ? <li>{t("feePerMonthValue", { fee: money(retainer.feePerMonthVnd) })}</li> : null}
          </ul>
        </section>
      ) : plan.kind === "retainer" ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}

      {current ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medium">{t("thisMonth", { month: current.period.month })}</h2>
            <Badge variant={levelVariant(current.total.level)}>{t("overservicingValue", { percent: percent(current.total) })}</Badge>
          </div>
          {report(current)}
        </section>
      ) : null}

      {past.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium">{t("report")}</h2>
          {past.map((view) => (
            <details key={view.period.id} className="rounded-xl border p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{view.period.month}</span>
                <Badge variant="outline">{t(`periodStatus.${view.period.status as "open"}`)}</Badge>
                <Badge variant={levelVariant(view.total.level)}>{t("overservicingValue", { percent: percent(view.total) })}</Badge>
              </summary>
              <div className="pt-3">
                {report(view)}
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {editable ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{retainer ? t("edit") : t("setUp")}</h2>
          <RetainerForm
            projectId={project.id}
            values={retainer ? { startMonth: retainer.startMonth, endMonth: retainer.endMonth, lines: retainer.lines, minutesPerMonth: retainer.minutesPerMonth, ...("feePerMonthVnd" in retainer ? { feePerMonthVnd: retainer.feePerMonthVnd } : {}), rollover: retainer.rollover, isActive: retainer.isActive } : null}
            rollovers={RETAINER_ROLLOVERS}
            editFee={can.editFees}
            defaultMonth={today.slice(0, 7)}
          />
        </section>
      ) : null}
    </div>
  );
}
