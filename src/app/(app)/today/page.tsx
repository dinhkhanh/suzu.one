import { ArrowRightLeft, Check, Clock, Coffee, Eye, Handshake, OctagonAlert } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCheckInState } from "@/modules/attendance/punches";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { getToday } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { PlanTodayButton, QuickAdd, QuickLog } from "@/modules/daily/ui/quick-actions";
import { DoneCheck } from "@/modules/daily/ui/task-row";
import { TimeList } from "@/modules/daily/ui/time-list";
import { RunningTimer, TimerButton } from "@/modules/daily/ui/timer";
import { requireUser } from "@/modules/platform/auth/session";
import { createTaskAction, updateTaskAction } from "@/modules/work/actions";
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

/** The hour on the wall in Vietnam, for the greeting: the server may stand anywhere. */
const vietnamHour = (now: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hourCycle: "h23" }).format(now));
const partOfDay = (hour: number): "morning" | "afternoon" | "evening" => (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
/** The given name is the last word of a Vietnamese full name. */
const givenNameOf = (fullName: string) => fullName.trim().split(/\s+/).at(-1) ?? fullName;

/** The round icon that heads a row of things waiting, one hue per kind. */
function IconTile({ icon, tone }: { icon: ReactNode; tone: "violet" | "teal" | "orange" | "destructive" | "muted" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
        tone === "violet" && "bg-tone-violet/12 text-tone-violet",
        tone === "teal" && "bg-tone-teal/12 text-tone-teal",
        tone === "orange" && "bg-tone-orange/12 text-tone-orange",
        tone === "destructive" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground"
      )}
    >
      {icon}
    </span>
  );
}

const rise = (index: number) => ({ className: "rise", style: { "--i": index } as CSSProperties });

