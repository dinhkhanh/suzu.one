import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { canConfirmHoursOf, canManageAttendanceOf } from "@/modules/attendance/policy";
import { decideAttendanceRequestAction } from "@/modules/attendance/request-actions";
import { getAttendanceRequestView } from "@/modules/attendance/requests";
import { getTimesheetDays } from "@/modules/attendance/timesheets";
import { CancelRequestButton, ConfirmHoursForm, EvidenceButton } from "@/modules/attendance/ui/request-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
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

  const t = await getTranslations("attendance.requests");
  const format = await getFormatter();
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

  const facts: [string, string][] = [[t("fields.dates"), row.startDate === row.endDate ? date(row.startDate) : `${date(row.startDate)} – ${date(row.endDate)}`]];
  if (details.type === "attendance_correction") {
    facts.push([t("fields.cause"), t(`causes.${details.cause}`)], [t("fields.inTime"), details.inTime ?? "—"], [t("fields.outTime"), details.outTime ? `${details.outTime}${details.outNextDay ? ` (${t("fields.nextDay")})` : ""}` : "—"]);
    if (view.correctionCap) facts.push([t("fields.capUsed"), t("capStatus", { used: view.correctionsUsed ?? 0, cap: view.correctionCap })]);
  } else if (details.type === "remote_work") {
    facts.push([t("fields.kind"), t(`kinds.${details.kind}`)], [t("fields.portion"), t(`portions.${details.portion}`)]);
    if (details.locationName) facts.push([t("fields.locationName"), details.locationName]);
    if (details.latitude !== null && details.longitude !== null) facts.push([t("fields.position"), `${details.latitude}, ${details.longitude} · ${details.radiusM ?? 300} m`]);
  } else {
    facts.push([t("fields.window"), details.from && details.to ? `${details.from} – ${details.to}` : "—"], [t("fields.compensation"), t(`compensation.${row.compensation ?? "pay"}`)]);
    if (row.confirmedMinutes !== null) facts.push([t("confirmHours.confirmed"), t("hoursCount", { hours: hours(row.confirmedMinutes) })]);
  }
  facts.push([t("fields.reason"), row.reason ?? "—"]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{t(`types.${row.type}`)}</h1>
          <RequestStatusBadge status={status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.subjectName}
          {view.requesterName !== view.subjectName ? ` · ${t("filedBy", { name: view.requesterName })}` : ""}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
        {row.evidenceFileId ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.evidence")}</dt>
            <dd>
              <EvidenceButton requestId={request.id} label={t("openEvidence")} />
            </dd>
          </div>
        ) : null}
      </dl>

      {day ? (
        <section className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <h2 className="font-medium">{t("dayNow")}</h2>
          <p className="text-muted-foreground">
            {t("dayNowLine", { first: clock(day.firstIn), last: clock(day.lastOut), worked: hours(day.workedMinutes), overtime: hours(day.otWeekdayMinutes + day.otWeekdayNightMinutes + day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes), unapproved: hours(day.otUnapprovedMinutes) })}
          </p>
          {day.lockedAt ? <p className="text-xs text-muted-foreground">{t("dayLocked")}</p> : null}
        </section>
      ) : null}

      {view.warnings.map((warning) => (
        <p key={warning.code} className="rounded-lg bg-muted p-2 text-sm">
          {t(`warnings.${warning.code}`, { total: Math.round(warning.totalMinutes / 6) / 10, limit: warning.limitMinutes / 60 })}
        </p>
      ))}

      {view.canDecide && row.status === "pending" ? <DecisionForm requestId={request.id} action={decideAttendanceRequestAction} /> : null}
      {canConfirm ? <ConfirmHoursForm attendanceRequestId={row.id} defaultMinutes={row.confirmedMinutes} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {view.isRequester && request.status === "returned" && row.status === "pending" ? (
          <Link href={`/attendance/requests/new?resubmit=${request.id}`} className={buttonVariants({ size: "sm" })}>
            {t("fixAndResubmit")}
          </Link>
        ) : null}
        {canCancel ? <CancelRequestButton attendanceRequestId={row.id} label={row.status === "pending" ? t("withdraw") : t("cancel")} confirm={t("cancelConfirm")} /> : null}
      </div>
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestHistory view={view} />
    </div>
  );
}
