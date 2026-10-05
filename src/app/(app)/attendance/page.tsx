import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "cn";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { addDays, todayInVietnam } from "@/lib/dates";
import { ownAnomaliesIn } from "@/modules/attendance/anomalies";
import { getMonthRow } from "@/modules/attendance/months";
import { canOpenAttendanceSettings, canOpenKioskPage } from "@/modules/attendance/policy";
import { listAttendanceRequestsOf } from "@/modules/attendance/requests";
import { countPunchesToReview } from "@/modules/attendance/punches";
import { getDayPlans } from "@/modules/attendance/schedules";
import { getPersonMonth, monthEnd, monthStart, timesheetTargetFor } from "@/modules/attendance/timesheets";
import { ConfirmMonthButton } from "@/modules/attendance/ui/request-forms";
import { MonthDays, MonthNav, SummaryTiles } from "@/modules/attendance/ui/timesheet-views";
import { hoursText, planHours } from "@/modules/attendance/ui/day-plan";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("attendance");

// The signed-in person's month as the timesheet sees it, the ways in (check-in, requests, the
// team's pages) and the next two weeks of their schedule.
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
  const outline = cn(buttonVariants({ variant: "outline", size: "sm" }));

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {canOpenAttendanceSettings(user.principal) ? (
              <Link href="/attendance/settings/calendar" className={cn(buttonVariants({ variant: "outline" }))}>
                {t("settings.title")}
              </Link>
            ) : null}
            <Link href="/attendance/check-in" className={cn(buttonVariants())}>
              {t("checkIn.title")}
            </Link>
          </>
        }
      />

      <nav className="toolbar">
        <Link href="/attendance/today" className={outline}>
          {t("today.title")}
        </Link>
        <Link href="/attendance/requests/new" className={outline}>
          {t("requests.newTitle")}
        </Link>
        <Link href="/attendance/team" className={outline}>
          {t("timesheet.team.title")}
        </Link>
        <Link href="/attendance/timesheets" className={outline}>
          {t("months.title")}
        </Link>
        {canOpenAttendanceSettings(user.principal) ? (
          <Link href="/attendance/anomalies" className={outline}>
            {t("console.title")}
          </Link>
        ) : null}
        {canOpenKioskPage(user.principal) ? (
          <Link href="/attendance/kiosk" className={outline}>
            {t("kiosk.title")}
          </Link>
        ) : null}
        <Link href="/attendance/review" className={outline}>
          {t("review.title")}
          {toReview > 0 ? <Badge variant="info">{toReview}</Badge> : null}
        </Link>
      </nav>

      <Section title={subject ? t.rich("timesheet.monthOf", { name: subject.fullName, person: (chunks) => <RecordLink kind="person" id={personId}>{chunks}</RecordLink> }) : t("timesheet.myMonth")} action={<MonthNav month={month} hrefFor={monthHref} thisMonth={today.slice(0, 7)} />}>
        <Alert icon={null}>
          <Badge dot variant={statusTone(monthStatus)}>
            {t(`months.status.${monthStatus}`)}
          </Badge>
          <span className="text-muted-foreground">{t(`months.statusHint.${monthStatus}`)}</span>
          {own && monthStatus === "open" && monthOver && personMonth.days.length > 0 ? <ConfirmMonthButton month={month} label={t("months.confirm")} confirm={t("months.confirmAsk")} /> : null}
          {monthStatus === "open" && monthRow?.reopenedComment ? <p className="w-full text-xs text-destructive">{t("months.reopened", { comment: monthRow.reopenedComment })}</p> : null}
        </Alert>
        <SummaryTiles summary={personMonth.summary} />
      </Section>

      {anomalies.length > 0 ? (
        <Section title={t("months.toFix", { count: anomalies.length })}>
          <TableCard>
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
                          <Link href={href} className="text-link underline underline-offset-4">
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
        </Section>
      ) : null}

      {requests.length > 0 ? (
        <Section title={t("requests.mine")} count={requests.length}>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="date">{t("requests.fields.date")}</TableHead>
                  <TableHead kind="select">{t("requests.fields.type")}</TableHead>
                  <TableHead kind="status">{t("requests.fields.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((row) => {
                  const status = row.status === "pending" && row.approvalStatus === "returned" ? "returned" : row.status;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">{row.startDate.slice(5).split("-").reverse().join("/")}</TableCell>
                      <TableCell>
                        <Link href={row.approvalRequestId ? `/approvals/attendance/${row.approvalRequestId}` : "/approvals"} className="font-medium hover:underline">
                          {t(`requests.types.${row.type}`)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge dot variant={statusTone(status)}>
                          {t(`requests.status.${status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      <Section>
        <p className="px-0.5 text-xs text-muted-foreground">{t("timesheet.tapHint")}</p>
        <MonthDays days={[...personMonth.days].reverse()} />
      </Section>

      {subject ? null : (
        <Section title={t("mySchedule")}>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{t("requests.fields.date")}</TableHead>
                <TableHead kind="select">{t("requests.fields.kind")}</TableHead>
                <TableHead kind="time" className="text-left">
                  {t("requests.fields.window")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(plans?.days ?? []).map((plan) => (
                <TableRow key={plan.date}>
                  <TableCell className="font-medium">{format.dateTime(new Date(`${plan.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</TableCell>
                  <TableCell>
                    <Badge variant={plan.kind === "working" || plan.kind === "untracked" ? "secondary" : "outline"}>{t(`dayKinds.${plan.kind}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-left font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{plan.kind === "working" ? `${planHours(plan)} · ${hoursText(plan.requiredMinutes)}` : (plan.name ?? "")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </Page>
  );
}
