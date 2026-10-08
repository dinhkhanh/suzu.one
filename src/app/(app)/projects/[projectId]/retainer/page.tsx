import { Fragment } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import {
  awaitingAcceptance,
  canEditRetainer,
  getRetainer,
  lineLabel,
  listMissedMonths,
  listPeriods,
  listTaskLinks,
  openLinesFirst,
  openProject,
  type PeriodView,
  REGISTER_STATUSES,
  RETAINER_ROLLOVERS,
  shapeRetainer,
  type Usage,
  type UsageLevel,
} from "@/modules/projects/service";
import { LineUnlinkButton, LinkToLineForm, MissedMonthForm, RetainerForm } from "@/modules/projects/ui/commercial-forms";
import { CancelLineButton, DeliverableForm, LineTasksForm } from "@/modules/projects/ui/plan-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { listAssignable } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("retainer");

const levelVariant = (level: UsageLevel) => (level === "over" ? "destructive" : level === "full" ? "warning" : level === "warning" ? "warning" : "secondary");

/**
 * A retainer (FR-PJM-06): its monthly terms, this month's quota line by line — carried units,
 * consumed, overservicing — the hours allowance against what was logged, and every past month as
 * the monthly retainer report. The monthly fee and its billing state only for `pjm:commercial`.
 *
 * A month is worked here: each line shows what was delivered and accepted and the tasks that fill
 * it, and whoever may edit the plan links a task of the project to a line (a finished one too),
 * makes tasks on a line, takes one off, and edits or withdraws the month's line. A month the job
 * never made — the terms were saved after it began — is made by the lead, from the terms.
 */
