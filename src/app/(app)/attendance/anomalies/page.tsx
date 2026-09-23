import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { ANOMALY_KINDS, type AnomalyKind, listAnomalies } from "@/modules/attendance/anomalies";
import { canLockPeriod, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { exportAnomaliesAction } from "@/modules/attendance/request-actions";
import { NudgeButton } from "@/modules/attendance/ui/request-forms";
import { MonthNav } from "@/modules/attendance/ui/timesheet-views";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("attendanceAnomalies");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HR's console (FR-ATT-15): what is still open in a month, within the viewer's `attendance:manage`
// reach, each line with the way to fix it. The same list is what the lock checks.
export default async function AnomaliesPage({ searchParams }: PageProps<"/attendance/anomalies">) {
  const user = await requireUser();
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const query = await searchParams;
  const t = await getTranslations("attendance.console");
  const thisMonth = todayInVietnam().slice(0, 7);
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= thisMonth ? query.month : thisMonth;
  const personId = typeof query.person === "string" && UUID.test(query.person) ? query.person : null;
  const kind = ANOMALY_KINDS.find((value) => value === query.kind) ?? null;
  // The list is read beside the entities, for the entity asked for; one the viewer may not lock is dropped and the list read again.
  const asked = typeof query.entity === "string" && UUID.test(query.entity) ? query.entity : null;
  const [allEntities, firstRead] = await Promise.all([listEntities(), listAnomalies(user.principal, month, { entityId: asked, personId, kind })]);
  const entities = allEntities.filter((entity) => canLockPeriod(user.principal, entity.id));
  const entityId = asked && entities.some((entity) => entity.id === asked) ? asked : null;
  const filters = { entityId, personId, kind };
  const { lines, counts, people } = entityId === asked ? firstRead : await listAnomalies(user.principal, month, filters);
  const href = (changes: { month?: string; entity?: string | null; kind?: AnomalyKind | null; person?: string | null }) => {
    const next = { month, entity: entityId, kind, person: personId, ...changes };
    return `/attendance/anomalies?${Object.entries(next).flatMap(([key, value]) => (value ? [`${key}=${value}`] : [])).join("&")}`;
  };
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <MonthNav month={month} hrefFor={(value) => href({ month: value })} thisMonth={thisMonth} />
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="tab-row">
          <Link href={href({ entity: null })} className={entityId ? "underline-offset-4 hover:underline" : "font-medium"}>
            {t("allEntities")}
          </Link>
          {entities.map((entity) => (
            <Link key={entity.id} href={href({ entity: entity.id })} className={entity.id === entityId ? "font-medium" : "underline-offset-4 hover:underline"}>
              {entity.shortName}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/attendance/timesheets?month=${month}${entityId ? `&entity=${entityId}` : ""}`} className="underline-offset-4 hover:underline">
            {t("toTimesheets")}
          </Link>
          <ExportButton action={exportAnomaliesAction} input={{ month, ...filters }} label={t("export")} failedLabel={t("exportFailed")} truncatedLabel={t("exportTruncated")} />
        </div>
      </div>
      <nav className="flex flex-wrap gap-2 text-xs">
        <Link href={href({ kind: null })} className={kind ? "rounded-md border px-2 py-1 hover:bg-muted" : "rounded-md bg-primary px-2 py-1 text-primary-foreground"}>
          {t("allKinds")} · {total}
        </Link>
        {ANOMALY_KINDS.filter((value) => counts[value]).map((value) => (
          <Link key={value} href={href({ kind: value })} className={value === kind ? "rounded-md bg-primary px-2 py-1 text-primary-foreground" : "rounded-md border px-2 py-1 hover:bg-muted"}>
            {t(`kinds.${value}`)} · {counts[value]}
          </Link>
        ))}
      </nav>
      {personId ? (
        <p className="text-sm">
          {people.find((person) => person.id === personId)?.fullName} ·{" "}
          <Link href={href({ person: null })} className="underline-offset-4 hover:underline">
            {t("clearPerson")}
          </Link>
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {lines.map((line) => (
            <li key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className={`rounded-md px-2 py-0.5 text-xs ${line.blocking ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{t(`kinds.${line.kind}`)}</span>
              {line.personId ? (
                <Link href={href({ person: line.personId })} className="min-w-36 font-medium underline-offset-4 hover:underline">
                  {line.fullName}
                </Link>
              ) : (
                <span className="min-w-36 font-medium">{line.detail}</span>
              )}
              <span className="w-24 text-muted-foreground">{line.date ? line.date.split("-").reverse().join("/") : ""}</span>
              <span className="text-muted-foreground">{line.kind === "unmapped_device_id" ? t("lines", { count: line.minutes ?? 0 }) : line.minutes ? t("minutes", { minutes: line.minutes }) : ""}</span>
              <span className="ml-auto flex items-center gap-2">
                {line.href ? (
                  <Link href={line.href} className="underline-offset-4 hover:underline">
                    {t(`fix.${line.fix}`)}
                  </Link>
                ) : null}
                {line.personId ? <NudgeButton personId={line.personId} month={month} label={t("nudge")} /> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
