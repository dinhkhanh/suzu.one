// One person's KPI scorecard for a month: the lines, the score (stored, or provisional while the
// month is open), the whole working out, and the year so far from the stored months.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getKpiResults, getScorecard } from "../kpi-scores";
import { bpText, MonthPicker, monthLabel, periodLabel, ScoreFigure, ScoreState, Sparkline, TraceTable } from "./kpi";

export async function ScorecardView({ personId, month, basePath }: { personId: string; month: string; /** "/performance/kpis" or "/performance/kpis/<personId>". */ basePath: string }) {
  const year = Number(month.slice(0, 4));
  const [card, results, t, format] = await Promise.all([getScorecard(personId, month), getKpiResults({ personId, year }), getTranslations("performance"), getFormatter()]);
  const labels = { t: t as unknown as (key: string, values?: Record<string, string | number>) => string, format };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} href={(next) => `${basePath}?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
        <div className="flex items-center gap-3">
          {/* The year so far, as a series: the months before this one, newest at the right. */}
          {results.months.length > 1 ? <Sparkline series={[...results.months].sort((a, b) => a.month.localeCompare(b.month)).map((item) => item.scoreBp)} /> : null}
          <ScoreState state={card.state} label={t(`kpi.state.${card.state}`)} />
          <span className="text-2xl tracking-[-0.02em]">
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

      <Section title={t("kpi.year.title", { year })}>
        <p className="text-sm text-muted-foreground">
          {results.closedMonths.length === 0 ? t("kpi.year.none") : t("kpi.year.summary", { score: bpText(format, results.scoreBp), closed: results.closedMonths.length, open: results.openMonths.length })}
          {results.final ? ` ${t("kpi.year.final")}` : ""}
        </p>
        {results.months.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {results.months.map((item) => (
              <li key={item.month}>
                <Link href={`${basePath}?month=${item.month}`} className="press flex h-8 items-center gap-2 rounded-[0.625rem] border border-border bg-background px-2.5 text-[0.8125rem] hover:bg-canvas">
                  <span className="font-mono text-faint tabular-nums">{monthLabel(item.month)}</span>
                  <ScoreFigure bp={item.scoreBp} text={bpText(format, item.scoreBp)} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {results.byKpi.length > 0 ? (
          <TableCard>
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("kpi.columns.kpi")}</TableHead>
                <TableHead kind="date">{t("kpi.year.periods")}</TableHead>
                <TableHead kind="number">{t("kpi.year.weightMonths")}</TableHead>
                <TableHead kind="percent">{t("kpi.year.average")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.byKpi.map((line) => (
                <TableRow key={line.kpiCode}>
                  <TableCell>{line.kpiName}</TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">{line.periods.map(periodLabel).join(", ")}</TableCell>
                  <TableCell kind="number">{line.weightMonths}</TableCell>
                  <TableCell kind="percent">{bpText(format, line.averageBp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableCard>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("kpi.year.formula")}</p>
      </Section>
    </div>
  );
}
