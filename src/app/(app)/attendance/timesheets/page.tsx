import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getPeriodOverview, listAdjustments, listMonthsToApprove } from "@/modules/attendance/months";
import { canLockPeriod } from "@/modules/attendance/policy";
import { listHoursToConfirm } from "@/modules/attendance/requests";
import { monthEnd, monthStart } from "@/modules/attendance/timesheets";
import { AdjustmentForm, ApproveMonthsForm, LockPeriodForm, RemindButton, ReopenMonthForm, VoidAdjustmentButton } from "@/modules/attendance/ui/request-forms";
import { MonthNav } from "@/modules/attendance/ui/timesheet-views";
import { exportLockedMonthAction } from "@/modules/attendance/request-actions";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("monthlyTimesheets");

// Monthly timesheets on their way to payroll (FR-ATT-14). A manager sees the months of their
// reports (approve, send back, confirm hours); HR sees each entity in their scope: progress,
// what blocks the lock, the lock itself, and adjustments afterwards. Empty for everyone else.
export default async function TimesheetsPage({ searchParams }: PageProps<"/attendance/timesheets">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance.months");
  const [format, locale] = await Promise.all([getFormatter(), getLocale()]);
  const today = todayInVietnam();
  const thisMonth = today.slice(0, 7);
  // The month that is waiting is the one that just ended.
  const lastMonth = addDays(monthStart(thisMonth), -1).slice(0, 7);
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= thisMonth ? query.month : lastMonth;
  const viewer = { personId: user.person.id, principal: user.principal };

  const entities = await listEntities();
  const mine = entities.filter((entity) => canLockPeriod(user.principal, entity.id));
  const chosen = typeof query.entity === "string" ? mine.find((entity) => entity.id === query.entity) : mine[0];
  const [[team, toConfirm], overview, adjustments] = await Promise.all([
    listMonthsToApprove(viewer, month).then(async (rows) => [rows, await listHoursToConfirm(rows.filter((row) => row.canApprove).map((row) => row.personId), monthStart(month), monthEnd(month) < today ? monthEnd(month) : today)] as const),
    chosen ? getPeriodOverview(chosen.id, month) : null,
    chosen ? listAdjustments({ entityId: chosen.id, month }) : [],
  ]);
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const href = (value: string) => `/attendance/timesheets?month=${value}${chosen ? `&entity=${chosen.id}` : ""}`;
  const nameOf = new Map(overview?.people.map((person) => [person.personId, person.fullName]));
  const locked = overview?.period?.status === "locked";
  const blocking = overview?.issues.filter((issue) => issue.blocking) ?? [];
  const unconfirmed = toConfirm;

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} actions={<MonthNav month={month} hrefFor={href} thisMonth={thisMonth} />} />

      <Section title={t("team.title")} count={team.length || null}>
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("team.empty")}</p>
        ) : (
          <>
            <ApproveMonthsForm month={month} rows={team.map((row) => ({ personId: row.personId, fullName: row.fullName, status: row.status, canApprove: row.canApprove, href: `/attendance?month=${month}&person=${row.personId}`, line: t("team.line", { paid: days(row.summary.paidDaysCenti), standard: row.summary.standardDays, overtime: hours(row.summary.otTotalMinutes), anomalies: row.summary.anomalyDays }) }))} />
            {team.filter((row) => row.canApprove && (row.status === "confirmed" || row.status === "approved")).map((row) => (
              <div key={row.personId} className="flex flex-wrap items-center gap-2 text-sm">
                <RecordLink kind="person" id={row.personId} className="min-w-40">{row.fullName}</RecordLink>
                <ReopenMonthForm month={month} personId={row.personId} label={t("team.sendBack")} placeholder={t("team.sendBackWhy")} />
              </div>
            ))}
          </>
        )}
      </Section>

      {unconfirmed.length > 0 ? (
        <Section title={t("team.hoursToConfirm")} count={unconfirmed.length}>
          <List>
            {unconfirmed.map((row) => (
              <ListItem key={row.id} href={`/approvals/attendance/${row.approvalRequestId}`}>
                <span className="flex-1 font-medium">{team.find((person) => person.personId === row.personId)?.fullName}</span>
                <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{row.startDate.split("-").reverse().join("/")}</span>
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      {chosen && overview ? (
        <Section
          title={t("period.title", { entity: chosen.shortName })}
          action={
            mine.length > 1 ? (
              <nav className="tab-row border-b-0">
                {mine.map((entity) => (
                  <Link key={entity.id} href={`/attendance/timesheets?month=${month}&entity=${entity.id}`} aria-current={entity.id === chosen.id ? "page" : undefined}>
                    {entity.shortName}
                  </Link>
                ))}
              </nav>
            ) : null
          }
        >
          <TileGrid className="md:grid-cols-4">
            {(["open", "confirmed", "approved", "locked"] as const).map((status) => (
              <Tile key={status} label={t(`status.${status}`)} value={overview.counts[status]} tone={status === "open" && overview.counts.open > 0 && overview.isOver ? "warning" : undefined} />
            ))}
          </TileGrid>
          {locked && overview.period ? (
            <>
              <Alert variant="success">
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">{t("period.lockedOn", { date: format.dateTime(overview.period.lockedAt!, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) })}</p>
                  {overview.period.overrideReason ? <p>{t("period.override", { reason: overview.period.overrideReason, count: overview.period.exceptions.length })}</p> : null}
                </div>
              </Alert>
              <div>
                <ExportButton action={exportLockedMonthAction} input={{ entityId: chosen.id, month, locale }} label={t("export.button")} failedLabel={t("export.failed")} truncatedLabel={t("export.truncated")} />
              </div>
            </>
          ) : (
            <>
              {overview.issues.length > 0 ? (
                <Section
                  title={t("period.issues", { blocking: blocking.length, total: overview.issues.length })}
                  action={<Link href={`/attendance/anomalies?month=${month}&entity=${chosen.id}`}>{t("period.openConsole")}</Link>}
                >
                  <List>
                    {overview.issues.map((issue) => (
                      <ListItem key={`${issue.personId}:${issue.code}`} className={issue.blocking ? "" : "text-muted-foreground"}>
                        <span className="flex-1">
                          <RecordLink kind="person" id={issue.personId} className="font-medium">{nameOf.get(issue.personId)}</RecordLink> — {t(`issues.${issue.code}`, { count: issue.count })}
                        </span>
                        {issue.blocking ? <Badge dot variant="destructive">{t("issues.blocking")}</Badge> : null}
                      </ListItem>
                    ))}
                  </List>
                </Section>
              ) : null}
              {overview.isOver && overview.people.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {overview.counts.open > 0 ? <RemindButton entityId={chosen.id} month={month} label={t("period.remind", { count: overview.counts.open })} /> : null}
                  <LockPeriodForm entityId={chosen.id} month={month} blocked={blocking.length > 0} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{overview.people.length === 0 ? t("period.empty") : t("period.notOver")}</p>
              )}
            </>
          )}

          {locked ? (
            <Section title={t("adjust.listTitle")} count={adjustments.length || null}>
              <TableCard>
                <List>
                  {adjustments.length === 0 ? <ListEmpty>{t("adjust.none")}</ListEmpty> : null}
                  {adjustments.map((row) => (
                    <ListItem key={row.id} className="flex-col items-stretch gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <RecordLink kind="person" id={row.personId} className="font-medium">{row.fullName}</RecordLink>
                        {row.date ? <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{row.date.split("-").reverse().join("/")}</span> : null}
                        <Badge variant={row.status === "voided" ? "outline" : "secondary"}>{row.status === "voided" ? t("adjust.voided") : row.payrollMonth ? t("adjust.inPayroll", { month: row.payrollMonth }) : t("adjust.waiting")}</Badge>
                      </div>
                      <p className="text-muted-foreground">
                        {Object.entries(row.deltas).map(([field, value]) => `${t(`adjust.fields.${field}`)}: ${(value ?? 0) > 0 ? "+" : ""}${value}`).join(" · ")} — {row.reason}
                      </p>
                      {row.status === "active" && !row.payrollMonth ? <VoidAdjustmentButton adjustmentId={row.id} label={t("adjust.void")} placeholder={t("adjust.voidWhy")} /> : null}
                    </ListItem>
                  ))}
                </List>
                <TableAddRow label={t("adjust.title")} open={adjustments.length === 0}>
                  <AdjustmentForm month={month} people={overview.people.map((person) => ({ id: person.personId, fullName: person.fullName }))} />
                </TableAddRow>
              </TableCard>
            </Section>
          ) : null}
        </Section>
      ) : null}
    </Page>
  );
}