export default async function ProjectRetainerPage({ params }: PageProps<"/projects/[projectId]/retainer">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, team, plan, can, viewer, facts } = context;
  const [t, tProjects, tWork, tAcceptance, format, row, waiting] = await Promise.all([
    getTranslations("projects.retainer"),
    getTranslations("projects"),
    getTranslations("work"),
    getTranslations("projects.acceptance"),
    getFormatter(),
    getRetainer(project.id),
    awaitingAcceptance(project.id),
  ]);
  // Months closed but not yet billed because the client has not signed their biên bản (Q22).
  const waitingPeriods = new Set((waiting ?? []).flatMap((item) => (item.retainerPeriodId ? [item.retainerPeriodId] : [])));
  const retainer = row ? shapeRetainer(row, can.seeFees) : null;
  const editable = canEditRetainer(viewer, facts) && plan.kind === "retainer";
  const today = todayInVietnam();
  // The project's tasks with the line each fills, the people a line's new tasks may go to, and the
  // earlier months still to be made: each read once for the page, whatever the number of months.
  const [periods, links, people, missed] = await Promise.all([
    row ? listPeriods(row, can.seeFees) : [],
    row ? listTaskLinks(project.id) : [],
    row && can.editPlan ? listAssignable(team.id, project.id) : [],
    row && editable ? listMissedMonths(row, today) : [],
  ]);
  const current = periods.find((period) => period.period.status === "open" && period.period.month === today.slice(0, 7)) ?? null;
  const past = periods.filter((period) => period !== current);
  const tasksOf = Map.groupBy(
    links.filter((link) => link.deliverableId),
    (link) => link.deliverableId!,
  );
  // What the link form offers: tasks on no line yet — done ones too, the work is often finished
  // before anyone records which promise it filled — and every live line, this month's first.
  const linkable = links.filter((link) => !link.deliverableId && link.status !== "cancelled").map((link) => ({ id: link.taskId, key: link.key, title: link.title }));
  const lineChoices = openLinesFirst(
    periods.flatMap((view) => view.lines.filter((line) => !line.cancelledAt).map((line) => ({ id: line.id, title: line.title, quantity: line.quantity, month: view.period.month as string | null }))),
    today.slice(0, 7),
  ).map((line) => ({ id: line.id, label: lineLabel(line) }));
  const columns = 8;
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const percent = (usage: Usage) => (usage.percent === null ? "—" : `${usage.percent}%`);

  const report = (view: PeriodView) => (
    <div className="flex flex-col gap-3">
      <Table numbered={false} className="min-w-[42rem]">
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("line")}</TableHead>
            <TableHead kind="number">{t("quota")}</TableHead>
            <TableHead kind="number">{t("carried")}</TableHead>
            <TableHead kind="number">{t("delivered")}</TableHead>
            <TableHead kind="number">{t("accepted")}</TableHead>
            <TableHead kind="number">{t("consumed")}</TableHead>
            <TableHead kind="number">{t("remaining")}</TableHead>
            <TableHead kind="percent">{t("overservicing")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.lines.map((line) => {
            const own = tasksOf.get(line.id) ?? [];
            const cancelled = !!line.cancelledAt;
            return (
              <Fragment key={line.id}>
                <TableRow className={cancelled ? "opacity-60" : ""}>
                  <TableCell>
                    <span className={cancelled ? "line-through" : ""}>{line.title}</span>
                    {line.format ? <span className="ml-1 text-xs text-muted-foreground">{tWork(`formats.${line.format as "post"}`)}</span> : null}
                  </TableCell>
                  <TableCell kind="number">{line.quantity}</TableCell>
                  <TableCell kind="number">{view.period.carried[line.title] ? (view.period.carried[line.title] > 0 ? `+${view.period.carried[line.title]}` : view.period.carried[line.title]) : "—"}</TableCell>
                  <TableCell kind="number">{cancelled ? "—" : line.counts.delivered + line.counts.published}</TableCell>
                  <TableCell kind="number">{cancelled ? "—" : line.accepted}</TableCell>
                  <TableCell kind="number">{line.consumed}</TableCell>
                  <TableCell kind="number">{line.usage.remaining}</TableCell>
                  <TableCell kind="percent">
                    <Badge variant={levelVariant(line.usage.level)}>{percent(line.usage)}</Badge>
                  </TableCell>
                </TableRow>
                {own.length > 0 || can.editPlan ? (
                  <TableRow data-unnumbered="" className="hover:bg-transparent">
                    <TableCell colSpan={columns} className="h-auto py-0 whitespace-normal">
                      <details className="group/line">
                        <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-x-3 text-xs text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                          <span className="text-link">{own.length ? tProjects("register.tasksLinked", { count: own.length }) : tProjects("register.manage")}</span>
                          {!cancelled
                            ? REGISTER_STATUSES.filter((status) => line.counts[status] > 0).map((status) => (
                                <span key={status} className="font-mono tabular-nums">
                                  {tProjects(`register.status.${status}`)} {line.counts[status]}
                                </span>
                              ))
                            : null}
                        </summary>
                        <div className="flex flex-col gap-4 pb-4">
                          {own.length ? (
                            <ul className="flex flex-col gap-1 text-sm">
                              {own.map((task) => (
                                <li key={task.taskId} className="flex flex-wrap items-center gap-2">
                                  <RecordLink kind="task" id={task.taskId}>
                                    <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                                  </RecordLink>
                                  <Badge variant="secondary">{tProjects(`plan.taskStatus.${task.status as "todo"}`)}</Badge>
                                  <RecordLink kind="person" id={task.assigneePersonId} className="text-xs text-muted-foreground">
                                    {task.assigneeName}
                                  </RecordLink>
                                  {can.editPlan ? <LineUnlinkButton taskId={task.taskId} /> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {can.editPlan ? (
                            <>
                              {!cancelled ? <LineTasksForm deliverableId={line.id} missing={Math.max(0, line.quantity - line.linked)} people={people} /> : null}
                              <DeliverableForm
                                projectId={project.id}
                                line={{ id: line.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: line.dueDate, milestoneId: line.milestoneId, sortOrder: line.sortOrder }}
                                milestones={[]}
                              />
                              <div>
                                <CancelLineButton deliverableId={line.id} cancelled={cancelled} />
                              </div>
                            </>
                          ) : null}
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("total")}</dt>
          <dd className="font-medium">{t("totalValue", { consumed: view.total.consumed, contracted: view.total.contracted, percent: percent(view.total) })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("hours")}</dt>
          <dd className="font-medium">
            {view.hours ? t("hoursValue", { logged: hours(view.loggedMinutes), allowance: hours(view.hours.contracted), percent: percent(view.hours) }) : t("hoursLogged", { logged: hours(view.loggedMinutes) })}
          </dd>
        </div>
        {"feeVnd" in view ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("fee")}</dt>
            <dd className="font-medium">{money(view.feeVnd)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{t("billing")}</dt>
          <dd className="font-medium">
            {view.billing ? `${t(`billingStatus.${view.billing.status as "ready"}`)}${view.billing.invoiceNumber ? ` · ${view.billing.invoiceNumber}` : ""}` : view.period.status === "open" ? t("billingAtMonthEnd") : "—"}
          </dd>
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
              <Badge dot variant={retainer.isActive ? "success" : "outline"}>
                {retainer.isActive ? t("active") : t("inactive")}
              </Badge>
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

      {can.editPlan && periods.length ? (
        <section className="flex flex-col gap-2">
          <h2>{t("linkTask")}</h2>
          <p className="text-sm text-muted-foreground">{t("linkHint")}</p>
          <LinkToLineForm tasks={linkable} lines={lineChoices} />
        </section>
      ) : null}

      {missed.length ? (
        <section className="flex flex-col gap-2">
          <h2>{t("missed.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("missed.hint")}</p>
          <MissedMonthForm projectId={project.id} months={missed} />
        </section>
      ) : null}

      {editable ? (
        <section className="flex flex-col gap-2">
          <h2>{retainer ? t("edit") : t("setUp")}</h2>
          <RetainerForm
            projectId={project.id}
            values={
              retainer
                ? {
                    startMonth: retainer.startMonth,
                    endMonth: retainer.endMonth,
                    lines: retainer.lines,
                    minutesPerMonth: retainer.minutesPerMonth,
                    ...("feePerMonthVnd" in retainer ? { feePerMonthVnd: retainer.feePerMonthVnd } : {}),
                    rollover: retainer.rollover,
                    isActive: retainer.isActive,
                  }
                : null
            }
            rollovers={RETAINER_ROLLOVERS}
            editFee={can.editFees}
            defaultMonth={today.slice(0, 7)}
          />
        </section>
      ) : null}
    </Page>
  );
}
