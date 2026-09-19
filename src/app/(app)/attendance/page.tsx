import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { countPunchesToReview } from "@/modules/attendance/punches";
import { getDayPlans } from "@/modules/attendance/schedules";
import { getPersonMonth, timesheetTargetFor } from "@/modules/attendance/timesheets";
import { MonthDays, MonthNav, SummaryTiles } from "@/modules/attendance/ui/timesheet-views";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Attendance" };

// The signed-in person's working days for the next two weeks, as their schedule, the roster and
// the calendar see them. Check-in and the timesheet join this page in the following slices.
export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [allPlans, toReview] = await Promise.all([getDayPlans([user.person.id], today, addDays(today, 13)), countPunchesToReview({ personId: user.person.id, principal: user.principal })]);
  const plans = allPlans.get(user.person.id);
  // The month on screen: mine, or — for a manager, department head or HR — someone else's.
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= today.slice(0, 7) ? query.month : today.slice(0, 7);
  const personId = typeof query.person === "string" && /^[0-9a-f-]{36}$/.test(query.person) ? query.person : user.person.id;
  const subject = personId === user.person.id ? null : await timesheetTargetFor(user.principal, personId);
  if (personId !== user.person.id && !subject) notFound();
  const personMonth = await getPersonMonth(personId, month);
  const monthHref = (value: string) => `/attendance?${personId === user.person.id ? "" : `person=${personId}&`}month=${value}`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canOpenAttendanceSettings(user.principal) ? (
          <Link href="/attendance/settings/calendar" className="text-sm underline-offset-4 hover:underline">
            {t("settings.title")}
          </Link>
        ) : null}
      </header>
      <nav className="flex flex-wrap items-center gap-3">
        <Link href="/attendance/check-in" className={buttonVariants({ size: "lg" })}>
          {t("checkIn.title")}
        </Link>
        <Link href="/attendance/today" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("today.title")}
        </Link>
        <Link href="/attendance/team" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("timesheet.team.title")}
        </Link>
        {toReview > 0 ? (
          <Link href="/attendance/review" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {t("review.title")} <Badge className="text-[10px]">{toReview}</Badge>
          </Link>
        ) : (
          <Link href="/attendance/review" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t("review.title")}
          </Link>
        )}
      </nav>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{subject ? t("timesheet.monthOf", { name: subject.fullName }) : t("timesheet.myMonth")}</h2>
          <MonthNav month={month} hrefFor={monthHref} thisMonth={today.slice(0, 7)} />
        </div>
        <SummaryTiles summary={personMonth.summary} />
        <p className="text-xs text-muted-foreground">{t("timesheet.tapHint")}</p>
        <MonthDays days={[...personMonth.days].reverse()} />
      </section>
      <section className={subject ? "hidden" : "flex flex-col gap-3"}>
        <h2 className="text-sm font-medium text-muted-foreground">{t("mySchedule")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {(plans?.days ?? []).map((plan) => (
            <li key={plan.date} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className="w-40 font-medium">{format.dateTime(new Date(`${plan.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</span>
              <Badge variant={plan.kind === "working" || plan.kind === "untracked" ? "secondary" : "outline"}>{t(`dayKinds.${plan.kind}`)}</Badge>
              <span className="text-muted-foreground">{plan.kind === "working" ? `${planHours(plan)} · ${hoursText(plan.requiredMinutes)}` : (plan.name ?? "")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
