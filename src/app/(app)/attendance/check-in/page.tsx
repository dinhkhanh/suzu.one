import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getCheckInState } from "@/modules/attendance/punches";
import { CheckInPanel, InstallHint } from "@/modules/attendance/ui/check-in";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Check in" };

// The one screen most people open every day, on a phone: today's plan, one big button, today's punches.
export default async function CheckInPage() {
  const user = await requireUser();
  const [t, tAttendance, format] = await Promise.all([getTranslations("attendance.checkIn"), getTranslations("attendance"), getFormatter()]);
  const state = await getCheckInState(user.person);
  const { plan } = state;
  const employed = user.person.status === "active" && !!user.person.primaryEntityId;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${state.today}T00:00:00`), { weekday: "long", day: "numeric", month: "long" })}</p>
        {plan ? (
          <p className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <Badge variant={plan.kind === "working" ? "secondary" : "outline"}>{tAttendance(`dayKinds.${plan.kind}`)}</Badge>
            <span className="text-muted-foreground">{plan.kind === "working" ? `${planHours(plan)} · ${hoursText(plan.requiredMinutes)}` : (plan.name ?? "")}</span>
          </p>
        ) : null}
      </header>

      {state.leaveToday.length > 0 ? <p className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-center text-sm">{t(state.leaveToday.some((day) => day.portion === "full") ? "onLeaveFull" : "onLeavePart")}</p> : null}
      {plan?.kind === "untracked" ? <p className="rounded-xl border p-3 text-center text-sm text-muted-foreground">{t("untracked")}</p> : null}

      {employed ? <CheckInPanel nextDirection={state.nextDirection} punchExpected={plan?.kind === "working" || plan?.kind === "unscheduled" || !plan} /> : <p className="text-center text-sm text-muted-foreground">{t("errors.punch_not_employed")}</p>}
      {employed && !state.hasLocations ? <p className="text-center text-xs text-muted-foreground">{t("noLocations")}</p> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("today")}</h2>
        {state.punches.length === 0 ? <p className="text-sm text-muted-foreground">{t("noPunches")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {state.punches.map((punch) => (
            <li key={punch.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className="font-mono">{format.dateTime(punch.at, { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="font-medium">{t(punch.direction === "in" ? "in" : "out")}</span>
              {punch.locationName ? <span className="text-muted-foreground">{punch.locationName}</span> : null}
              {punch.reviewStatus !== "none" ? <Badge variant={punch.reviewStatus === "rejected" ? "destructive" : "outline"}>{t(`review.${punch.reviewStatus}`)}</Badge> : null}
            </li>
          ))}
        </ul>
      </section>

      <InstallHint />
      <nav className="flex justify-center gap-4 text-sm">
        <Link href="/attendance/today" className="underline-offset-4 hover:underline">
          {tAttendance("today.title")}
        </Link>
        <Link href="/attendance" className="underline-offset-4 hover:underline">
          {tAttendance("title")}
        </Link>
      </nav>
    </div>
  );
}
