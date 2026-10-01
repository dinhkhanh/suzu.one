import { CalendarCheck, ClipboardList, Coffee } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { getToday } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { PlanTodayButton, QuickAdd, QuickLog } from "@/modules/daily/ui/quick-actions";
import { TimeList } from "@/modules/daily/ui/time-list";
import { RunningTimer, TimerButton } from "@/modules/daily/ui/timer";
import { requireUser } from "@/modules/platform/auth/session";
import { createTaskAction } from "@/modules/work/actions";
import { type DayTask, listCreateTargets, listStates, loadViewer } from "@/modules/work/service";
import { ClientDecisionQuick } from "@/modules/work/ui/client-decision";
import { HandoffResponder } from "@/modules/work/ui/handoff";
import { TaskStateSelect } from "@/modules/work/ui/task-state-select";
import { pageTitle } from "@/i18n/page-title";
import { listPersonNames } from "@/modules/platform/people/service";
import { canEditActivity, listFollowUpsOf, listSalesHandoffsFor, loadCrm } from "@/modules/crm/service";
import { HandoffAnswerForm } from "@/modules/crm/ui/deal-forms";
import { FollowUpList } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("today");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

// FR-PJM-20: the landing page. One column, thumb-sized controls: what I planned, what is due,
// what waits for me, and the plan and report one tap away (FR-PJM-37). On a day off it says so
// and asks for nothing.
export default async function TodayPage() {
  const user = await requireUser();
  const date = todayInVietnam();
  const [t, format, view, viewer] = await Promise.all([getTranslations("daily"), getFormatter(), getToday(user.person.id, date), loadViewer(user)]);
  const tasksOnScreen = [...view.planned, ...view.due];
  // The CRM's share of the day (FR-CRM-06, 16, 43): client follow-ups due, won deals handed over.
  const [targets, states, followUps, salesHandoffs, crm] = await Promise.all([listCreateTargets(viewer), listStates([...new Set(tasksOnScreen.map((task) => task.teamId))]), listFollowUpsOf(user.person.id, date), listSalesHandoffsFor(user.person.id), loadCrm(user)]);
  const people = followUps.length ? await listPersonNames() : [];
  const statesOf = (teamId: string) => states.filter((state) => state.teamId === teamId && state.isActive).map(({ id, name, category }) => ({ id, name, category }));
  const day = view.day;
  const off = !!day?.dayOff;
  // Which of the day's projects are billed to a client: the quick log starts from it (FR-PJM-24).
  const billable = new Set(view.billableProjects);
  const plannedMinutes = view.planned.reduce((total, task) => total + (task.plannedMinutes ?? 0), 0);
  const loggedMinutes = view.time.reduce((total, entry) => total + entry.minutes, 0);
  const shortDate = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const offReason = day?.day.kind === "untracked" ? "untracked" : (day?.report.reason ?? "rest");

  const taskRow = (task: DayTask & { plannedMinutes?: number | null }, extra?: ReactNode) => (
    <ListItem key={task.taskId} className="flex-col items-stretch gap-2">
      <div className="flex items-start gap-2">
        <Link href={`/work/tasks/${task.taskId}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
          <span className="font-mono text-xs text-muted-foreground">{task.key}</span> <span className={task.status === "done" ? "text-muted-foreground line-through" : undefined}>{task.title}</span>
          <span className="block text-xs font-normal text-muted-foreground">{[task.projectName, task.plannedMinutes ? t("hours", { value: hoursOf(task.plannedMinutes) }) : null, task.dueDate ? t("today.due", { date: shortDate(task.dueDate) }) : null].filter(Boolean).join(" · ")}</span>
        </Link>
        {task.dueDate && task.dueDate < date && task.status !== "done" ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TaskStateSelect taskId={task.taskId} stateId={task.stateId} states={statesOf(task.teamId)} />
        {extra}
        {task.status === "done" || task.status === "cancelled" ? null : (
          <>
            <TimerButton taskId={task.taskId} running={view.timer?.taskId === task.taskId} />
            <QuickLog date={date} taskId={task.taskId} billable={!!task.projectId && billable.has(task.projectId)} />
          </>
        )}
      </div>
    </ListItem>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>{t("today.title")}</h1>
      </header>

      {off ? (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Coffee className="mt-0.5 size-5 text-primary" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">{day?.day.name ?? t(`today.off.${offReason === "leave" || offReason === "holiday" || offReason === "untracked" ? offReason : "rest"}`)}</p>
            <p className="text-sm text-muted-foreground">{t("today.offHint")}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarCheck className="size-4" aria-hidden /> {t("today.plan")}
              {day?.plan.required ? <Badge variant="outline">{t("required")}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{view.plan?.submittedAt ? t("today.planned", { count: view.planned.length, planned: hoursOf(plannedMinutes), available: hoursOf(day?.minutes ?? 0) }) : day?.plan.required ? t("today.planBy", { time: day.rules.planCutoff }) : t("today.notPlanned")}</p>
            <Link href="/daily/plan" className={buttonVariants({ size: "lg", variant: view.plan?.submittedAt ? "outline" : "default" })}>
              {view.plan?.submittedAt ? t("today.editPlan") : t("today.makePlan")}
            </Link>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ClipboardList className="size-4" aria-hidden /> {t("today.report")}
              {view.report?.status === "submitted" ? <Badge dot variant={view.report.late ? "warning" : "success"}>{view.report.late ? t("late") : t("submitted")}</Badge> : day?.report.required ? <Badge variant="outline">{t("required")}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{view.report?.status === "submitted" ? t("today.reportSent") : day?.report.required ? t("today.reportBy", { time: day.rules.reportDeadline }) : t("today.reportOptional")}</p>
            <Link href={view.report?.status === "submitted" ? `/daily/reports/${view.report.id}` : "/daily/report"} className={buttonVariants({ size: "lg", variant: view.report?.status === "submitted" ? "outline" : "default" })}>
              {view.report?.status === "submitted" ? t("today.openReport") : t("today.writeReport")}
            </Link>
          </div>
        </div>
      )}

      {view.timer ? <RunningTimer label={view.timer.key ? `${view.timer.key} ${view.timer.title ?? ""}` : t(`time.categories.${(view.timer.category ?? "internal") as "internal"}`)} startedAt={view.timer.startedAt.toISOString()} /> : null}

      <QuickAdd targets={targets} createTask={createTaskAction} selfId={user.person.id} today={date} />

      <TableCard>
        <TableCardHeader title={t("today.plannedTasks", { count: view.planned.length })} />
        <List>
          {view.planned.length === 0 ? <ListEmpty>{off ? t("today.nothingPlannedOff") : t("today.nothingPlanned")}</ListEmpty> : null}
          {view.planned.map((task) => taskRow(task))}
        </List>
      </TableCard>

      {view.due.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.dueTasks", { count: view.due.length })} />
          <List>{view.due.map((task) => taskRow(task, <PlanTodayButton taskId={task.taskId} />))}</List>
        </TableCard>
      ) : null}

      {view.reviews.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.reviews", { count: view.reviews.length })} />
          <List>
            {view.reviews.map((review) => (
              <ListItem key={review.taskId} className="flex-col items-stretch gap-2">
                <div>
                  <Link href={`/work/tasks/${review.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{review.key}</span> {review.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[review.stageName, t("today.reviewFrom", { name: review.submittedByName ?? "—", version: review.version })].filter(Boolean).join(" · ")}</p>
                </div>
                {/* FR-PJM-37: the client's decision in three taps — decision, photo of their message, saved. */}
                {review.isClient ? <ClientDecisionQuick target={{ kind: "stage", taskId: review.taskId }} version={review.version} /> : null}
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {view.handoffs.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.handoffs", { count: view.handoffs.length })} />
          <List>
            {view.handoffs.map((handoff) => (
              <ListItem key={handoff.handoffId} className="flex-col items-stretch gap-2">
                <div>
                  <Link href={`/work/tasks/${handoff.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{handoff.key}</span> {handoff.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t("today.handoffFrom", { name: handoff.fromName ?? "—" })}</p>
                </div>
                <HandoffResponder handoffId={handoff.handoffId} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {salesHandoffs.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.salesHandoffs", { count: salesHandoffs.length })} />
          <List>
            {salesHandoffs.map((handoff) => (
              <ListItem key={handoff.projectId} className="flex-col items-stretch gap-2">
                <div>
                  <Link href={`/crm/deals/${handoff.dealId}`} className="font-medium hover:underline">
                    {handoff.dealTitle}
                  </Link>{" "}
                  → <Link href={`/projects/${handoff.projectId}`}>{handoff.projectName}</Link>
                  <p className="text-xs text-muted-foreground">{t("today.handoffFrom", { name: handoff.fromName ?? "—" })}</p>
                </div>
                <HandoffAnswerForm projectId={handoff.projectId} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {followUps.length > 0 ? (
        <Section title={t("today.followUps", { count: followUps.length })}>
          <FollowUpList items={followUps} canEdit={(item) => canEditActivity(crm.viewer, item, null)} people={people} meId={user.person.id} today={date} />
        </Section>
      ) : null}

      {view.blockersRaised.length + view.blockersWaiting.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.blockers", { count: view.blockersRaised.length + view.blockersWaiting.length })} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("today.columns.key")}</TableHead>
                <TableHead kind="text">{t("today.columns.title")}</TableHead>
                <TableHead kind="status">{t("today.columns.status")}</TableHead>
                <TableHead kind="text">{t("today.columns.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...view.blockersWaiting.map((blocker) => ({ blocker, waiting: true })), ...view.blockersRaised.map((blocker) => ({ blocker, waiting: false }))].map(({ blocker, waiting }) => (
                <TableRow key={blocker.blockerId}>
                  <TableCell kind="id">{blocker.key}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    <Link href={`/work/tasks/${blocker.taskId}`} className="font-medium hover:underline">
                      {blocker.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={waiting ? "destructive" : "warning"}>{waiting ? t("today.waitingOnYou") : t("today.youRaised")}</Badge>
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-muted-foreground">{waiting ? t("today.blockerBy", { name: blocker.raisedByName ?? "—", reason: blocker.reason }) : blocker.neededName ? t("today.blockerNeeds", { name: blocker.neededName, reason: blocker.reason }) : blocker.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {view.bookings.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("today.bookings")} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("today.columns.project")}</TableHead>
                <TableHead kind="status">{t("today.columns.status")}</TableHead>
                <TableHead kind="time">{t("today.columns.hours")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.bookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell>
                    <Link href={`/work/projects/${booking.projectId}`} className="hover:underline">
                      {booking.projectName}
                    </Link>
                  </TableCell>
                  <TableCell>{booking.status === "tentative" ? <Badge variant="outline">{t("today.tentative")}</Badge> : null}</TableCell>
                  <TableCell kind="time">{t("hours", { value: hoursOf(booking.minutes) })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      <Section title={t("today.time", { value: hoursOf(loggedMinutes) })}>
        <TimeList entries={view.time.map(({ id, key, title, category, minutes, billable }) => ({ id, key, title, category, minutes, billable }))} />
        <div className="flex flex-wrap items-center gap-2">
          <QuickLog date={date} tasks={[...view.planned, ...view.open.filter((task) => !view.planned.some((row) => row.taskId === task.taskId))].filter((task) => task.status !== "cancelled").map((task) => ({ id: task.taskId, label: `${task.key} ${task.title}`, billable: !!task.projectId && billable.has(task.projectId) }))} />
          <Link href="/daily/time" className={buttonVariants({ size: "xs", variant: "ghost" })}>
            {t("time.openWeek")}
          </Link>
        </div>
      </Section>
    </div>
  );
}
