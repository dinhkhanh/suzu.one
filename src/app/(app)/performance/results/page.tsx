import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import {
  canComputeResults,
  canOverrideResult,
  canDecideOutcome,
  canRaiseOutcome,
  canReadResultOf,
  canSettleResultOf,
  listOutcomes,
  type DirectoryPerson,
  getPublishedResult,
  hasWeighting,
  listCycleParticipants,
  listResults,
  listReviewCycles,
  loadDirectory,
  type PerformanceResultRow,
  findResult,
} from "@/modules/performance/service";
import { PerformanceNav, readYear, yearChoices } from "@/modules/performance/ui/nav";
import { BandBadge, percentText, ResultTraceTable, StatusBadge } from "@/modules/performance/ui/result";
import { ComputeResultsForm, OverrideResultForm, RecomputeResultForm, ResultStepForm } from "@/modules/performance/ui/result-forms";
import { OutcomeDecisionButtons, RaiseOutcomeForm } from "@/modules/performance/ui/one-on-one-forms";
import { requireUser } from "@/modules/platform/auth/session";
import Link from "next/link";

export const metadata: Metadata = { title: "Performance results" };

/**
 * The final yearly result (FR-PRF-09): my own once it is published, and — for HR and the owner —
 * everybody in reach with the whole derivation behind each figure.
 *
 * Everything on this page is **personal tier**. The band and its multiplier are numbers, not
 * money: what a multiplier is worth in VND is decided in payroll and never leaves it, so a line
 * manager reading a report's band still sees nothing of the bonus.
 */
