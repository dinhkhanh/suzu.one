// One person's KPI scorecard for a month: the lines, the score (stored, or provisional while the
// month is open), the whole working out, and the year so far from the stored months.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { getKpiResults, getScorecard } from "../kpi-scores";
import { bpText, MonthPicker, monthLabel, periodLabel, ScoreFigure, ScoreState, TraceTable } from "./kpi";

export async function ScorecardView({ personId, month, basePath }: { personId: string; month: string; /** "/performance/kpis" or "/performance/kpis/<personId>". */ basePath: string }) {
  const year = Number(month.slice(0, 4));
  const [card, results, t, format] = await Promise.all([getScorecard(personId, month), getKpiResults({ personId, year }), getTranslations("performance"), getFormatter()]);
  const labels = { t: t as unknown as (key: string, values?: Record<string, string | number>) => string, format };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} href={(next) => `${basePath}?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
        <div className="flex items-center gap-3">
          <ScoreState state={card.state} label={t(`kpi.state.${card.state}`)} />
          <span className="text-2xl">
            <ScoreFigure bp={card.trace.scoreBp} text={bpText(format, card.trace.scoreBp)} />
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {card.state === "closed" && card.stored
          ? t("kpi.storedNote", { revision: card.stored.revision, date: format.dateTime(card.stored.computedAt, { dateStyle: "medium" }), hash: card.stored.inputsHash.slice(0, 12) })
          : card.trace.lines.length === 0
            ? t("kpi.nothingDue", { month: monthLabel(month) })
            : t("kpi.provisionalNote", { missing: card.missing })}
      </p>
      <TraceTable trace={card.trace} labels={labels} />
      {card.superseded.length > 0 ? (
        <section className="text-xs text-muted-foreground">
          <h3 className="font-medium">{t("kpi.superseded")}</h3>
          <ul className="list-disc pl-5">
            {card.superseded.map((row) => (
              <li key={row.revision}>{t("kpi.supersededLine", { revision: row.revision, score: bpText(format, row.scoreBp), date: format.dateTime(row.supersededAt, { dateStyle: "medium" }) })}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("kpi.year.title", { year })}</h2>
        <p className="text-sm text-muted-foreground">
          {results.closedMonths.length === 0 ? t("kpi.year.none") : t("kpi.year.summary", { score: bpText(format, results.scoreBp), closed: results.closedMonths.length, open: results.openMonths.length })}
          {results.final ? ` ${t("kpi.year.final")}` : ""}
        </p>
        {results.months.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {results.months.map((item) => (
              <li key={item.month}>
                <Link href={`${basePath}?month=${item.month}`} className="flex items-center gap-2 rounded-md border px-2 py-1 hover:bg-muted">
                  <span className="text-muted-foreground tabular-nums">{monthLabel(item.month)}</span>
                  <ScoreFigure bp={item.scoreBp} text={bpText(format, item.scoreBp)} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {results.byKpi.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 font-medium">{t("kpi.columns.kpi")}</th>
                  <th className="p-2 font-medium">{t("kpi.year.periods")}</th>
                  <th className="p-2 text-right font-medium">{t("kpi.year.weightMonths")}</th>
                  <th className="p-2 text-right font-medium">{t("kpi.year.average")}</th>
                </tr>
              </thead>
              <tbody>
                {results.byKpi.map((line) => (
                  <tr key={line.kpiCode} className="border-b last:border-0">
                    <td className="p-2">{line.kpiName}</td>
                    <td className="p-2 text-xs text-muted-foreground">{line.periods.map(periodLabel).join(", ")}</td>
                    <td className="p-2 text-right tabular-nums">{line.weightMonths}</td>
                    <td className="p-2 text-right tabular-nums">{bpText(format, line.averageBp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("kpi.year.formula")}</p>
      </section>
    </div>
  );
}
