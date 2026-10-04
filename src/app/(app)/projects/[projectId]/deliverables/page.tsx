import { Fragment } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listStructure, listTaskLinks, loadRegisters, openProject, REGISTER_STATUSES, scopeLocked } from "@/modules/projects/service";
import { CancelLineButton, DeliverableForm, LineTasksForm, UnlinkButton } from "@/modules/projects/ui/plan-forms";
import { ProgressBar } from "@/modules/projects/ui/progress";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { listAssignable } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("deliverables");

/**
 * The deliverables register (FR-PJM-05): what the client was promised, line by line, and how far
 * each promise has come — computed from the linked tasks, one task per unit. Progress = accepted ÷
 * promised, where accepted is the client's recorded word: work finished on our side and not yet
 * answered is shown beside it (the paler stretch of each bar), never counted in it. The lead makes
 * the tasks of a line in one go, from the row's detail.
 */
export default async function ProjectDeliverablesPage({ params }: PageProps<"/projects/[projectId]/deliverables">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, team, can, plan } = context;
  // After the kick-off the register is the agreed scope: lines and quantities move through change requests.
  const locked = scopeLocked(plan);
  const [t, tWork, format, registers, structure, links, people] = await Promise.all([getTranslations("projects"), getTranslations("work"), getFormatter(), loadRegisters([project.id]), listStructure(project.id), listTaskLinks(project.id), can.editPlan ? listAssignable(team.id, project.id) : Promise.resolve([])]);
  const register = registers.get(project.id)!;
  const milestoneName = new Map(structure.milestones.map((milestone) => [milestone.id, milestone.name]));
  const milestones = structure.milestones.map(({ id, name }) => ({ id, name }));
  const tasksOf = Map.groupBy(links.filter((link) => link.deliverableId), (link) => link.deliverableId!);
  const today = todayInVietnam();
  const soon = addDays(today, 7);
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
  const columns = 7;

  return (
    <Page>
      <ProjectHeader context={context} current="deliverables" />

      <TableCard>
        <TableCardHeader title={t("register.title")} count={register.lines.length || null} description={register.promised ? [t("register.progress", { accepted: register.accepted, promised: register.promised, percent: register.percent ?? 0 }), register.awaitingClient ? t("register.awaitingClient", { count: register.awaitingClient }) : null].filter(Boolean).join(" · ") : t("register.empty")} />
        {register.promised ? (
          <div className="border-b px-4 py-3">
            <ProgressBar percent={register.percent} pending={Math.floor((register.awaitingClient / register.promised) * 100)} tone="success" label={t("register.title")} />
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("fields.deliverable")}</TableHead>
              <TableHead kind="select">{t("fields.milestone")}</TableHead>
              <TableHead kind="status">{t("fields.status")}</TableHead>
              <TableHead kind="percent">{t("register.columns.progress")}</TableHead>
              <TableHead kind="date">{t("fields.dueDate")}</TableHead>
              <TableHead kind="number">{t("register.columns.tasks")}</TableHead>
              {can.editPlan ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {register.lines.length === 0 ? <TableEmpty>{t("register.empty")}</TableEmpty> : null}
            {register.lines.map((line) => {
              const own = tasksOf.get(line.id) ?? [];
              const missing = Math.max(0, line.quantity - line.linked);
              const cancelled = line.status === "cancelled";
              const dueTone = cancelled || !line.dueDate || line.status === "accepted" || line.status === "delivered" || line.status === "published" ? "" : line.dueDate < today ? "text-destructive" : line.dueDate <= soon ? "text-warning" : "";
              const percent = cancelled ? null : line.promised ? Math.floor((line.accepted / line.promised) * 100) : 0;
              const detail = own.length > 0 || can.editPlan;
              return (
                <Fragment key={line.id}>
                  <TableRow className={cancelled ? "opacity-60" : undefined}>
                    <TableCell className="min-w-56 whitespace-normal">
                      <span className={`font-medium ${cancelled ? "line-through" : ""}`}>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">{line.quantity} ×</span> {line.title}
                      </span>
                      {line.format || line.channel ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {line.format ? <Badge variant="outline">{tWork(`formats.${line.format as "post"}`)}</Badge> : null}
                          {line.channel ? <Badge variant="outline">{tWork(`channels.${line.channel as "facebook"}`)}</Badge> : null}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{line.milestoneId ? (milestoneName.get(line.milestoneId) ?? "—") : "—"}</TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(line.status)}>
                        {t(`register.status.${line.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell kind="percent">
                      {cancelled ? (
                        "—"
                      ) : (
                        <span className="flex items-center justify-end gap-2">
                          <ProgressBar percent={percent} pending={line.promised ? Math.floor((line.awaitingClient / line.promised) * 100) : null} tone="success" className="w-16" />
                          <span>
                            {line.accepted}/{line.promised}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={`font-mono text-[0.8125rem] tabular-nums ${dueTone}`}>{date(line.dueDate)}</TableCell>
                    <TableCell kind="number">
                      {cancelled ? "—" : line.linked}
                      {!cancelled && missing > 0 ? <span className="text-faint"> / {line.quantity}</span> : null}
                    </TableCell>
                    {can.editPlan ? <TableCell kind="actions" /> : null}
                  </TableRow>
                  {detail ? (
                    <TableRow data-unnumbered="" className="hover:bg-transparent">
                      <TableCell colSpan={columns} className="h-auto py-0 whitespace-normal">
                        <details className="group/line">
                          <summary className="flex h-9 cursor-pointer list-none items-center gap-x-3 text-xs text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                            <span className="text-link">{own.length ? t("register.tasksLinked", { count: own.length }) : t("register.manage")}</span>
                            {!cancelled
                              ? REGISTER_STATUSES.filter((status) => line.counts[status] > 0).map((status) => (
                                  <span key={status} className="font-mono tabular-nums">
                                    {t(`register.status.${status}`)} {line.counts[status]}
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
                                    <RecordLink kind="person" id={task.assigneePersonId} className="text-xs text-muted-foreground">
                                      {task.assigneeName}
                                    </RecordLink>
                                    {can.editPlan ? <UnlinkButton taskId={task.taskId} /> : null}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {can.editPlan ? (
                              <>
                                {!cancelled ? <LineTasksForm deliverableId={line.id} missing={missing} people={people} /> : null}
                                <DeliverableForm projectId={project.id} line={{ id: line.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: line.dueDate, milestoneId: line.milestoneId, sortOrder: line.sortOrder }} milestones={milestones} scopeLocked={locked} />
                                {locked ? null : (
                                  <div>
                                    <CancelLineButton deliverableId={line.id} cancelled={cancelled} />
                                  </div>
                                )}
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
        {can.editPlan && !locked ? (
          <TableAddRow label={t("register.newLine")} open={register.lines.length === 0}>
            <DeliverableForm projectId={project.id} milestones={milestones} />
          </TableAddRow>
        ) : null}
        {can.editPlan && locked ? (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            {t("scope.registerLocked")}{" "}
            <Link href={`/projects/${project.id}/changes`} className="text-link hover:underline">
              {t("scope.raiseChange")}
            </Link>
          </p>
        ) : null}
      </TableCard>
    </Page>
  );
}
