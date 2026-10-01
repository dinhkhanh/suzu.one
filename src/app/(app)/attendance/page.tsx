import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { ownAnomaliesIn } from "@/modules/attendance/anomalies";
import { getMonthRow } from "@/modules/attendance/months";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { listAttendanceRequestsOf } from "@/modules/attendance/requests";
import { countPunchesToReview } from "@/modules/attendance/punches";
import { getDayPlans } from "@/modules/attendance/schedules";
import { getPersonMonth, monthEnd, monthStart, timesheetTargetFor } from "@/modules/attendance/timesheets";
import { ConfirmMonthButton } from "@/modules/attendance/ui/request-forms";
import { MonthDays, MonthNav, SummaryTiles } from "@/modules/attendance/ui/timesheet-views";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("attendance");

// The signed-in person's working days for the next two weeks, as their schedule, the roster and
// the calendar see them. Check-in and the timesheet join this page in the following slices.
export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance");
  const format = await getFormatter();
  const today = todayInVietnam();
  // The month on screen: mine, or — for a manager, department head or HR — someone else's.
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= today.slice(0, 7) ? query.month : today.slice(0, 7);
  const personId = typeof query.person === "string" && /^[0-9a-f-]{36}$/.test(query.person) ? query.person : user.person.id;
  const own = personId === user.person.id;
  const [allPlans, toReview, subject] = await Promise.all([getDayPlans([user.person.id], today, addDays(today, 13)), countPunchesToReview({ personId: user.person.id, principal: user.principal }), own ? null : timesheetTargetFor(user.principal, personId)]);
  const plans = allPlans.get(user.person.id);
  if (!own && !subject) notFound();
  const [personMonth, monthRow, requests] = await Promise.all([getPersonMonth(personId, month), getMonthRow(personId, month), own ? listAttendanceRequestsOf(personId, { from: monthStart(month), to: monthEnd(month) }) : []]);
  const anomalies = own ? ownAnomaliesIn(personMonth.days) : [];
  const monthStatus = monthRow?.status ?? "open";
  const monthOver = monthEnd(month) < today;
  const fixHref = (fix: string, date: string) => (fix === "correction" || fix === "overtime" || fix === "holiday_work" ? `/attendance/requests/new?type=${fix === "correction" ? "attendance_correction" : fix}&date=${date}` : null);
  const monthHref = (value: string) => `/attendance?${personId === user.person.id ? "" : `person=${personId}&`}month=${value}`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
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
        <Link href="/attendance/requests/new" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("requests.newTitle")}
        </Link>
        <Link href="/attendance/team" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("timesheet.team.title")}
        </Link>
        <Link href="/attendance/timesheets" className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("months.title")}
        </Link>
        {canOpenAttendanceSettings(user.principal) ? (
          <Link href="/attendance/anomalies" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {t("console.title")}
          </Link>
        ) : null}
        {toReview > 0 ? (
          <Link href="/attendance/review" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {t("review.title")} <Badge className="text-[10px]">{toReview}</Badge>
          </Link>
        ) : (
          <Link href="/attendance/review" className="text-sm text-link underline-offset-4 hover:underline">
            {t("review.title")}
          </Link>
        )}
      </nav>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{subject ? t("timesheet.monthOf", { name: subject.fullName }) : t("timesheet.myMonth")}</h2>
          <MonthNav month={month} hrefFor={monthHref} thisMonth={today.slice(0, 7)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          <Badge dot variant={statusTone(monthStatus)}>{t(`months.status.${monthStatus}`)}</Badge>
          <span className="text-muted-foreground">{t(`months.statusHint.${monthStatus}`)}</span>
          {own && monthStatus === "open" && monthOver && personMonth.days.length > 0 ? <ConfirmMonthButton month={month} label={t("months.confirm")} confirm={t("months.confirmAsk")} /> : null}
          {monthStatus === "open" && monthRow?.reopenedComment ? <p className="w-full text-xs text-destructive">{t("months.reopened", { comment: monthRow.reopenedComment })}</p> : null}
        </div>
        <SummaryTiles summary={personMonth.summary} />
        {anomalies.length > 0 ? (
          <TableCard>
            <TableCardHeader title={t("months.toFix", { count: anomalies.length })} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="date">{t("requests.fields.date")}</TableHead>
                  <TableHead kind="select">{t("console.columns.kind")}</TableHead>
                  <TableHead kind="actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalies.map((item) => {
                  const href = fixHref(item.fix, item.date);
                  return (
                    <TableRow key={`${item.date}:${item.code}`}>
                      <TableCell className="text-muted-foreground">{item.date.slice(5).split("-").reverse().join("/")}</TableCell>
                      <TableCell>{t(`timesheet.anomalies.${item.code}`)}</TableCell>
                      <TableCell kind="actions">
                        {href ? (
                          <Link href={href} className="underline underline-offset-4">
                            {t(`console.fix.${item.fix}`)}
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
        {requests.length > 0 ? (
          <TableCard>
            <TableCardHeader title={t("requests.mine")} count={requests.length} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="date">{t("requests.fields.date")}</TableHead>
                  <TableHead kind="select">{t("requests.fields.type")}</TableHead>
                  <TableHead kind="status">{t("requests.fields.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">{row.startDate.slice(5).split("-").reverse().join("/")}</TableCell>
                    <TableCell>
                      <Link href={row.approvalRequestId ? `/approvals/attendance/${row.approvalRequestId}` : "/approvals"} className="font-medium underline-offset-4 hover:underline">
                        {t(`requests.types.${row.type}`)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`requests.status.${row.status === "pending" && row.approvalStatus === "returned" ? "returned" : row.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("timesheet.tapHint")}</p>
        <MonthDays days={[...personMonth.days].reverse()} />
      </section>
      <section className={subject ? "hidden" : "flex flex-col gap-3"}>
        <h2 className="text-sm font-medium text-muted-foreground">{t("mySchedule")}</h2>
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("requests.fields.date")}</TableHead>
              <TableHead kind="select">{t("requests.fields.kind")}</TableHead>
              <TableHead kind="time" className="text-left">{t("requests.fields.window")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(plans?.days ?? []).map((plan) => (
              <TableRow key={plan.date}>
                <TableCell className="font-medium">{format.dateTime(new Date(`${plan.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</TableCell>
                <TableCell>
                  <Badge variant={plan.kind === "working" || plan.kind === "untracked" ? "secondary" : "outline"}>{t(`dayKinds.${plan.kind}`)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{plan.kind === "working" ? `${planHours(plan)} · ${hoursText(plan.requiredMinutes)}` : (plan.name ?? "")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
