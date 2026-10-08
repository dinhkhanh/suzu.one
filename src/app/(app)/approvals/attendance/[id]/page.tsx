import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { canConfirmHoursOf, canManageAttendanceOf } from "@/modules/attendance/policy";
import { decideAttendanceRequestAction } from "@/modules/attendance/request-actions";
import { getAttendanceRequestView } from "@/modules/attendance/requests";
import { getTimesheetDays } from "@/modules/attendance/timesheets";
import { CancelRequestButton, ConfirmHoursForm, EvidenceButton } from "@/modules/attendance/ui/request-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, PropertySheet, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("attendanceRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One page for the four attendance request types: correction, remote work, overtime, holiday work.
export default async function AttendanceRequestPage(props: PageProps<"/approvals/attendance/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getAttendanceRequestView({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tRequests, format] = await Promise.all([getTranslations("attendance.requests"), getTranslations("requests"), getFormatter()]);
  const { request, attendanceRequest: row } = view;
  const { details } = row;
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" });
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const isHr = !!view.subject && canManageAttendanceOf(user.principal, view.subject);
  const mine = row.personId === user.person.id || row.filedByPersonId === user.person.id;
  const started = row.startDate <= todayInVietnam();
  const canCancel = row.status === "pending" ? mine || isHr : row.status === "approved" && (isHr || (mine && !started));
  const status = row.status === "cancelled" || row.status === "withdrawn" ? row.status : request.status;
  const isOvertime = row.type === "overtime" || row.type === "holiday_work";
  const canConfirm = isOvertime && row.status === "approved" && started && !!view.subject && canConfirmHoursOf(user.principal, view.subject);
  // What the day looks like now — the approver sees the punches' verdict next to the request.
  const [day] = row.startDate === row.endDate ? await getTimesheetDays([row.personId], row.startDate, row.startDate) : [];
  const clock = (value: Date | null) => (value ? format.dateTime(value, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "—");

  const facts: { label: string; value: string; long?: boolean }[] = [{ label: t("fields.dates"), value: row.startDate === row.endDate ? date(row.startDate) : `${date(row.startDate)} – ${date(row.endDate)}` }];
  if (details.type === "attendance_correction") {
    facts.push(
      { label: t("fields.cause"), value: t(`causes.${details.cause}`) },
      { label: t("fields.inTime"), value: details.inTime ?? "—" },
      { label: t("fields.outTime"), value: details.outTime ? `${details.outTime}${details.outNextDay ? ` (${t("fields.nextDay")})` : ""}` : "—" },
    );
    if (view.correctionCap) facts.push({ label: t("fields.capUsed"), value: t("capStatus", { used: view.correctionsUsed ?? 0, cap: view.correctionCap }) });
  } else if (details.type === "remote_work") {
    facts.push({ label: t("fields.kind"), value: t(`kinds.${details.kind}`) }, { label: t("fields.portion"), value: t(`portions.${details.portion}`) });
    if (details.locationName) facts.push({ label: t("fields.locationName"), value: details.locationName });
    if (details.latitude !== null && details.longitude !== null) facts.push({ label: t("fields.position"), value: `${details.latitude}, ${details.longitude} · ${details.radiusM ?? 300} m` });
  } else {
    facts.push({ label: t("fields.window"), value: details.from && details.to ? `${details.from} – ${details.to}` : "—" }, { label: t("fields.compensation"), value: t(`compensation.${row.compensation ?? "pay"}`) });
    if (row.confirmedMinutes !== null) facts.push({ label: t("confirmHours.confirmed"), value: t("hoursCount", { hours: hours(row.confirmedMinutes) }) });
  }
  facts.push({ label: t("fields.reason"), value: row.reason ?? "—", long: true });

  return (
    <Page width="narrow">
      <RequestHeader
        title={t(`types.${row.type}`)}
        status={status}
        requestId={request.id}
        who={
          <>
            <RecordLink kind="person" id={request.subjectPersonId}>
              {view.subjectName}
            </RecordLink>
            {view.requesterName !== view.subjectName ? (
              <>
                {" · "}
                {t.rich("filedBy", {
                  name: view.requesterName,
                  person: (chunks) => (
                    <RecordLink kind="person" id={request.requesterPersonId}>
                      {chunks}
                    </RecordLink>
                  ),
                })}
              </>
            ) : null}
          </>
        }
        actions={
          view.isRequester && request.status === "returned" && row.status === "pending" ? (
            <Link href={`/attendance/requests/new?resubmit=${request.id}`} className={buttonVariants()}>
              {t("fixAndResubmit")}
            </Link>
          ) : canCancel ? (
            <CancelRequestButton attendanceRequestId={row.id} label={row.status === "pending" ? t("withdraw") : t("cancel")} confirm={t("cancelConfirm")} />
          ) : undefined
        }
      />

      <Section title={tRequests("view.details")}>
        <PropertySheet rows={[...facts, ...(row.evidenceFileId ? [{ label: t("fields.evidence"), value: <EvidenceButton requestId={request.id} label={t("openEvidence")} /> }] : [])]} />
      </Section>

      {day ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("dayNow")}</CardTitle>
            <CardDescription>
              {t("dayNowLine", {
                first: clock(day.firstIn),
                last: clock(day.lastOut),
                worked: hours(day.workedMinutes),
                overtime: hours(day.otWeekdayMinutes + day.otWeekdayNightMinutes + day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes),
                unapproved: hours(day.otUnapprovedMinutes),
              })}
            </CardDescription>
          </CardHeader>
          {day.lockedAt ? <CardContent className="text-xs text-faint">{t("dayLocked")}</CardContent> : null}
        </Card>
      ) : null}

      {view.warnings.map((warning) => (
        <Alert key={warning.code} variant="warning">
          {t(`warnings.${warning.code}`, { total: Math.round(warning.totalMinutes / 6) / 10, limit: warning.limitMinutes / 60 })}
        </Alert>
      ))}

      <ApprovalChain view={view} />
      {view.canDecide && row.status === "pending" ? <DecisionForm requestId={request.id} action={decideAttendanceRequestAction} /> : null}
      {canConfirm ? <ConfirmHoursForm attendanceRequestId={row.id} defaultMinutes={row.confirmedMinutes} /> : null}
      {view.isRequester && request.status === "returned" && row.status === "pending" && canCancel ? (
        <div>
          <CancelRequestButton attendanceRequestId={row.id} label={t("withdraw")} confirm={t("cancelConfirm")} />
        </div>
      ) : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
