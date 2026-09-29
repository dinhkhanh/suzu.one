import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { listBillingQueue } from "@/modules/projects/service";
import { accountsById, AGING_BUCKETS, agingSummary, canRecordInvoices, contractNumbersOfProjects, listInvoices, vatRates } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { RecordInvoiceForm } from "@/modules/crm/ui/money-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmInvoices");

const STATUSES = ["open", "overdue", "paid", "written_off", "all"] as const;

export default async function InvoicesPage({ searchParams }: PageProps<"/crm/invoices">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.invoices) notFound();
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status) ?? "open";
  const today = todayInVietnam();
  const records = can(user.principal, "pjm:commercial");
  const [t, f, aging, invoices, ready, accounts, vat] = await Promise.all([getTranslations("crm"), formatters(), agingSummary(shell.viewer, {}, today), listInvoices(shell.viewer, { status }, today), records ? listBillingQueue(user.principal, { status: "ready" }) : Promise.resolve([]), accountsById(), vatRates(today)]);
  const references = await contractNumbersOfProjects([...new Set(ready.map((item) => item.projectId))]);
  // One invoice goes to one client from one entity: ready items grouped that way, those this reader may invoice.
  const groups = new Map<string, { accountName: string; entityName: string | null; items: typeof ready }>();
  for (const item of ready) {
    const account = item.clientId ? accounts.get(item.clientId) : undefined;
    if (!account || !canRecordInvoices(shell.viewer, item.entityId)) continue;
    const key = `${account.client.id}:${item.entityId ?? "group"}`;
    const group = groups.get(key) ?? { accountName: account.client.name, entityName: item.entityName, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <h1>{t("invoices.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("invoices.intro")}</p>
      </header>
      <CrmTabs current="invoices" show={shell.show} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {AGING_BUCKETS.map((bucket) => (
          <div key={bucket} className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t(`enums.aging.${bucket}`)}</p>
            <p className={`text-lg font-medium tabular-nums ${bucket !== "current" && aging[bucket] > 0 ? "text-destructive" : ""}`}>{f.money(aging[bucket])}</p>
          </div>
        ))}
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">{t("invoices.totalOpen", { count: aging.invoices })}</p>
          <p className="text-lg font-medium tabular-nums">{f.money(aging.total)}</p>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((value) => (
          <Link key={value} href={`/crm/invoices?status=${value}`} aria-current={value === status ? "page" : undefined} className={`rounded-md border px-3 py-1 ${value === status ? "bg-muted font-medium" : "text-muted-foreground"}`}>
            {t(`invoices.statuses.${value}`)}
          </Link>
        ))}
      </nav>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("invoices.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoices.columns.number")}</TableHead>
              <TableHead>{t("invoices.columns.account")}</TableHead>
              <TableHead>{t("invoices.columns.issued")}</TableHead>
              <TableHead>{t("invoices.columns.due")}</TableHead>
              <TableHead>{t("invoices.columns.standing")}</TableHead>
              <TableHead className="text-right">{t("invoices.columns.total")}</TableHead>
              <TableHead className="text-right">{t("invoices.columns.outstanding")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Link href={`/crm/invoices/${invoice.id}`} className="font-medium hover:underline">
                    {invoice.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">{invoice.entityName}</p>
                </TableCell>
                <TableCell>
                  <Link href={`/crm/accounts/${invoice.clientId}`} className="hover:underline">
                    {invoice.accountName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{invoice.managerName}</p>
                </TableCell>
                <TableCell className="text-sm">{f.date(invoice.issuedOn)}</TableCell>
                <TableCell className="text-sm">
                  {f.date(invoice.dueOn)}
                  {invoice.daysPastDue > 0 ? <p className="text-xs text-destructive">{t("invoices.daysLate", { days: invoice.daysPastDue })}</p> : null}
                </TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
                    {t(`enums.invoiceStanding.${invoice.standing}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{f.money(invoice.totalVnd)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.money(invoice.outstandingVnd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {groups.size ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("invoices.recordTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("invoices.recordIntro")}</p>
          {[...groups.entries()].map(([key, group]) => (
            <details key={key} className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {group.accountName}
                {group.entityName ? ` · ${group.entityName}` : ""} · {t("invoices.readyCount", { count: group.items.length })}
              </summary>
              <div className="pt-3">
                <RecordInvoiceForm items={group.items.map((item) => ({ id: item.id, projectName: item.projectName, jobNumber: item.jobNumber, description: item.description, amountVnd: item.amountVnd ?? null, reference: item.reference ?? references.get(item.projectId) ?? null }))} vatRates={vat.allowedBp} defaultVat={vat.defaultBp} today={today} />
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
