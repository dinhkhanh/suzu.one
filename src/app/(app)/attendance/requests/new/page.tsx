import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { getAttendancePolicy } from "@/modules/attendance/attendance-policies";
import { canFileAttendanceRequestFor } from "@/modules/attendance/policy";
import { ATTENDANCE_REQUEST_TYPES, type AttendanceRequestType, correctionsUsed, getAttendanceRequestView, overtimeWarningsFor } from "@/modules/attendance/requests";
import { AttendanceRequestForm, type RequestDefaults } from "@/modules/attendance/ui/request-forms";
import { getPersonTarget } from "@/modules/core-hr/service";
import { proposalDraft } from "@/modules/ai/service";
import { requireUser } from "@/modules/platform/auth/session";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("attendanceRequest");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Files one of the four attendance requests — for oneself, or (HR) for someone in scope:
// `?type=&date=&person=`. `?resubmit=<approval request>` reopens a returned request with its values;
// `?proposal=<id>` starts from the assistant's proposal of the asker's own.
export default async function NewAttendanceRequestPage({ searchParams }: PageProps<"/attendance/requests/new">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance.requests");
  const viewer = { personId: user.person.id, principal: user.principal };

  const resubmitId = typeof query.resubmit === "string" && UUID.test(query.resubmit) ? query.resubmit : null;
  const returned = resubmitId ? await getAttendanceRequestView(viewer, resubmitId) : null;
  if (resubmitId && (!returned || !returned.isRequester || returned.request.status !== "returned")) notFound();

  const type: AttendanceRequestType = returned?.attendanceRequest.type ?? ATTENDANCE_REQUEST_TYPES.find((value) => value === query.type) ?? "attendance_correction";
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

  const proposalId = !returned && !onBehalf && typeof query.proposal === "string" ? query.proposal : null;
  const proposed = proposalId ? await proposalDraft(user.person.id, proposalId, ["attendance.request.submit"]) : null;
  const details = row?.details;
  const defaults: RequestDefaults =
    row && details
      ? {
          startDate: row.startDate,
          endDate: row.endDate,
          reason: row.reason ?? "",
          compensation: row.compensation ?? undefined,
          ...(details.type === "attendance_correction" ? { cause: details.cause, inTime: details.inTime ?? undefined, outTime: details.outTime ?? undefined, outNextDay: details.outNextDay } : {}),
          ...(details.type === "remote_work"
            ? { kind: details.kind, portion: details.portion, locationName: details.locationName ?? undefined, latitude: details.latitude?.toString(), longitude: details.longitude?.toString(), radiusM: details.radiusM?.toString() }
            : {}),
          ...(details.type === "overtime" || details.type === "holiday_work" ? { from: details.from ?? undefined, to: details.to ?? undefined } : {}),
        }
      : proposed && proposed.type === type
        ? proposedDefaults(proposed, date)
        : { startDate: date };

  const href = (value: string) => `/attendance/requests/new?type=${value}&date=${date}${onBehalf ? `&person=${personId}` : ""}`;

  return (
    <Page width="narrow">
      <PageHeader
        title={returned ? t("resubmitTitle") : t("newTitle")}
        description={
          onBehalf && subject
            ? t.rich("onBehalf", {
                name: subject.fullName,
                person: (chunks) => (
                  <RecordLink kind="person" id={personId}>
                    {chunks}
                  </RecordLink>
                ),
              })
            : t("newDescription")
        }
      />
      {returned ? null : (
        <nav className="tab-row">
          {ATTENDANCE_REQUEST_TYPES.map((value) => (
            <Link key={value} href={href(value)} aria-current={value === type ? "page" : undefined}>
              {t(`types.${value}`)}
            </Link>
          ))}
        </nav>
      )}
      <p className="text-sm text-muted-foreground">{t(`typeHints.${type}`)}</p>
      {policy?.monthlyCorrectionCap && used !== null ? <Alert>{t("capStatus", { used, cap: policy.monthlyCorrectionCap })}</Alert> : null}
      {warnings.map((warning) => (
        <Alert key={warning.code} variant="warning">
          {t(`warnings.${warning.code}`, { total: Math.round(warning.totalMinutes / 6) / 10, limit: warning.limitMinutes / 60 })}
        </Alert>
      ))}
      <AttendanceRequestForm key={type} type={type} personId={onBehalf ? personId : null} defaults={defaults} resubmit={resubmitId} />
    </Page>
  );
}

/** The form's values from a proposal's stored input: the strings it holds, the day from the address. */
function proposedDefaults(input: Record<string, unknown>, date: string): RequestDefaults {
  const keys = ["endDate", "reason", "cause", "inTime", "outTime", "kind", "portion", "locationName", "from", "to", "compensation"] as const;
  const defaults: RequestDefaults = { startDate: date };
  for (const key of keys) if (typeof input[key] === "string" && input[key]) defaults[key] = input[key];
  if (input.outNextDay === true) defaults.outNextDay = true;
  return defaults;
}
