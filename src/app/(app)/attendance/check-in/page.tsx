import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties } from "react";
import { cn } from "cn";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { addDays } from "@/lib/dates";
import { eachDate } from "@/modules/attendance/engine/calendar";
import { getCheckInState } from "@/modules/attendance/punches";
import { getTimesheetDayCells } from "@/modules/attendance/timesheets";
import { CheckInPanel, InstallHint } from "@/modules/attendance/ui/check-in";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";
import { answerGpsNoticeAction } from "@/modules/privacy/actions";
import { GPS_NOTICE_VERSION, gpsConsentOf, PUNCH_POSITION_RETENTION_DAYS } from "@/modules/privacy/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("checkIn");

/** The Monday of the week the date falls in. */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

// The one screen most people open every day, on a phone: the state of the day and one big key,
// today's punches, and the week's hours as a strip of bars.
export default async function CheckInPage() {
  const user = await requireUser();
  const [t, tAttendance, format] = await Promise.all([getTranslations("attendance.checkIn"), getTranslations("attendance"), getFormatter()]);
  const [state, gps] = await Promise.all([getCheckInState(user.person), gpsConsentOf(user.person.id)]);
  const { plan } = state;
  const employed = user.person.status === "active" && !!user.person.primaryEntityId;
  const monday = mondayOf(state.today);
  const weekDates = eachDate(monday, addDays(monday, 5));
  // The stored timesheet days of this week (Mon–Sat): one row per day the engine has computed.
  const weekRows = employed ? await getTimesheetDayCells([user.person.id], monday, addDays(monday, 5)) : [];
  const weekByDate = new Map(weekRows.map((row) => [row.date, row]));
  const scale = Math.max(480, ...weekRows.map((row) => row.workedMinutes + row.creditedMinutes));

  const lastIn = [...state.punches].reverse().find((punch) => punch.direction === "in") ?? null;
  const lastPunch = state.punches.at(-1) ?? null;
  const time = (value: Date) => format.dateTime(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Ho_Chi_Minh" });

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={format.dateTime(new Date(`${state.today}T00:00:00`), { weekday: "long", day: "numeric", month: "long" })}
        title={t("title")}
        description={
          plan ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={plan.kind === "working" ? "secondary" : "outline"}>{tAttendance(`dayKinds.${plan.kind}`)}</Badge>
              <span>{plan.kind === "working" ? `${planHours(plan)} · ${hoursText(plan.requiredMinutes)}` : (plan.name ?? "")}</span>
            </span>
          ) : null
        }
      />

      {state.leaveToday.length > 0 ? <Alert variant="warning">{t(state.leaveToday.some((day) => day.portion === "full") ? "onLeaveFull" : "onLeavePart")}</Alert> : null}
      {plan?.kind === "untracked" ? <Alert>{t("untracked")}</Alert> : null}

      {employed ? (
        <CheckInPanel
          nextDirection={state.nextDirection}
          punchExpected={plan?.kind === "working" || plan?.kind === "unscheduled" || !plan}
          sinceAt={state.nextDirection === "out" && lastIn ? lastIn.at.toISOString() : null}
          lastLocationName={lastPunch?.locationName ?? null}
          hasLocations={state.hasLocations}
          punchedToday={state.punches.length > 0}
          gps={{ state: gps.state, version: GPS_NOTICE_VERSION, days: PUNCH_POSITION_RETENTION_DAYS }}
          answerGps={answerGpsNoticeAction}
        />
      ) : (
        <Alert variant="destructive">{t("errors.punch_not_employed")}</Alert>
      )}

      <Section title={t("todaySection")} count={state.punches.length || null}>
        <List className="md:hidden">
          {state.punches.length === 0 ? <ListEmpty>{t("noPunches")}</ListEmpty> : null}
          {state.punches.map((punch, index) => (
            <ListItem key={punch.id} className="rise" style={{ "--i": index } as CSSProperties}>
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", punch.direction === "in" ? "bg-success" : "bg-faint")} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{t(punch.direction === "in" ? "in" : "out")}</span>
                {punch.locationName ? <span className="truncate text-xs text-muted-foreground">{punch.locationName}</span> : null}
              </span>
              {punch.reviewStatus !== "none" ? (
                <Badge dot variant={statusTone(punch.reviewStatus)}>
                  {t(`review.${punch.reviewStatus}`)}
                </Badge>
              ) : null}
              <span className="font-mono text-[0.9375rem] tabular-nums">{time(punch.at)}</span>
            </ListItem>
          ))}
        </List>
        <TableCard className="hidden md:flex">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="time">{t("columns.time")}</TableHead>
                <TableHead kind="select">{t("columns.direction")}</TableHead>
                <TableHead kind="place">{t("columns.location")}</TableHead>
                <TableHead kind="status">{t("columns.review")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.punches.length === 0 ? <TableEmpty>{t("noPunches")}</TableEmpty> : null}
              {state.punches.map((punch) => (
                <TableRow key={punch.id}>
                  <TableCell kind="time">{time(punch.at)}</TableCell>
                  <TableCell className="font-medium">{t(punch.direction === "in" ? "in" : "out")}</TableCell>
                  <TableCell className="text-muted-foreground">{punch.locationName ?? ""}</TableCell>
                  <TableCell>
                    {punch.reviewStatus !== "none" ? (
                      <Badge dot variant={statusTone(punch.reviewStatus)}>
                        {t(`review.${punch.reviewStatus}`)}
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      {employed ? (
        <Section title={t("week.title")} action={<Link href="/attendance">{tAttendance("timesheet.myMonth")}</Link>}>
          <Card>
            <CardContent>
              <ol className="grid grid-cols-6 gap-2">
                {weekDates.map((date) => {
                  const row = weekByDate.get(date);
                  const minutes = row ? row.workedMinutes + row.creditedMinutes : 0;
                  const isToday = date === state.today;
                  return (
                    <li key={date} className="flex flex-col items-center gap-1.5">
                      <div className="flex h-16 w-full items-end">
                        <span
                          aria-hidden
                          className={cn("w-full rounded-[4px] transition-[height] duration-300 ease-(--ease-settle)", minutes > 0 ? (isToday ? "bg-primary" : "bg-primary/70") : "bg-muted")}
                          style={{ height: minutes > 0 ? `${Math.max(8, Math.round((minutes / scale) * 100))}%` : "4px" }}
                        />
                      </div>
                      <span className={cn("text-[0.6875rem] font-medium uppercase", isToday ? "text-foreground" : "text-faint")}>{format.dateTime(new Date(`${date}T00:00:00`), { weekday: "short" })}</span>
                      <span className={cn("font-mono text-xs tabular-nums", minutes > 0 ? "text-foreground" : "text-faint")}>{minutes > 0 ? hoursText(minutes) : "–"}</span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <InstallHint />
      <nav className="flex justify-center gap-5 text-[0.8125rem] font-medium [&_a]:text-link">
        <Link href="/attendance/today">{tAttendance("today.title")}</Link>
        <Link href="/attendance">{tAttendance("title")}</Link>
      </nav>
    </Page>
  );
}