// FR-PJM-20: the landing page. One column, thumb-sized controls: where the day stands (checked in,
// planned, reported), what I planned, what is due, what waits for me, and the plan and report one
// tap away (FR-PJM-37). On a day off it says so and asks for nothing.
export default async function TodayPage() {
  const user = await requireUser();
  const now = new Date();
  const date = todayInVietnam(now);
  const [t, format, view, viewer, checkIn] = await Promise.all([getTranslations("daily"), getFormatter(), getToday(user.person.id, date), loadViewer(user), getCheckInState(user.person, now)]);
  const tasksOnScreen = [...view.planned, ...view.due];
  // The CRM's share of the day (FR-CRM-06, 16, 43): client follow-ups due, won deals handed over.
  const [targets, states, followUps, salesHandoffs, crm] = await Promise.all([listCreateTargets(viewer), listStates([...new Set(tasksOnScreen.map((task) => task.teamId))]), listFollowUpsOf(user.person.id, date), listSalesHandoffsFor(user.person.id), loadCrm(user)]);
  const people = followUps.length ? await listPersonNames() : [];
  const statesOf = (teamId: string) => states.filter((state) => state.teamId === teamId && state.isActive).map(({ id, name, category }) => ({ id, name, category }));
  const doneStateOf = (teamId: string) => statesOf(teamId).find((state) => state.category === "done")?.id ?? null;
  const day = view.day;
  const off = !!day?.dayOff;
  // Which of the day's projects are billed to a client: the quick log starts from it (FR-PJM-24).
  const billable = new Set(view.billableProjects);
  const plannedMinutes = view.planned.reduce((total, task) => total + (task.plannedMinutes ?? 0), 0);
  const loggedMinutes = view.time.reduce((total, entry) => total + entry.minutes, 0);
  const shortDate = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const clock = (value: Date) => format.dateTime(value, { hour: "2-digit", minute: "2-digit" });
  const offReason = day?.day.kind === "untracked" ? "untracked" : (day?.report.reason ?? "rest");
  const reportSent = view.report?.status === "submitted";
  const reportDue = !reportSent && !!day?.report.required;

  // The check-in strip: the last punch of the day says where the person stands.
  const employed = user.person.status === "active" && !!user.person.primaryEntityId;
  const lastIn = [...checkIn.punches].reverse().find((punch) => punch.direction === "in");
  const lastOut = [...checkIn.punches].reverse().find((punch) => punch.direction === "out");
  const checkedIn = checkIn.nextDirection === "out" && !!lastIn;
  const elapsed = lastIn ? Math.max(0, Math.floor((now.getTime() - lastIn.at.getTime()) / 60_000)) : 0;
  const checkInLine = checkedIn && lastIn ? `${t("today.checkedIn", { time: clock(lastIn.at) })} · ${t("today.elapsed", { hours: Math.floor(elapsed / 60), minutes: elapsed % 60 })}` : lastOut ? t("today.checkedOut", { time: clock(lastOut.at) }) : t("today.notCheckedIn");

  const waiting = view.reviews.length + view.handoffs.length + salesHandoffs.length + view.blockersWaiting.length + view.blockersRaised.length + followUps.length;

  const taskRow = (task: DayTask & { plannedMinutes?: number | null }, index: number, extra?: ReactNode) => {
    const closed = task.status === "done" || task.status === "cancelled";
    const running = view.timer?.taskId === task.taskId;
    return (
      <ListItem key={task.taskId} {...rise(index)} className="rise flex-col items-stretch gap-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex shrink-0 flex-col">
            <DoneCheck taskId={task.taskId} doneStateId={doneStateOf(task.teamId)} done={task.status === "done"} action={updateTaskAction} />
          </span>
          <Link href={`/work/tasks/${task.taskId}`} className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              <span className="font-mono text-xs font-normal text-muted-foreground">{task.key}</span>{" "}
              <span className={task.status === "done" ? "text-muted-foreground line-through" : undefined}>{task.title}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">{[task.projectName, task.plannedMinutes ? t("hours", { value: hoursOf(task.plannedMinutes) }) : null, task.dueDate ? t("today.due", { date: shortDate(task.dueDate) }) : null].filter(Boolean).join(" · ")}</span>
          </Link>
          {running ? (
            <Badge dot variant="info">
              {t("today.timerRunning")}
            </Badge>
          ) : task.dueDate && task.dueDate < date && !closed ? (
            <Badge variant="destructive">{t("overdue")}</Badge>
          ) : task.dueDate === date && !closed ? (
            <Badge variant="warning">{t("dueToday")}</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-9">
          <TaskStateSelect taskId={task.taskId} stateId={task.stateId} states={statesOf(task.teamId)} />
          {extra}
          {closed ? null : (
            <>
              <TimerButton taskId={task.taskId} running={running} />
              <QuickLog date={date} taskId={task.taskId} billable={!!task.projectId && billable.has(task.projectId)} />
            </>
          )}
        </div>
      </ListItem>
    );
  };

  const planCard = (
    <Link href="/daily/plan" className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] border border-border bg-background p-4 hover:bg-canvas">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {view.plan?.submittedAt ? <Check aria-hidden className="size-3.5 text-success" strokeWidth={2.5} /> : null}
        {t("today.planShort")}
      </span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{view.plan?.submittedAt ? t("today.planSummary", { count: view.planned.length, planned: hoursOf(plannedMinutes), available: hoursOf(day?.minutes ?? 0) }) : day?.plan.required ? t("today.planBy", { time: day.rules.planCutoff }) : t("today.makePlan")}</span>
    </Link>
  );

  const reportCard = reportDue ? (
    <Link href="/daily/report" className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] bg-primary p-4 text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_10%)]">
      <span className="text-xs text-primary-foreground/80">{t("today.reportShort")}</span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{t("today.writeReportBy", { time: day!.rules.reportDeadline })}</span>
    </Link>
  ) : (
    <Link href={reportSent ? `/daily/reports/${view.report!.id}` : "/daily/report"} className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] border border-border bg-background p-4 hover:bg-canvas">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {reportSent ? <Check aria-hidden className={cn("size-3.5", view.report!.late ? "text-warning" : "text-success")} strokeWidth={2.5} /> : null}
        {t("today.reportShort")}
      </span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{reportSent ? t("today.reportDone") : t("today.writeReport")}</span>
      {!reportSent ? <span className="text-xs text-muted-foreground">{t("today.reportOptional")}</span> : null}
    </Link>
  );

  return (
    <Page width="narrow">
      <PageHeader
        className="flex-row items-start justify-between gap-4"
        eyebrow={format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}
        title={t(`today.greeting.${partOfDay(vietnamHour(now))}`, { name: givenNameOf(user.person.fullName) })}
        actions={
          <Link href="/me" aria-label={t("today.profile")} className="press rounded-full">
            <PersonAvatar person={user.person} size="lg" />
          </Link>
        }
      />

      {off ? (
        <div className="flex items-center gap-3.5 rounded-[14px] border border-border bg-background p-4">
          <IconTile tone="muted" icon={<Coffee />} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium">{day?.day.name ?? t(`today.off.${offReason === "leave" || offReason === "holiday" || offReason === "untracked" ? offReason : "rest"}`)}</p>
            <p className="text-sm text-muted-foreground">{t("today.offHint")}</p>
          </div>
        </div>
      ) : (
        <>
          {employed ? (
            <div className="flex items-center gap-3.5 rounded-[14px] border border-border bg-background py-3 pr-3 pl-4">
              <IconTile tone={checkedIn ? "teal" : "muted"} icon={<Clock />} />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{checkInLine}</p>
              <Link href="/attendance/check-in" className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t(checkIn.nextDirection === "out" ? "today.checkOut" : "today.checkIn")}
              </Link>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
            {planCard}
            {reportCard}
          </div>
        </>
      )}

      {view.timer ? <RunningTimer label={view.timer.key ? `${view.timer.key} ${view.timer.title ?? ""}` : t(`time.categories.${(view.timer.category ?? "internal") as "internal"}`)} startedAt={view.timer.startedAt.toISOString()} /> : null}

      <Section title={t("today.planSection")} count={view.planned.length || undefined}>
        <QuickAdd targets={targets} createTask={createTaskAction} selfId={user.person.id} today={date} />
        <List>
          {view.planned.length === 0 ? <ListEmpty>{off ? t("today.nothingPlannedOff") : t("today.planHint")}</ListEmpty> : null}
          {view.planned.map((task, index) => taskRow(task, index))}
        </List>
      </Section>

      {view.due.length > 0 ? (
        <Section title={t("today.dueSection")} count={view.due.length}>
          <List>{view.due.map((task, index) => taskRow(task, index, <PlanTodayButton taskId={task.taskId} />))}</List>
        </Section>
      ) : null}

      {waiting > 0 ? (
        <Section title={t("today.waiting")} count={waiting}>
          {waiting - followUps.length > 0 ? (
            <List>
              {view.reviews.map((review, index) => (
                <ListItem key={`review:${review.taskId}`} {...rise(index)} className="rise flex-col items-stretch gap-2">
                  <div className="flex items-center gap-3">
                    <IconTile tone="violet" icon={<Eye />} />
                    <Link href={`/work/tasks/${review.taskId}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        <span className="font-mono text-xs font-normal text-muted-foreground">{review.key}</span> {review.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{[review.stageName, t("today.reviewFrom", { name: review.submittedByName ?? "—", version: review.version })].filter(Boolean).join(" · ")}</span>
                    </Link>
                    <Badge variant="violet">{t("today.review")}</Badge>
                  </div>
                  {/* FR-PJM-37: the client's decision in three taps — decision, photo of their message, saved. */}
                  {review.isClient ? (
                    <div className="pl-12">
                      <ClientDecisionQuick target={{ kind: "stage", taskId: review.taskId }} version={review.version} />
                    </div>
                  ) : null}
                </ListItem>
              ))}
              {view.handoffs.map((handoff, index) => (
                <ListItem key={`handoff:${handoff.handoffId}`} {...rise(view.reviews.length + index)} className="rise flex-col items-stretch gap-2">
                  <div className="flex items-center gap-3">
                    <IconTile tone="teal" icon={<ArrowRightLeft />} />
                    <Link href={`/work/tasks/${handoff.taskId}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        <span className="font-mono text-xs font-normal text-muted-foreground">{handoff.key}</span> {handoff.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{t("today.handoffFrom", { name: handoff.fromName ?? "—" })}</span>
                    </Link>
                    <Badge variant="teal">{t("today.handoff")}</Badge>
                  </div>
                  <div className="pl-12">
                    <HandoffResponder handoffId={handoff.handoffId} />
                  </div>
                </ListItem>
              ))}
              {salesHandoffs.map((handoff, index) => (
                <ListItem key={`sales:${handoff.projectId}`} {...rise(view.reviews.length + view.handoffs.length + index)} className="rise flex-col items-stretch gap-2">
                  <div className="flex items-center gap-3">
                    <IconTile tone="orange" icon={<Handshake />} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        <Link href={`/crm/deals/${handoff.dealId}`} className="hover:underline">
                          {handoff.dealTitle}
                        </Link>
                        <span className="text-muted-foreground"> → </span>
                        <Link href={`/projects/${handoff.projectId}`} className="hover:underline">
                          {handoff.projectName}
                        </Link>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{t("today.handoffFrom", { name: handoff.fromName ?? "—" })}</span>
                    </div>
                    <Badge variant="orange">{t("today.salesHandoff")}</Badge>
                  </div>
                  <div className="pl-12">
                    <HandoffAnswerForm projectId={handoff.projectId} />
                  </div>
                </ListItem>
              ))}
              {[...view.blockersWaiting.map((blocker) => ({ blocker, waiting: true })), ...view.blockersRaised.map((blocker) => ({ blocker, waiting: false }))].map(({ blocker, waiting: onMe }, index) => (
                <ListItem key={`blocker:${blocker.blockerId}`} {...rise(view.reviews.length + view.handoffs.length + salesHandoffs.length + index)} className="rise">
                  <IconTile tone={onMe ? "destructive" : "muted"} icon={<OctagonAlert />} />
                  <Link href={`/work/tasks/${blocker.taskId}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      <span className="font-mono text-xs font-normal text-muted-foreground">{blocker.key}</span> {blocker.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{onMe ? t("today.blockerBy", { name: blocker.raisedByName ?? "—", reason: blocker.reason }) : blocker.neededName ? t("today.blockerNeeds", { name: blocker.neededName, reason: blocker.reason }) : blocker.reason}</span>
                  </Link>
                  <Badge variant={onMe ? "destructive" : "warning"}>{onMe ? t("today.waitingOnYou") : t("today.youRaised")}</Badge>
                </ListItem>
              ))}
            </List>
          ) : null}
          {followUps.length > 0 ? <FollowUpList items={followUps} canEdit={(item) => canEditActivity(crm.viewer, item, null)} people={people} meId={user.person.id} today={date} /> : null}
        </Section>
      ) : null}

      {view.bookings.length > 0 ? (
        <Section title={t("today.bookings")}>
          <Table numbered={false}>
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
        </Section>
      ) : null}

      <Section
        title={t("today.timeSection")}
        count={<span className="normal-case">{t("hours", { value: hoursOf(loggedMinutes) })}</span>}
        action={
          <Link href="/daily/time" className="text-link">
            {t("time.openWeek")}
          </Link>
        }
      >
        <TimeList entries={view.time.map(({ id, key, title, category, minutes, billable }) => ({ id, key, title, category, minutes, billable }))} />
        <div className="flex flex-wrap items-center gap-2">
          <QuickLog date={date} tasks={[...view.planned, ...view.open.filter((task) => !view.planned.some((row) => row.taskId === task.taskId))].filter((task) => task.status !== "cancelled").map((task) => ({ id: task.taskId, label: `${task.key} ${task.title}`, billable: !!task.projectId && billable.has(task.projectId) }))} />
        </div>
      </Section>
    </Page>
  );
}
