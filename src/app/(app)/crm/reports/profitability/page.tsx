import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { canReadProfitability } from "@/modules/reports/service";
import { getClientProfitability } from "@/modules/crm/profitability";
import { crmShell } from "@/modules/crm/pages";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmProfitability");

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Client profitability (FR-CRM-33): per account, revenue against delivery cost and the cost of sale
 * (pitch projects). `pjm:cost` only, with a fresh step-up like every compensation screen; no figure
 * here belongs to one person.
 */
export default async function ClientProfitabilityPage({ searchParams }: PageProps<"/crm/reports/profitability">) {
  const user = await requireUser();
  if (!canReadProfitability(user.principal)) notFound();
  requireStepUp(user, "/crm/reports/profitability");
  const shell = await crmShell(user);
  const params = await searchParams;
  const today = todayInVietnam();
  const start = new Date(`${today.slice(0, 4)}-01-01T00:00:00Z`).toISOString().slice(0, 10);
  const pick = (name: string) => (typeof params[name] === "string" && DAY.test(params[name]) ? (params[name] as string) : undefined);
  const period = { from: pick("from") ?? start, to: pick("to") ?? today };
  if (period.from > period.to) period.from = period.to;
  const [t, f, view] = await Promise.all([getTranslations("crm"), formatters(), getClientProfitability({ userId: user.userId, email: user.email, person: user.person, principal: user.principal, request: user.request }, period)]);
  if (!view) notFound();
  const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link href="/crm/reports" className="underline">
            {t("reports.title")}
          </Link>
        </p>
        <h1>{t("profitability.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("profitability.intro")}</p>
      </header>
      <CrmTabs current="reports" show={shell.show} />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <DatePicker name="from" defaultValue={period.from} aria-label={t("profitability.from")} />
        <DatePicker name="to" defaultValue={period.to} aria-label={t("profitability.to")} />
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>
      <Table numbered={false}>
        <TableHeader>
          <TableRow>
            <TableHead kind="org">{t("profitability.account")}</TableHead>
            <TableHead kind="money">{t("profitability.revenue")}</TableHead>
            <TableHead kind="money">{t("profitability.deliveryCost")}</TableHead>
            <TableHead kind="money">{t("profitability.costOfSale")}</TableHead>
            <TableHead kind="money">{t("profitability.margin")}</TableHead>
            <TableHead kind="percent">{t("profitability.rate")}</TableHead>
            <TableHead kind="time">{t("profitability.hours")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.accounts.map((row) => (
            <TableRow key={row.accountId ?? "none"}>
              <TableCell>
                {row.accountId ? (
                  <Link href={`/crm/accounts/${row.accountId}`} className="hover:underline">
                    {row.accountName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t("profitability.noClient")}</span>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("profitability.counts", { projects: row.projects, pitches: row.pitches })}
                  {row.estimated ? ` · ${t("profitability.estimated")}` : ""}
                </p>
              </TableCell>
              <TableCell kind="money">{f.money(row.revenueVnd)}</TableCell>
              <TableCell kind="money">{f.money(row.deliveryCostVnd)}</TableCell>
              <TableCell kind="money">{f.money(row.costOfSaleVnd)}</TableCell>
              <TableCell kind="money" className={row.marginVnd < 0 ? "text-destructive" : undefined}>{f.money(row.marginVnd)}</TableCell>
              <TableCell kind="percent">{percent(row.marginRate)}</TableCell>
              <TableCell kind="time">{row.hours}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>{t("profitability.total")}</TableCell>
            <TableCell kind="money">{f.money(view.total.revenueVnd)}</TableCell>
            <TableCell kind="money">{f.money(view.total.deliveryCostVnd)}</TableCell>
            <TableCell kind="money">{f.money(view.total.costOfSaleVnd)}</TableCell>
            <TableCell kind="money">{f.money(view.total.marginVnd)}</TableCell>
            <TableCell kind="percent">{percent(view.total.marginRate)}</TableCell>
            <TableCell kind="time">{view.total.hours}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {view.privateLine ? (
        <p className="text-sm text-muted-foreground">
          <Badge variant="outline">{t("profitability.private")}</Badge> {t("profitability.privateLine", { projects: view.privateLine.projects, cost: f.money(view.privateLine.costVnd), fee: f.money(view.privateLine.feeVnd) })}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("profitability.basis")}</p>
    </div>
  );
}
