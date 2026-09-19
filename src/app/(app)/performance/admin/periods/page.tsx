import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { canCloseKpiMonth, canReopenKpiMonth, closeBlockers, listPeriods } from "@/modules/performance/service";
import { MonthPicker, monthLabel, readMonth, ScoreState } from "@/modules/performance/ui/kpi";
import { CloseMonthForm, ReopenMonthForm } from "@/modules/performance/ui/kpi-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "KPI periods" };

// Closing a month stores every score of an entity (FR-PRF-02, SRS D13): refused while actuals are
// missing unless HR overrides with a reason; reopening is group HR's, with a reason, and keeps the
// old scores as superseded.
export default async function KpiPeriodsPage({ searchParams }: PageProps<"/performance/admin/periods">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const month = readMonth((await searchParams).month, today);
  const entities = (await listEntities()).filter((entity) => entity.isActive && canCloseKpiMonth(user.principal, entity.id));
  const [periods, t, format] = await Promise.all([listPeriods({ month, entityIds: entities.map((entity) => entity.id) }), getTranslations("performance"), getFormatter()]);
  const over = month < today.slice(0, 7);
  const rows = await Promise.all(
    entities.map(async (entity) => {
      const period = periods.find((row) => row.entityId === entity.id) ?? null;
      return { entity, period, blockers: period?.status === "closed" ? [] : await closeBlockers(entity.id, month) };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("periods.description")}</p>
      <MonthPicker month={month} href={(next) => `/performance/admin/periods?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
      {!over ? <p className="text-sm text-muted-foreground">{t("periods.notOver", { month: monthLabel(month) })}</p> : null}
      {rows.map(({ entity, period, blockers }) => {
        const closed = period?.status === "closed";
        return (
          <article key={entity.id} className="flex flex-col gap-3 rounded-xl border p-3">
            <header className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-medium">{`${entity.code} · ${entity.shortName}`}</h2>
              <ScoreState state={closed ? "closed" : "open"} label={t(`kpi.state.${closed ? "closed" : "open"}`)} />
              {closed && period?.closedAt ? <span className="text-xs text-muted-foreground">{t("periods.closedOn", { date: format.dateTime(period.closedAt, { dateStyle: "medium" }) })}</span> : null}
            </header>
            {closed && period?.overrideReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("periods.overridden", { count: period.exceptions?.length ?? 0, reason: period.overrideReason })}</p> : null}
            {!closed && period?.reopenReason ? <p className="text-xs text-muted-foreground">{t("periods.reopened", { reason: period.reopenReason })}</p> : null}
            {closed ? canReopenKpiMonth(user.principal) ? <ReopenMonthForm entityId={entity.id} month={month} /> : <p className="text-xs text-muted-foreground">{t("periods.reopenGroupOnly")}</p> : over ? <CloseMonthForm entityId={entity.id} month={month} blockers={blockers} /> : blockers.length > 0 ? <p className="text-xs text-muted-foreground">{t("periods.blocked", { count: blockers.length })}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
