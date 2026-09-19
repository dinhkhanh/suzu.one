import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { countPunchesToReview } from "@/modules/attendance/punches";
import { getDayPlans } from "@/modules/attendance/schedules";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Attendance" };

// The signed-in person's working days for the next two weeks, as their schedule, the roster and
// the calendar see them. Check-in and the timesheet join this page in the following slices.
export default async function AttendancePage() {
  const user = await requireUser();
  const t = await getTranslations("attendance");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [allPlans, toReview] = await Promise.all([getDayPlans([user.person.id], today, addDays(today, 13)), countPunchesToReview({ personId: user.person.id, principal: user.principal })]);
  const plans = allPlans.get(user.person.id);

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
