import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    return `/attendance/anomalies?${Object.entries(next)
      .flatMap(([key, value]) => (value ? [`${key}=${value}`] : []))
      .join("&")}`;
  };
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
  const kindOptions = [
    { value: "all", label: t("allKinds"), count: total, href: href({ kind: null }) },
    ...ANOMALY_KINDS.filter((value) => counts[value]).map((value) => ({ value, label: t(`kinds.${value}`), count: counts[value], href: href({ kind: value }) })),
  ];

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Link href={`/attendance/timesheets?month=${month}${entityId ? `&entity=${entityId}` : ""}`} className={cn(buttonVariants({ variant: "outline" }))}>
              {t("toTimesheets")}
            </Link>
            <ExportButton action={exportAnomaliesAction} input={{ month, ...filters }} label={t("export")} failedLabel={t("exportFailed")} truncatedLabel={t("exportTruncated")} />
          </>
        }
      />

      <nav className="tab-row">
        <Link href={href({ entity: null })} aria-current={entityId ? undefined : "page"}>
          {t("allEntities")}
        </Link>
        {entities.map((entity) => (
          <Link key={entity.id} href={href({ entity: entity.id })} aria-current={entity.id === entityId ? "page" : undefined}>
            {entity.shortName}
          </Link>
        ))}
      </nav>

      <div className="toolbar justify-between">
        <div className="max-w-full overflow-x-auto">
          <Segmented aria-label={t("columns.kind")} value={kind ?? "all"} options={kindOptions} />
        </div>
        <MonthNav month={month} hrefFor={(value) => href({ month: value })} thisMonth={thisMonth} />
      </div>

      {personId ? (
        <p className="text-sm">
          <span className="font-medium">{people.find((person) => person.id === personId)?.fullName}</span> ·{" "}
          <Link href={href({ person: null })} className="text-link">
            {t("clearPerson")}
          </Link>
        </p>
      ) : null}

      <Section count={lines.length || null}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("columns.kind")}</TableHead>
                <TableHead kind="person">{t("columns.subject")}</TableHead>
                <TableHead kind="date">{t("columns.date")}</TableHead>
                <TableHead kind="number">{t("columns.amount")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
              {lines.map((line) => (
                <TableRow key={line.key}>
                  <TableCell>
                    <Badge dot variant={line.blocking ? "destructive" : "secondary"}>
                      {t(`kinds.${line.kind}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {line.personId ? (
                      <Link href={href({ person: line.personId })} className="hover:underline">
                        {line.fullName}
                      </Link>
                    ) : (
                      line.detail
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.date ? line.date.split("-").reverse().join("/") : ""}</TableCell>
                  <TableCell kind="number">{line.kind === "unmapped_device_id" ? t("lines", { count: line.minutes ?? 0 }) : line.minutes ? t("minutes", { minutes: line.minutes }) : ""}</TableCell>
                  <TableCell kind="actions">
                    <span className="flex items-center justify-end gap-2">
                      {line.href ? (
                        <Link href={line.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          {t(`fix.${line.fix}`)}
                        </Link>
                      ) : null}
                      {line.personId ? <NudgeButton personId={line.personId} month={month} label={t("nudge")} /> : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
    </Page>
  );
}
