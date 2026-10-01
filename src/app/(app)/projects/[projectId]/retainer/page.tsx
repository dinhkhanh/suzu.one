import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { awaitingAcceptance, canEditRetainer, getRetainer, listPeriods, openProject, type PeriodView, RETAINER_ROLLOVERS, shapeRetainer, type Usage, type UsageLevel } from "@/modules/projects/service";
import { RetainerForm } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("retainer");

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
  const [t, tWork, tAcceptance, format, row, waiting] = await Promise.all([getTranslations("projects.retainer"), getTranslations("work"), getTranslations("projects.acceptance"), getFormatter(), getRetainer(project.id), awaitingAcceptance(project.id)]);
  // Months closed but not yet billed because the client has not signed their biên bản (Q22).
  const waitingPeriods = new Set((waiting ?? []).flatMap((item) => (item.retainerPeriodId ? [item.retainerPeriodId] : [])));
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
      <Table numbered={false} className="min-w-[34rem]">
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("line")}</TableHead>
            <TableHead kind="number">{t("quota")}</TableHead>
            <TableHead kind="number">{t("carried")}</TableHead>
            <TableHead kind="number">{t("consumed")}</TableHead>
            <TableHead kind="number">{t("remaining")}</TableHead>
            <TableHead kind="percent">{t("overservicing")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.lines.map((line) => (
            <TableRow key={line.id} className={line.cancelledAt ? "opacity-60" : ""}>
              <TableCell>
                <span className={line.cancelledAt ? "line-through" : ""}>{line.title}</span>
                {line.format ? <span className="ml-1 text-xs text-muted-foreground">{tWork(`formats.${line.format as "post"}`)}</span> : null}
              </TableCell>
              <TableCell kind="number">{line.quantity}</TableCell>
              <TableCell kind="number">{view.period.carried[line.title] ? (view.period.carried[line.title] > 0 ? `+${view.period.carried[line.title]}` : view.period.carried[line.title]) : "—"}</TableCell>
              <TableCell kind="number">{line.consumed}</TableCell>
              <TableCell kind="number">{line.usage.remaining}</TableCell>
              <TableCell kind="percent">
                <Badge variant={levelVariant(line.usage.level)}>{percent(line.usage)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
          {!view.billing && view.period.status === "closed" && waitingPeriods.has(view.period.id) ? <dd className="text-xs text-muted-foreground">{tAcceptance("monthNotBilled")}</dd> : null}
        </div>
      </dl>
    </div>
  );

  return (
    <Page>
      <ProjectHeader context={context} current="retainer" />

      {plan.kind !== "retainer" ? <Alert>{t("notRetainer")}</Alert> : null}

      {retainer ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2>{t("terms")}</h2>
              <Badge dot variant={retainer.isActive ? "success" : "outline"}>{retainer.isActive ? t("active") : t("inactive")}</Badge>
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
          </CardContent>
        </Card>
      ) : plan.kind === "retainer" ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}

      {current ? (
        <TableCard>
          <TableCardHeader title={t("thisMonth", { month: current.period.month })} actions={<Badge variant={levelVariant(current.total.level)}>{t("overservicingValue", { percent: percent(current.total) })}</Badge>} />
          <div className="p-4">{report(current)}</div>
        </TableCard>
      ) : null}

      {past.length ? (
        <TableCard>
          <TableCardHeader title={t("report")} count={past.length} />
          <List>
            {past.map((view) => (
              <ListItem key={view.period.id} className="block">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-medium">{view.period.month}</span>
                    <Badge variant="outline">{t(`periodStatus.${view.period.status as "open"}`)}</Badge>
                    <Badge variant={levelVariant(view.total.level)}>{t("overservicingValue", { percent: percent(view.total) })}</Badge>
                  </summary>
                  <div className="pt-3">{report(view)}</div>
                </details>
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {editable ? (
        <section className="flex flex-col gap-2">
          <h2>{retainer ? t("edit") : t("setUp")}</h2>
          <RetainerForm
            projectId={project.id}
            values={retainer ? { startMonth: retainer.startMonth, endMonth: retainer.endMonth, lines: retainer.lines, minutesPerMonth: retainer.minutesPerMonth, ...("feePerMonthVnd" in retainer ? { feePerMonthVnd: retainer.feePerMonthVnd } : {}), rollover: retainer.rollover, isActive: retainer.isActive } : null}
            rollovers={RETAINER_ROLLOVERS}
            editFee={can.editFees}
            defaultMonth={today.slice(0, 7)}
          />
        </section>
      ) : null}
    </Page>
  );
}
