import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listBonusRuns, openBonusTotals } from "@/modules/payroll/service";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach, payrollReadReach } from "@/modules/payroll/policy";
import { NewBonusRunForm } from "@/modules/payroll/ui/bonus-forms";
import { formatVnd } from "@/modules/payroll/ui/money";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("yearEndBonus");

/**
 * The year-end bonus register (FR-PAY-21). One run per year across the whole group; the totals
 * are money, so only a payroll reader over **every** entity in a run sees its figure.
 */
export default async function BonusRunsPage() {
  const user = await requireUser();
  const reach = payrollReadReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/bonus");

  const [t, format, runs, entities] = await Promise.all([getTranslations("payroll.bonus"), getFormatter(), listBonusRuns(), listEntityOptions(reach)]);
  const manages = compensationReach(user.principal);
  const canCreate = manages.all || manages.entityIds.length > 0;
  const mayRead = (entityIds: string[]) => reach.all || entityIds.every((entityId) => reach.entityIds.includes(entityId));
  const year = Number(todayInVietnam().slice(0, 4));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
            ← {t("back")}
          </Link>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/payroll/bonus/scheme" className="h-9 rounded-md border px-3 text-sm leading-9 hover:bg-muted">
          {t("scheme.link")}
        </Link>
      </header>

      <ul className="flex flex-col gap-3">
        {runs.map((run) => {
          const readable = mayRead(run.entityIds);
          const totals = readable ? openBonusTotals(run) : null;
          return (
            <li key={run.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-sm">
              <div className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {readable ? <Link href={`/payroll/bonus/${run.id}`} className="underline">{run.name}</Link> : run.name}
                  <Badge dot variant={statusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
                </span>
                <span className="text-muted-foreground">
                  {t("runYear", { year: run.year })} · {t("payrollMonth", { month: run.payrollMonth })} · {t("headcount", { count: run.headcount, eligible: run.eligibleCount })}
                </span>
                {run.approvedAt ? <span className="text-xs text-muted-foreground">{t("approvedAt", { at: format.dateTime(run.approvedAt, { dateStyle: "medium" }) })}</span> : null}
              </div>
              <span className="text-right tabular-nums">{totals ? formatVnd(totals.totalVnd) : t("hidden")}</span>
            </li>
          );
        })}
      </ul>
      {runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}

      {canCreate ? <NewBonusRunForm entities={entities} year={year} payrollMonth={`${year + 1}-01`} /> : null}
    </div>
  );
}
