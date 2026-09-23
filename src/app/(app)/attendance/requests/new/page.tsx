import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { getAttendancePolicy } from "@/modules/attendance/attendance-policies";
import { canFileAttendanceRequestFor } from "@/modules/attendance/policy";
import { ATTENDANCE_REQUEST_TYPES, type AttendanceRequestType, correctionsUsed, getAttendanceRequestView, overtimeWarningsFor } from "@/modules/attendance/requests";
import { AttendanceRequestForm, type RequestDefaults } from "@/modules/attendance/ui/request-forms";
import { getPersonTarget } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("attendanceRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Files one of the four attendance requests — for oneself, or (HR) for someone in scope:
// `?type=&date=&person=`. `?resubmit=<approval request>` reopens a returned request with its values.
export default async function NewAttendanceRequestPage({ searchParams }: PageProps<"/attendance/requests/new">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance.requests");
  const viewer = { personId: user.person.id, principal: user.principal };

  const resubmitId = typeof query.resubmit === "string" && UUID.test(query.resubmit) ? query.resubmit : null;
  const returned = resubmitId ? await getAttendanceRequestView(viewer, resubmitId) : null;
  if (resubmitId && (!returned || !returned.isRequester || returned.request.status !== "returned")) notFound();

  const type: AttendanceRequestType = returned?.attendanceRequest.type ?? (ATTENDANCE_REQUEST_TYPES.find((value) => value === query.type) ?? "attendance_correction");
  const personId = returned?.attendanceRequest.personId ?? (typeof query.person === "string" && UUID.test(query.person) ? query.person : user.person.id);
  const target = await getPersonTarget(personId);
  if (!target || !canFileAttendanceRequestFor(user.principal, target)) notFound();
  const onBehalf = personId !== user.person.id;
  const date = typeof query.date === "string" && DATE.test(query.date) ? query.date : todayInVietnam();
  const row = returned?.attendanceRequest;
  // What the person should know before asking: corrections left this month, overtime already on the books.
  const isCorrection = type === "attendance_correction" && !!target.entityId;
  const [[subject], policy, correctionsSoFar, warnings] = await Promise.all([
    onBehalf ? db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1) : [],
    isCorrection ? getAttendancePolicy(target.entityId!, date) : null,
    isCorrection ? correctionsUsed(db(), personId, date.slice(0, 7), row?.id ?? null) : null,
    type === "overtime" || type === "holiday_work" ? overtimeWarningsFor(personId, date, 0, row?.id ?? null) : [],
  ]);
  const used = policy?.monthlyCorrectionCap ? correctionsSoFar : null;

  const details = row?.details;
  const defaults: RequestDefaults = row && details
    ? {
        startDate: row.startDate,
        endDate: row.endDate,
        reason: row.reason ?? "",
        compensation: row.compensation ?? undefined,
        ...(details.type === "attendance_correction" ? { cause: details.cause, inTime: details.inTime ?? undefined, outTime: details.outTime ?? undefined, outNextDay: details.outNextDay } : {}),
        ...(details.type === "remote_work" ? { kind: details.kind, portion: details.portion, locationName: details.locationName ?? undefined, latitude: details.latitude?.toString(), longitude: details.longitude?.toString(), radiusM: details.radiusM?.toString() } : {}),
        ...(details.type === "overtime" || details.type === "holiday_work" ? { from: details.from ?? undefined, to: details.to ?? undefined } : {}),
      }
    : { startDate: date };

  const href = (value: string) => `/attendance/requests/new?type=${value}&date=${date}${onBehalf ? `&person=${personId}` : ""}`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1>{returned ? t("resubmitTitle") : t("newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{onBehalf && subject ? t("onBehalf", { name: subject.fullName }) : t("newDescription")}</p>
      </header>
      {returned ? null : (
        <nav className="tab-row">
          {ATTENDANCE_REQUEST_TYPES.map((value) => (
            <Link key={value} href={href(value)} className={value === type ? "rounded-md bg-primary px-3 py-1.5 text-primary-foreground" : "rounded-md border px-3 py-1.5 hover:bg-muted"}>
              {t(`types.${value}`)}
            </Link>
          ))}
        </nav>
      )}
      <p className="text-sm text-muted-foreground">{t(`typeHints.${type}`)}</p>
      {policy?.monthlyCorrectionCap && used !== null ? <p className="rounded-lg bg-muted p-2 text-sm">{t("capStatus", { used, cap: policy.monthlyCorrectionCap })}</p> : null}
      {warnings.map((warning) => (
        <p key={warning.code} className="rounded-lg bg-muted p-2 text-sm">
          {t(`warnings.${warning.code}`, { total: Math.round(warning.totalMinutes / 6) / 10, limit: warning.limitMinutes / 60 })}
        </p>
      ))}
      <AttendanceRequestForm key={type} type={type} personId={onBehalf ? personId : null} defaults={defaults} resubmit={resubmitId} />
    </div>
  );
}
