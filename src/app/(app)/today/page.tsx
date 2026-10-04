import { Check, Clock, Coffee } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCheckInState } from "@/modules/attendance/punches";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { getToday, reportLink } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { RunningTimer } from "@/modules/daily/ui/timer";
import { requireUser } from "@/modules/platform/auth/session";
import { loadMyWork } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";
import { countOpenFollowUps, listAllFollowUpsOf } from "@/modules/crm/service";
import { DayLists, IconTile } from "./day-lists";
import { Inbox, INBOX_VIEWS, type InboxView, inboxCounts } from "./inbox";

export const generateMetadata = pageTitle("today");

const vietnamHour = (now: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hourCycle: "h23" }).format(now));
const partOfDay = (hour: number): "morning" | "afternoon" | "evening" => (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
/** The given name is the last word of a Vietnamese full name. */
const givenNameOf = (fullName: string) => fullName.trim().split(/\s+/).at(-1) ?? fullName;

const TABS = ["today", ...INBOX_VIEWS] as const;
type Tab = (typeof TABS)[number];

/** A person's open follow-ups: listed on the work tab, only counted on the others. */
async function openFollowUps(personId: string, tab: Tab) {
  if (tab === "work") {
    const list = await listAllFollowUpsOf(personId);
    return { list, count: list.length };
  }
  return { list: [], count: (await countOpenFollowUps([personId])).get(personId) ?? 0 };
}

// FR-PJM-20, FR-WRK-06: the landing page and the one inbox. One column, thumb-sized controls:
// where the day stands (checked in, planned, reported) and the plan and report one tap away
// (FR-PJM-37) on every tab; under it a row of tabs — the day itself (what I planned, what is due,
// what waits for me), then everything that waits for me by kind (`?view=`), server-rendered. On a
// day off it says so and asks for nothing.
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const user = await requireUser();
  const now = new Date();
  const date = todayInVietnam(now);
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.view as Tab) ? (query.view as Tab) : "today";
  // Every inbox list in one cached entry (work/my-work.ts): the tabs' counts come from it.
  const [t, tTasks, format, view, checkIn, mine, followUps] = await Promise.all([getTranslations("daily"), getTranslations("tasks"), getFormatter(), getToday(user.person.id, date), getCheckInState(user.person, now), loadMyWork(user.person.id, date), openFollowUps(user.person.id, tab)]);
  const counts = inboxCounts(mine, followUps.count);
  const day = view.day;
  const off = !!day?.dayOff;
  const plannedMinutes = view.planned.reduce((total, task) => total + (task.plannedMinutes ?? 0), 0);
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

  const planCard = (
    <Link href="/daily/plan" className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] border border-border bg-background p-4 hover:bg-canvas">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {view.plan?.submittedAt ? <Check aria-hidden className="size-3.5 text-success" strokeWidth={2.5} /> : null}
        {t("today.planShort")}
      </span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{view.plan?.submittedAt ? t("today.planSummary", { count: view.planned.length, planned: hoursOf(plannedMinutes), available: hoursOf(day?.minutes ?? 0) }) : day?.plan.required ? t("today.planBy", { time: day.rules.planCutoff }) : t("today.makePlan")}</span>
    </Link>
  );

  // The links name the day this page was rendered for: opened after midnight they still lead to it.
  const reportCard = reportDue ? (
    <Link href={reportLink(date)} className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] bg-primary p-4 text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_10%)]">
      <span className="text-xs text-primary-foreground/80">{t("today.reportShort")}</span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{t("today.writeReportBy", { time: day!.rules.reportDeadline })}</span>
    </Link>
  ) : (
    <Link href={reportSent ? `/daily/reports/${view.report!.id}` : reportLink(date)} className="press flex min-h-24 flex-col justify-between gap-2 rounded-[14px] border border-border bg-background p-4 hover:bg-canvas">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {reportSent ? <Check aria-hidden className={cn("size-3.5", view.report!.late ? "text-warning" : "text-success")} strokeWidth={2.5} /> : null}
        {t("today.reportShort")}
      </span>
      <span className="text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em]">{reportSent ? t("today.reportDone") : t("today.writeReport")}</span>
      {!reportSent ? <span className="text-xs text-muted-foreground">{t("today.reportOptional")}</span> : null}
    </Link>
  );

  return (
    <Page width="default">
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

      <nav className="tab-row" aria-label={tTasks("views.label")}>
        {TABS.map((key) => (
          <Link key={key} href={key === "today" ? "/today" : `/today?view=${key}`} aria-current={tab === key ? "page" : undefined}>
            {tTasks(`views.${key}`)}
            {key === "today" ? null : <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{counts[key as InboxView]}</span>}
          </Link>
        ))}
      </nav>

      {tab === "today" ? <DayLists user={user} date={date} view={view} /> : <Inbox view={tab} user={user} today={date} mine={mine} followUps={followUps.list} />}
    </Page>
  );
}
