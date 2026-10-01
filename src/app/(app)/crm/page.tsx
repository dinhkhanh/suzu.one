import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { accountChoices, agingSummary, canEditActivity, expiringContracts, listDeals, listFollowUpsOf, listLeads, listSalesHandoffsFor } from "@/modules/crm/service";
import { crmShell, sells } from "@/modules/crm/pages";
import { HandoffAnswerForm, NewLeadForm } from "@/modules/crm/ui/deal-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { FollowUpList, formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crm");

export default async function CrmHomePage() {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.opens) notFound();
  const { viewer } = shell;
  const today = todayInVietnam();
  const me = user.person.id;
  const tiedAccounts = [...viewer.ties.keys()];
  const [t, f, followUps, handoffs, deals, leads, renewals, aging, people, entities, accounts] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    listFollowUpsOf(me, today),
    listSalesHandoffsFor(me),
    listDeals(viewer, { mine: true, status: "open" }),
    shell.show.leads ? listLeads(viewer, { status: "open", mine: !sells(viewer) }) : Promise.resolve([]),
    tiedAccounts.length ? expiringContracts(tiedAccounts, today, 90) : Promise.resolve([]),
    shell.show.invoices ? agingSummary(viewer) : Promise.resolve(null),
    listPersonNames(),
    listEntities(),
    accountChoices(viewer),
  ]);
  const overdue = aging ? aging.total - aging.current : 0;
  const sellers = people;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("home.intro")}</p>
      </header>
      <CrmTabs current="home" show={shell.show} />

      {handoffs.length ? (
        <TableCard>
          <TableCardHeader title={t("home.handoffs")} count={handoffs.length} />
          <List>
            {handoffs.map((handoff) => (
              <ListItem key={handoff.projectId} className="flex-col items-stretch gap-2">
                <p>
                  <Link href={`/crm/deals/${handoff.dealId}`} className="font-medium underline">
                    {handoff.dealTitle}
                  </Link>{" "}
                  → <Link href={`/projects/${handoff.projectId}`}>{handoff.projectName}</Link>
                  <span className="text-xs text-muted-foreground"> · {t("home.handoffFrom", { name: handoff.fromName ?? "—", date: f.when(handoff.createdAt) })}</span>
                </p>
                <HandoffAnswerForm projectId={handoff.projectId} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("home.followUps")} count={followUps.length || null} />
        <FollowUpList items={followUps} canEdit={(item) => canEditActivity(viewer, item, null)} people={people} meId={me} today={today} />
      </TableCard>

      <TableCard>
        <TableCardHeader
          title={t("home.myDeals")}
          count={deals.length || null}
          actions={
            shell.show.deals ? (
              <Link href="/crm/deals" className="text-xs underline">
                {t("home.pipeline")}
              </Link>
            ) : null
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("deals.columns.deal")}</TableHead>
              <TableHead kind="org">{t("deals.columns.account")}</TableHead>
              <TableHead kind="status">{t("deals.columns.stage")}</TableHead>
              <TableHead kind="money">{t("deals.columns.value")}</TableHead>
              <TableHead kind="date">{t("deals.columns.close")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.length === 0 ? <TableEmpty>{t("home.noDeals")}</TableEmpty> : null}
            {deals.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell>
                  <Link href={`/crm/deals/${deal.id}`} className="font-medium hover:underline">
                    {deal.title}
                  </Link>
                </TableCell>
                <TableCell>{deal.accountName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{deal.stage.name}</Badge>
                </TableCell>
                <TableCell kind="money">{deal.value ? f.money(deal.value.totalVnd) : "—"}</TableCell>
                <TableCell>{deal.expectedCloseOn ? f.date(deal.expectedCloseOn) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {shell.show.leads ? (
        <TableCard>
          <TableCardHeader title={t("home.myLeads")} count={leads.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("lead.fields.companyName")}</TableHead>
                <TableHead kind="status">{t("leads.status")}</TableHead>
                <TableHead kind="person">{t("lead.fields.owner")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? <TableEmpty>{t("leads.empty")}</TableEmpty> : null}
              {leads.slice(0, 10).map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <Link href={`/crm/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.companyName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge dot variant="outline">
                      {t(`enums.leadStatus.${lead.status as "new"}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{lead.ownerName ?? t("leads.unassigned")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableAddRow label={t("leads.new")}>
            <NewLeadForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} accounts={accounts} sellers={sellers} canAssign={sells(viewer)} />
          </TableAddRow>
        </TableCard>
      ) : null}

      {renewals.length ? (
        <TableCard>
          <TableCardHeader title={t("home.renewals")} count={renewals.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("contracts.columns.number")}</TableHead>
                <TableHead kind="text">{t("contract.fields.title")}</TableHead>
                <TableHead kind="org">{t("contracts.columns.account")}</TableHead>
                <TableHead kind="date">{t("contract.fields.endDate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renewals.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell kind="id">
                    <Link href={`/crm/contracts/${contract.id}`} className="font-medium text-foreground hover:underline">
                      {contract.number}
                    </Link>
                  </TableCell>
                  <TableCell>{contract.title}</TableCell>
                  <TableCell>{contract.accountName}</TableCell>
                  <TableCell>{f.date(contract.endDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {aging && aging.total > 0 ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          <span className="font-medium">{t("home.receivables")}</span>
          <span className="tabular-nums">{f.money(aging.total)}</span>
          {overdue > 0 ? <Badge variant="destructive">{t("home.overdue", { amount: f.money(overdue) })}</Badge> : null}
          <Link href="/crm/invoices" className="ml-auto text-xs underline">
            {t("home.openReceivables")}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
