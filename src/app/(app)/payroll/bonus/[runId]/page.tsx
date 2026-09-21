import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { availableBonusSteps, canAdjustBonusLine, canManageBonusRun, canReadBonusRun, getBonusCost, getBonusRun, getBonusScheme, listBonusLines, listBonusRunEvents, schemeDateOf } from "@/modules/payroll/service";
import { BonusStepForm, PayBonusRunButton, SimulateButton, WhatIfForm } from "@/modules/payroll/ui/bonus-forms";
import { formatVnd } from "@/modules/payroll/ui/money";

export const metadata: Metadata = { title: "Bonus run" };

const factor = (bp: number | null): string => (bp === null ? "—" : `× ${(bp / 10_000).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);

/**
 * One year-end bonus run: the cost across the group, every person's line with the band behind it,
 * and the steps — HR proposes, the owner adjusts a line, the CEO signs, C&B pays it out through
 * off-cycle payroll runs (FR-PAY-21).
 */
export default async function BonusRunPage({ params }: PageProps<"/payroll/bonus/[runId]">) {
  const user = await requireUser();
  const { runId } = await params;
  const run = await getBonusRun(runId);
  if (!run || !canReadBonusRun(user.principal, run.entityIds)) notFound();
  requireStepUp(user, `/payroll/bonus/${runId}`);

  const [t, format, cost, lines, events] = await Promise.all([getTranslations("payroll.bonus"), getFormatter(), getBonusCost(runId), listBonusLines(runId), listBonusRunEvents(runId)]);
  const manages = canManageBonusRun(user.principal, run.entityIds);
  const steps = availableBonusSteps(run);
  // The scheme in force for the first entity — what the what-if form starts from.
  const scheme = manages ? await getBonusScheme(run.entityIds[0] ?? null, schemeDateOf(run.year)).catch(() => null) : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/payroll/bonus" className="text-sm text-muted-foreground hover:underline">
            ← {t("title")}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2">
            {run.name}
            <Badge variant={run.status === "paid" ? "secondary" : "outline"}>{t(`status.${run.status}`)}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("runYear", { year: run.year })} · {t("payrollMonth", { month: run.payrollMonth })} · {t("headcount", { count: run.headcount, eligible: run.eligibleCount })}
          </p>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2>{t("cost.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("cost.hint")}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-xl border p-4 text-sm">
          {cost.byEntity.map((entity) => (
            <div key={entity.entityId} className="contents">
              <dt className="text-muted-foreground">
                {entity.entityName} · {t("headcount", { count: entity.totals.headcount, eligible: entity.totals.eligible })}
              </dt>
              <dd className="text-right tabular-nums">{formatVnd(entity.totals.totalVnd)}</dd>
            </div>
          ))}
          <dt className="border-t pt-2 font-medium">{t("cost.total")}</dt>
          <dd className="border-t pt-2 text-right font-semibold tabular-nums">{formatVnd(cost.totals.totalVnd)}</dd>
          {cost.totals.overridden > 0 ? (
            <div className="contents">
              <dt className="text-muted-foreground">{t("cost.beforeOverrides")}</dt>
              <dd className="text-right tabular-nums text-muted-foreground">{formatVnd(cost.totals.computedTotalVnd)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {manages ? (
        <section className="flex flex-wrap items-start gap-4">
          {steps.includes("simulate") ? <SimulateButton runId={runId} label={t("steps.simulate")} /> : null}
          {steps.includes("propose") ? <BonusStepForm runId={runId} step="propose" label={t("steps.propose")} /> : null}
          {steps.includes("approve") ? <BonusStepForm runId={runId} step="approve" label={t("steps.approve")} /> : null}
          {steps.includes("return") ? <BonusStepForm runId={runId} step="return" label={t("steps.return")} destructive /> : null}
          {steps.includes("pay") ? <PayBonusRunButton runId={runId} /> : null}
          {steps.includes("cancel") ? <BonusStepForm runId={runId} step="cancel" label={t("steps.cancel")} destructive /> : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2>{t("lines.title")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("lines.person")}</TableHead>
              <TableHead>{t("lines.band")}</TableHead>
              <TableHead className="text-right">{t("lines.multiplier")}</TableHead>
              <TableHead className="text-right">{t("lines.computed")}</TableHead>
              <TableHead className="text-right">{t("lines.final")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.row.id}>
                <TableCell>
                  <Link href={`/payroll/bonus/${runId}/${line.row.personId}`} className="underline">
                    {line.personName}
                  </Link>
                  {line.trace.override ? <span className="ml-2 text-xs text-muted-foreground">{t("lines.overridden")}</span> : null}
                </TableCell>
                <TableCell>{line.row.eligible ? (line.trace.performance.bandLabel ?? "—") : <span className="text-muted-foreground">{t(`trace.exclusion.${line.trace.exclusion ?? "no_result"}`)}</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{factor(line.trace.combinedMultiplierBp)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatVnd(line.trace.computedAmountVnd)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatVnd(line.trace.finalAmountVnd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {lines.length === 0 ? <p className="text-sm text-muted-foreground">{t("lines.empty")}</p> : null}
        {canAdjustBonusLine(user.principal) ? <p className="text-sm text-muted-foreground">{t("lines.adjustHint")}</p> : null}
      </section>

      {manages && scheme ? <WhatIfForm runId={runId} current={scheme.value} /> : null}

      <section className="flex flex-col gap-2">
        <h2>{t("events.title")}</h2>
        <ol className="flex flex-col divide-y rounded-xl border px-4 text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
              <span>
                {t(`status.${event.fromStatus}`)} → {t(`status.${event.toStatus}`)}
                {event.comment ? <span className="text-muted-foreground"> — {event.comment}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{format.dateTime(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
            </li>
          ))}
        </ol>
        {events.length === 0 ? <p className="text-sm text-muted-foreground">{t("events.empty")}</p> : null}
      </section>
    </div>
  );
}
