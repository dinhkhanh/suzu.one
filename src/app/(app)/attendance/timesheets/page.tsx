import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getPeriodOverview, listAdjustments, listMonthsToApprove } from "@/modules/attendance/months";
import { canLockPeriod } from "@/modules/attendance/policy";
import { listHoursToConfirm } from "@/modules/attendance/requests";
import { monthEnd, monthStart } from "@/modules/attendance/timesheets";
import { AdjustmentForm, ApproveMonthsForm, LockPeriodForm, RemindButton, ReopenMonthForm, VoidAdjustmentButton } from "@/modules/attendance/ui/request-forms";
import { MonthNav } from "@/modules/attendance/ui/timesheet-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "Monthly timesheets" };

// Monthly timesheets on their way to payroll (FR-ATT-14). A manager sees the months of their
// reports (approve, send back, confirm hours); HR sees each entity in their scope: progress,
// what blocks the lock, the lock itself, and adjustments afterwards. Empty for everyone else.
export default async function TimesheetsPage({ searchParams }: PageProps<"/attendance/timesheets">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance.months");
  const format = await getFormatter();
  const today = todayInVietnam();
  const thisMonth = today.slice(0, 7);
  // The month that is waiting is the one that just ended.
  const lastMonth = addDays(monthStart(thisMonth), -1).slice(0, 7);
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= thisMonth ? query.month : lastMonth;
  const viewer = { personId: user.person.id, principal: user.principal };

  const [team, entities] = await Promise.all([listMonthsToApprove(viewer, month), listEntities()]);
  const mine = entities.filter((entity) => canLockPeriod(user.principal, entity.id));
  const chosen = typeof query.entity === "string" ? mine.find((entity) => entity.id === query.entity) : mine[0];
  const [overview, adjustments, toConfirm] = await Promise.all([
    chosen ? getPeriodOverview(chosen.id, month) : null,
    chosen ? listAdjustments({ entityId: chosen.id, month }) : [],
    listHoursToConfirm(team.filter((row) => row.canApprove).map((row) => row.personId), monthStart(month), monthEnd(month) < today ? monthEnd(month) : today),
  ]);
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const href = (value: string) => `/attendance/timesheets?month=${value}${chosen ? `&entity=${chosen.id}` : ""}`;
  const nameOf = new Map(overview?.people.map((person) => [person.personId, person.fullName]));
  const locked = overview?.period?.status === "locked";
  const blocking = overview?.issues.filter((issue) => issue.blocking) ?? [];
  const unconfirmed = toConfirm;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <MonthNav month={month} hrefFor={href} thisMonth={thisMonth} />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("team.title")}</h2>
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("team.empty")}</p>
        ) : (
          <>
            <ApproveMonthsForm month={month} rows={team.map((row) => ({ personId: row.personId, fullName: row.fullName, status: row.status, canApprove: row.canApprove, href: `/attendance?month=${month}&person=${row.personId}`, line: t("team.line", { paid: days(row.summary.paidDaysCenti), standard: row.summary.standardDays, overtime: hours(row.summary.otTotalMinutes), anomalies: row.summary.anomalyDays }) }))} />
            {team.filter((row) => row.canApprove && (row.status === "confirmed" || row.status === "approved")).map((row) => (
              <div key={row.personId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-40">{row.fullName}</span>
                <ReopenMonthForm month={month} personId={row.personId} label={t("team.sendBack")} placeholder={t("team.sendBackWhy")} />
              </div>
            ))}
          </>
        )}
        {unconfirmed.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
            <h3 className="font-medium">{t("team.hoursToConfirm")}</h3>
            <ul className="list-disc pl-5">
              {unconfirmed.map((row) => (
                <li key={row.id}>
                  <Link href={`/approvals/attendance/${row.approvalRequestId}`} className="underline-offset-4 hover:underline">
                    {team.find((person) => person.personId === row.personId)?.fullName} · {row.startDate.split("-").reverse().join("/")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {chosen && overview ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("period.title", { entity: chosen.shortName })}</h2>
            {mine.length > 1 ? (
              <nav className="tab-row">
                {mine.map((entity) => (
                  <Link key={entity.id} href={`/attendance/timesheets?month=${month}&entity=${entity.id}`} className={entity.id === chosen.id ? "font-medium" : "underline-offset-4 hover:underline"}>
                    {entity.shortName}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["open", "confirmed", "approved", "locked"] as const).map((status) => (
              <div key={status} className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">{t(`status.${status}`)}</dt>
                <dd className="text-xl font-semibold">{overview.counts[status]}</dd>
              </div>
            ))}
          </dl>
          {locked && overview.period ? (
            <div className="rounded-xl border p-4 text-sm">
              <p className="font-medium">{t("period.lockedOn", { date: format.dateTime(overview.period.lockedAt!, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) })}</p>
              {overview.period.overrideReason ? <p className="text-muted-foreground">{t("period.override", { reason: overview.period.overrideReason, count: overview.period.exceptions.length })}</p> : null}
            </div>
          ) : (
            <>
              {overview.issues.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{t("period.issues", { blocking: blocking.length, total: overview.issues.length })}</h3>
                    <Link href={`/attendance/anomalies?month=${month}&entity=${chosen.id}`} className="underline-offset-4 hover:underline">
                      {t("period.openConsole")}
                    </Link>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {overview.issues.map((issue) => (
                      <li key={`${issue.personId}:${issue.code}`} className={issue.blocking ? "" : "text-muted-foreground"}>
                        {nameOf.get(issue.personId)} — {t(`issues.${issue.code}`, { count: issue.count })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {overview.isOver && overview.people.length > 0 ? (
                <>
                  {overview.counts.open > 0 ? <RemindButton entityId={chosen.id} month={month} label={t("period.remind", { count: overview.counts.open })} /> : null}
                  <LockPeriodForm entityId={chosen.id} month={month} blocked={blocking.length > 0} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{overview.people.length === 0 ? t("period.empty") : t("period.notOver")}</p>
              )}
            </>
          )}

          {locked ? (
            <>
              <h3 className="text-sm font-medium text-muted-foreground">{t("adjust.listTitle")}</h3>
              {adjustments.length === 0 ? <p className="text-sm text-muted-foreground">{t("adjust.none")}</p> : null}
              <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
                {adjustments.map((row) => (
                  <li key={row.id} className="flex flex-col gap-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.fullName}</span>
                      {row.date ? <span className="text-muted-foreground">{row.date.split("-").reverse().join("/")}</span> : null}
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{row.status === "voided" ? t("adjust.voided") : row.payrollMonth ? t("adjust.inPayroll", { month: row.payrollMonth }) : t("adjust.waiting")}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {Object.entries(row.deltas).map(([field, value]) => `${t(`adjust.fields.${field}`)}: ${(value ?? 0) > 0 ? "+" : ""}${value}`).join(" · ")} — {row.reason}
                    </p>
                    {row.status === "active" && !row.payrollMonth ? <VoidAdjustmentButton adjustmentId={row.id} label={t("adjust.void")} placeholder={t("adjust.voidWhy")} /> : null}
                  </li>
                ))}
              </ul>
              <AdjustmentForm month={month} people={overview.people.map((person) => ({ id: person.personId, fullName: person.fullName }))} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
