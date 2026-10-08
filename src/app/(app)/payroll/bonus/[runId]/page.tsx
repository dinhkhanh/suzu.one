import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { statusTone } from "@/components/ui/tone";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import {
  availableBonusSteps,
  canAdjustBonusLine,
  canManageBonusRun,
  canReadBonusRun,
  bonusCostOf,
  bonusHandoffState,
  getBonusRun,
  getBonusScheme,
  listBonusHandoffs,
  listBonusLines,
  listBonusRunEvents,
  schemeDateOf,
} from "@/modules/payroll/service";
import { BonusStepForm, PayBonusRunButton, SimulateButton, WhatIfForm } from "@/modules/payroll/ui/bonus-forms";
import { formatVnd } from "@/modules/payroll/ui/money";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("bonusRun");

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

  const manages = canManageBonusRun(user.principal, run.entityIds);
  const [t, tRuns, format, lines, events, handoffs, scheme] = await Promise.all([
    getTranslations("payroll.bonus"),
    getTranslations("payroll.runs.statuses"),
    getFormatter(),
    listBonusLines(runId),
    listBonusRunEvents(runId),
    listBonusHandoffs(runId),
    // The scheme in force for the first entity — what the what-if form starts from.
    manages ? getBonusScheme(run.entityIds[0] ?? null, schemeDateOf(run.year)).catch(() => null) : null,
  ]);
  // The cost is the lines added up: worked out from the ones just read, not read again.
  const cost = await bonusCostOf(lines);
  const steps = availableBonusSteps(run);
  const hasSteps = manages && steps.length > 0;
  // Where each entity stands with payroll once the run has been handed over: an entity whose
  // off-cycle run was cancelled there is "not handed over" again, and can be handed over alone.
  const entityNameOf = new Map(cost.byEntity.map((entity) => [entity.entityId, entity.entityName]));
  const handoff =
    run.status === "paid"
      ? bonusHandoffState(
          run,
          lines.map((line) => ({ entityId: line.row.entityId, finalAmountVnd: line.trace.finalAmountVnd })),
          handoffs,
        ).filter((entity) => entity.payable > 0)
      : [];
  const notHandedOver = handoff.filter((entity) => !entity.payrollRunId);

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/payroll/bonus" className="text-link hover:underline">
              ← {t("title")}
            </Link>
            <span className="text-faint">·</span>
            <Badge dot variant={statusTone(run.status)}>
              {t(`status.${run.status}`)}
            </Badge>
          </span>
        }
        title={run.name}
        description={`${t("runYear", { year: run.year })} · ${t("payrollMonth", { month: run.payrollMonth })} · ${t("headcount", { count: run.headcount, eligible: run.eligibleCount })}`}
      />

      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-[0.9375rem]">{t("cost.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("cost.hint")}</p>
        </CardContent>
        <Table numbered={false} containerClassName="rounded-none border-0 border-t">
          <TableBody>
            {cost.byEntity.map((entity) => (
              <TableRow key={entity.entityId}>
                <TableCell className="text-muted-foreground">
                  <RecordLink kind="entity" id={entity.entityId}>
                    {entity.entityName}
                  </RecordLink>{" "}
                  · {t("headcount", { count: entity.totals.headcount, eligible: entity.totals.eligible })}
                </TableCell>
                <TableCell kind="money">{formatVnd(entity.totals.totalVnd)}</TableCell>
              </TableRow>
            ))}
            {cost.totals.overridden > 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground">{t("cost.beforeOverrides")}</TableCell>
                <TableCell kind="money" className="text-muted-foreground">
                  {formatVnd(cost.totals.computedTotalVnd)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">{t("cost.total")}</TableCell>
              <TableCell kind="money" className="font-semibold">
                {formatVnd(cost.totals.totalVnd)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {hasSteps ? (
          <CardFooter className="flex-col items-stretch gap-4 md:flex-row md:flex-wrap md:items-start">
            {steps.includes("simulate") ? <SimulateButton runId={runId} label={t("steps.simulate")} /> : null}
            {steps.includes("propose") ? <BonusStepForm runId={runId} step="propose" label={t("steps.propose")} /> : null}
            {steps.includes("approve") ? <BonusStepForm runId={runId} step="approve" label={t("steps.approve")} /> : null}
            {steps.includes("return") ? <BonusStepForm runId={runId} step="return" label={t("steps.return")} destructive /> : null}
            {steps.includes("pay") ? <PayBonusRunButton runId={runId} /> : null}
            {steps.includes("cancel") ? <BonusStepForm runId={runId} step="cancel" label={t("steps.cancel")} destructive /> : null}
          </CardFooter>
        ) : null}
      </Card>

      {handoff.length > 0 ? (
        <Section title={t("handoff.title")} description={t("handoff.hint")}>
          {notHandedOver.length > 0 ? <Alert variant="warning">{t("handoff.attention", { count: notHandedOver.length })}</Alert> : null}
          <TableCard>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="org">{t("handoff.entity")}</TableHead>
                  <TableHead kind="number">{t("handoff.people")}</TableHead>
                  <TableHead kind="status">{t("handoff.state")}</TableHead>
                  <TableHead kind="link">{t("handoff.payrollRun")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {handoff.map((entity) => (
                  <TableRow key={entity.entityId}>
                    <TableCell>
                      <RecordLink kind="entity" id={entity.entityId}>
                        {entityNameOf.get(entity.entityId) ?? "—"}
                      </RecordLink>
                    </TableCell>
                    <TableCell kind="number">{entity.payable}</TableCell>
                    <TableCell>
                      <Badge dot variant={entity.payrollRunId ? "success" : "warning"}>
                        {t(entity.payrollRunId ? "handoff.handedOver" : "handoff.notHandedOver")}
                      </Badge>
                      {entity.cancelledPayrollRunId ? <span className="ml-2 text-xs text-muted-foreground">{t("handoff.cancelled")}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {entity.payrollRunId ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <RecordLink kind="payrollRun" id={entity.payrollRunId} className="underline">
                            {t("trace.offCycleRun")}
                          </RecordLink>
                          {entity.payrollRunStatus ? <Badge variant={statusTone(entity.payrollRunStatus)}>{tRuns(entity.payrollRunStatus)}</Badge> : null}
                        </span>
                      ) : manages ? (
                        <PayBonusRunButton runId={runId} entityId={entity.entityId} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      <Section title={t("lines.title")} count={lines.length || undefined}>
        <TableCard>
          {canAdjustBonusLine(user.principal) ? <TableCardHeader title={t("lines.title")} description={t("lines.adjustHint")} /> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("lines.person")}</TableHead>
                <TableHead kind="select">{t("lines.band")}</TableHead>
                <TableHead kind="number">{t("lines.multiplier")}</TableHead>
                <TableHead kind="money">{t("lines.computed")}</TableHead>
                <TableHead kind="money">{t("lines.final")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableEmpty>{t("lines.empty")}</TableEmpty> : null}
              {lines.map((line) => (
                <TableRow key={line.row.id}>
                  <TableCell>
                    <Link href={`/payroll/bonus/${runId}/${line.row.personId}`} className="font-medium hover:underline">
                      {line.personName}
                    </Link>
                    {line.trace.override ? (
                      <Badge variant="outline" className="ml-2">
                        {t("lines.overridden")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{line.row.eligible ? (line.trace.performance.bandLabel ?? "—") : <span className="text-muted-foreground">{t(`trace.exclusion.${line.trace.exclusion ?? "no_result"}`)}</span>}</TableCell>
                  <TableCell kind="number">{factor(line.trace.combinedMultiplierBp)}</TableCell>
                  <TableCell kind="money" className="text-muted-foreground">
                    {formatVnd(line.trace.computedAmountVnd)}
                  </TableCell>
                  <TableCell kind="money" className="font-medium">
                    {formatVnd(line.trace.finalAmountVnd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      {manages && scheme ? <WhatIfForm runId={runId} current={scheme.value} /> : null}

      <Section title={t("events.title")} count={events.length || undefined}>
        <List>
          {events.length === 0 ? <ListEmpty>{t("events.empty")}</ListEmpty> : null}
          {events.map((event) => (
            <ListItem key={event.id} className="flex-wrap items-baseline justify-between">
              <span>
                {t(`status.${event.fromStatus}`)} → <span className="font-medium">{t(`status.${event.toStatus}`)}</span>
                {event.comment ? <span className="text-muted-foreground"> — {event.comment}</span> : null}
              </span>
              <span className="font-mono text-xs text-faint tabular-nums">{format.dateTime(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
