import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { listBillingQueue } from "@/modules/projects/service";
import { accountsById, AGING_BUCKETS, agingSummary, canRecordInvoices, contractNumbersOfProjects, heldBillingItemIds, listInvoices, vatRates } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { RecordInvoiceForm } from "@/modules/crm/ui/money-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmInvoices");

const STATUSES = ["open", "overdue", "paid", "written_off", "draft", "void", "all"] as const;

export default async function InvoicesPage({ searchParams }: PageProps<"/crm/invoices">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.invoices) notFound();
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status) ?? "open";
  const today = todayInVietnam();
  const records = can(user.principal, "pjm:commercial");
  const [t, f, aging, invoices, ready, accounts, vat] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    agingSummary(shell.viewer, {}, today),
    listInvoices(shell.viewer, { status }, today),
    records ? listBillingQueue(user.principal, { status: "ready" }) : Promise.resolve([]),
    accountsById(),
    vatRates(today),
  ]);
  const [references, held] = await Promise.all([contractNumbersOfProjects([...new Set(ready.map((item) => item.projectId))]), heldBillingItemIds(ready.map((item) => item.id))]);
  // One invoice goes to one client from one entity: ready items grouped that way, those this reader
  // may invoice — and not those a draft already holds (they are on that draft's page).
  const groups = new Map<string, { accountName: string; entityName: string | null; items: typeof ready }>();
  for (const item of ready) {
    const account = item.clientId ? accounts.get(item.clientId) : undefined;
    if (!account || held.has(item.id) || !canRecordInvoices(shell.viewer, item.entityId)) continue;
    const key = `${account.client.id}:${item.entityId ?? "group"}`;
    const group = groups.get(key) ?? { accountName: account.client.name, entityName: item.entityName, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  return (
    <Page width="wide">
      <PageHeader title={t("invoices.title")} description={t("invoices.intro")} />
      <CrmTabs current="invoices" show={shell.show} />

      {/* Receivables by age: the current bucket plain, every late bucket red once it holds anything. */}
      <TileGrid>
        <Tile label={t("invoices.totalOpen", { count: aging.invoices })} value={f.money(aging.total)} />
        {AGING_BUCKETS.map((bucket) => (
          <Tile key={bucket} label={t(`enums.aging.${bucket}`)} value={f.money(aging[bucket])} tone={bucket !== "current" && aging[bucket] > 0 ? "destructive" : undefined} />
        ))}
      </TileGrid>

      <nav className="tab-row" aria-label={t("invoices.columns.standing")}>
        {STATUSES.map((value) => (
          <Link key={value} href={`/crm/invoices?status=${value}`} aria-current={value === status ? "page" : undefined}>
            {t(`invoices.statuses.${value}`)}
          </Link>
        ))}
      </nav>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="id">{t("invoices.columns.number")}</TableHead>
            <TableHead kind="org">{t("invoices.columns.account")}</TableHead>
            <TableHead kind="date">{t("invoices.columns.issued")}</TableHead>
            <TableHead kind="date">{t("invoices.columns.due")}</TableHead>
            <TableHead kind="status">{t("invoices.columns.standing")}</TableHead>
            <TableHead kind="money">{t("invoices.columns.total")}</TableHead>
            <TableHead kind="money">{t("invoices.columns.outstanding")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 ? <TableEmpty>{t("invoices.empty")}</TableEmpty> : null}
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell kind="id">
                <RecordLink kind="invoice" id={invoice.id} className="font-medium text-foreground">
                  {invoice.number ?? t("invoice.draftHeading")}
                </RecordLink>
                <p className="font-sans text-xs text-faint">
                  <RecordLink kind="entity" id={invoice.entityId}>
                    {invoice.entityName}
                  </RecordLink>
                </p>
              </TableCell>
              <TableCell>
                <RecordLink kind="account" id={invoice.clientId}>
                  {invoice.accountName}
                </RecordLink>
                <p className="text-xs text-faint">
                  <RecordLink kind="person" id={invoice.managerPersonId}>
                    {invoice.managerName}
                  </RecordLink>
                </p>
              </TableCell>
              <TableCell kind="date">{f.date(invoice.issuedOn)}</TableCell>
              <TableCell kind="date">
                {f.date(invoice.dueOn)}
                {invoice.daysPastDue > 0 ? <p className="text-xs text-destructive">{t("invoices.daysLate", { days: invoice.daysPastDue })}</p> : null}
              </TableCell>
              <TableCell>
                <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
                  {t(`enums.invoiceStanding.${invoice.standing}`)}
                </Badge>
              </TableCell>
              <TableCell kind="money">{f.money(invoice.totalVnd)}</TableCell>
              <TableCell kind="money" className={invoice.outstandingVnd > 0 && invoice.daysPastDue > 0 ? "text-destructive" : undefined}>
                {f.money(invoice.outstandingVnd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {groups.size ? (
        <Section>
          <TableCard>
            <TableCardHeader title={t("invoices.recordTitle")} count={groups.size} description={t("invoices.recordIntro")} />
            <List>
              {[...groups.entries()].map(([key, group]) => (
                <ListItem key={key} className="block">
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {group.accountName}
                      {group.entityName ? ` · ${group.entityName}` : ""} <span className="font-mono text-xs font-normal text-faint tabular-nums">{t("invoices.readyCount", { count: group.items.length })}</span>
                    </summary>
                    <div className="pt-3">
                      <RecordInvoiceForm
                        items={group.items.map((item) => ({
                          id: item.id,
                          projectId: item.projectId,
                          projectName: item.projectName,
                          jobNumber: item.jobNumber,
                          description: item.description,
                          amountVnd: item.amountVnd ?? null,
                          reference: item.reference ?? references.get(item.projectId) ?? null,
                        }))}
                        vatRates={vat.allowedBp}
                        defaultVat={vat.defaultBp}
                        today={today}
                      />
                    </div>
                  </details>
                </ListItem>
              ))}
            </List>
          </TableCard>
        </Section>
      ) : null}
    </Page>
  );
}