export default async function ResultsPage({ searchParams }: PageProps<"/performance/results">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInVietnam();
  const year = readYear(params.year, today);
  const [t, format, locale, directory] = await Promise.all([getTranslations("performance.results"), getFormatter(), getLocale(), loadDirectory()]);

  const mine = await getPublishedResult(user.person.id, year);
  // What each settled result has led to (FR-PRF-06): a promotion, a salary proposal, a plan.
  const outcomes = await listOutcomes({ year });
  const tOutcome = await getTranslations("performance.oneOnOnes.outcomes");
  // Everything the viewer may read: the policy decides person by person, not by a query filter.
  const all = await listResults({ year });
  const readable = all.filter((line) => {
    const person = directory.get(line.personId);
    return !!person && line.personId !== user.person.id && canReadResultOf(user.principal, person);
  });

  // HR's "compute the year" button: the people of the year's annual cycles that this viewer manages.
  const cycles = (await listReviewCycles({ year })).filter((cycle) => cycle.kind === "annual" && cycle.status !== "draft");
  const participants = (await Promise.all(cycles.map((cycle) => listCycleParticipants(cycle.id)))).flat();
  const computable = [
    ...new Set(
      participants
        .map((line) => directory.get(line.personId))
        .filter((person): person is DirectoryPerson => !!person && canComputeResults(user.principal, person.entityId ?? null))
        .map((person) => person.personId),
    ),
  ];
  const weightingReady = await hasWeighting(null, year);
  const mayOverride = canOverrideResult(user.principal);

  const lineOf = async (personId: string): Promise<PerformanceResultRow | null> => findResult(personId, year);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <PerformanceNav active="results" />
      <nav className="flex flex-wrap items-center gap-1">
        {yearChoices(today).map((choice) => (
          <Link key={choice} href={`/performance/results?year=${choice}`} className={`rounded-md px-2 py-1 text-sm ${choice === year ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
            {choice}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3">
        <h2>{t("mine.title")}</h2>
        {mine ? (
          <article className="flex flex-col gap-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-semibold tabular-nums">{percentText(format, mine.finalScoreBp)}</span>
              <BandBadge band={mine.finalBand} label={mine.trace.finalBand ? (locale.startsWith("en") && mine.trace.finalBand.labelEn ? mine.trace.finalBand.labelEn : mine.trace.finalBand.label) : "—"} />
            </div>
            <ResultTraceTable trace={mine.trace} labels={{ t, format }} locale={locale} provenance={{ months: mine.kpiScoreIds.length, goals: mine.goalIds.length, weightingFrom: null }} />
          </article>
        ) : (
          <p className="text-sm text-muted-foreground">{t("mine.notPublished", { year })}</p>
        )}
      </section>

      {computable.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2>{t("compute.title")}</h2>
          {weightingReady ? <ComputeResultsForm year={year} personIds={computable} /> : <p className="text-sm text-amber-700 dark:text-amber-300">{t("compute.noWeighting")}</p>}
        </section>
      ) : null}

      {readable.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2>{t("list.title", { year })}</h2>
            <span className="text-xs text-muted-foreground">{t("list.count", { count: readable.length })}</span>
          </div>
          <ul className="flex flex-col gap-3">
            {readable.map(async (line) => {
              const person = directory.get(line.personId)!;
              const row = await lineOf(line.personId);
              const maySettle = canSettleResultOf(user.principal, person);
              return (
                <li key={line.id} className="flex flex-col gap-3 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-sm font-medium">{line.personName}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("list.review")} {percentText(format, line.reviewScoreBp)} · {t("list.kpi")} {percentText(format, line.kpiScoreBp)} · {t("list.okr")} {percentText(format, line.okrScoreBp)}
                    </span>
                    <span className="text-sm font-medium tabular-nums">{percentText(format, line.finalScoreBp)}</span>
                    <BandBadge band={line.finalBand} label={row?.trace.finalBand ? (locale.startsWith("en") && row.trace.finalBand.labelEn ? row.trace.finalBand.labelEn : row.trace.finalBand.label) : "—"} />
                    {line.overridden ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("list.overridden")}</span> : null}
                    <StatusBadge status={line.status} label={t(`status.${line.status}`)} />
                  </div>
                  {row ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("trace.title")}</summary>
                      <div className="pt-3">
                        <ResultTraceTable trace={row.trace} labels={{ t, format }} locale={locale} provenance={{ months: row.kpiScoreIds.length, goals: row.goalIds.length, weightingFrom: null }} />
                      </div>
                    </details>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {maySettle && line.status === "draft" ? <RecomputeResultForm personId={line.personId} year={year} /> : null}
                    {maySettle && line.status === "draft" ? <ResultStepForm resultId={line.id} step="lock" /> : null}
                    {maySettle && line.status === "locked" ? <ResultStepForm resultId={line.id} step="publish" /> : null}
                    {maySettle && line.status !== "draft" ? <ResultStepForm resultId={line.id} step="unlock" /> : null}
                  </div>
                  {mayOverride && line.status === "draft" ? <OverrideResultForm resultId={line.id} currentPercent={row?.overrideScoreBp === null || row === null ? "" : String(row.overrideScoreBp / 100)} reason={row?.overrideReason ?? ""} /> : null}

                  {/* FR-PRF-06: what this result leads to. A salary adjustment goes out through
                      payroll's own approval; the others raise a task for HR. */}
                  {(() => {
                    const own = outcomes.filter((outcome) => outcome.row.personId === line.personId);
                    const mayDecide = canDecideOutcome(user.principal, person);
                    if (own.length === 0 && !(line.status !== "draft" && canRaiseOutcome(user.principal, person))) return null;
                    return (
                      <div className="flex flex-col gap-2 border-t pt-2">
                        {own.map((outcome) => (
                          <div key={outcome.row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span>
                              {tOutcome(`type.${outcome.row.type as "promotion"}`)}
                              <span className="ml-2 text-xs text-muted-foreground">{tOutcome(`status.${outcome.row.status as "proposed"}`)}</span>
                              {outcome.row.note ? <span className="ml-2 text-xs text-muted-foreground">{outcome.row.note}</span> : null}
                            </span>
                            {mayDecide && outcome.row.status === "proposed" ? <OutcomeDecisionButtons outcomeId={outcome.row.id} /> : null}
                          </div>
                        ))}
                        {line.status !== "draft" && canRaiseOutcome(user.principal, person) ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">{tOutcome("raise")}</summary>
                            <div className="pt-2">
                              <RaiseOutcomeForm resultId={line.id} />
                            </div>
                          </details>
                        ) : null}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      )}
    </div>
  );
}
