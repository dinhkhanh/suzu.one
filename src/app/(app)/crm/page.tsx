import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { accountChoices, agingSummary, canEditActivity, crmSettings, expiringContracts, isStaleDeal, listDeals, listFollowUpsOf, listLeads, listSalesHandoffsFor, listStages, pipelineTotals, salesDashboard, salesTile, stageName } from "@/modules/crm/service";
import { crmShell, sells } from "@/modules/crm/pages";
import { type BoardColumn, DealBoard } from "@/modules/crm/ui/board";
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
  const [t, f, locale, followUps, handoffs, deals, leads, renewals, aging, people, entities, accounts, stages, settings, tile, dashboard] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    getLocale(),
    listFollowUpsOf(me, today),
    listSalesHandoffsFor(me),
    listDeals(viewer, { mine: true, status: "open" }),
    shell.show.leads ? listLeads(viewer, { status: "open", mine: !sells(viewer) }) : Promise.resolve([]),
    tiedAccounts.length ? expiringContracts(tiedAccounts, today, 90) : Promise.resolve([]),
    shell.show.invoices ? agingSummary(viewer) : Promise.resolve(null),
    listPersonNames(),
    listEntities(),
    accountChoices(viewer),
    shell.show.deals ? listStages() : Promise.resolve([]),
    crmSettings(today),
    // The key figures: this month's wins and the weighted pipeline, and the win rate — summed in
    // SQL over the deals this reader may value, by the same services the sales reports use.
    shell.show.deals ? salesTile(viewer, today) : Promise.resolve(null),
    shell.show.deals ? salesDashboard(viewer, {}, today) : Promise.resolve(null),
  ]);
  const overdue = aging ? aging.total - aging.current : 0;
  const sellers = people;
  const followUpOverdue = followUps.some((item) => !!item.dueOn && item.dueOn < today);

  // My open deals, by stage — the same board as the pipeline, narrowed to what is mine.
  const totals = pipelineTotals(deals);
  const columns: BoardColumn[] = stages
    .filter((stage) => stage.isActive && stage.category === "open")
    .map((stage) => {
      const total = totals.get(stage.id) ?? { count: 0, valued: 0, totalVnd: 0, weightedVnd: 0 };
      return {
        id: stage.id,
        name: stageName(stage, locale),
        category: stage.category,
        ...total,
        cards: deals
          .filter((deal) => deal.stageId === stage.id)
          .map((deal) => ({ id: deal.id, code: deal.code, title: deal.title, accountName: deal.accountName, ownerName: deal.ownerName, expectedCloseOn: deal.expectedCloseOn, stale: isStaleDeal({ lastTouchedOn: deal.lastTouchedOn }, today, settings.staleDealDays), value: deal.value ? { totalVnd: deal.value.totalVnd, weightedVnd: deal.value.weightedVnd } : null, canMove: deal.canEdit })),
      };
    });

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("home.intro")}
        actions={
          <>
            <Button nativeButton={false} variant="outline" render={<Link href="/crm/accounts" />}>
              {t("tabs.accounts")}
            </Button>
            {shell.show.invoices ? (
              <Button nativeButton={false} variant="outline" render={<Link href="/crm/invoices" />}>
                {t("tabs.invoices")}
              </Button>
            ) : null}
            {shell.show.deals ? (
              <Button nativeButton={false} render={<Link href="/crm/deals" />}>
                {t("home.pipeline")}
              </Button>
            ) : null}
          </>
        }
      />
      <CrmTabs current="home" show={shell.show} />

      {tile || dashboard ? (
        <TileGrid>
          {tile ? <Tile label={t("home.tiles.pipeline")} value={f.money(tile.weightedVnd)} hint={t("home.tiles.pipelineHint", { count: tile.openDeals })} href="/crm/deals" /> : null}
          {tile ? <Tile label={t("home.tiles.won")} value={f.money(tile.wonVnd)} hint={t("home.tiles.wonHint", { count: tile.wonCount })} tone={tile.wonCount > 0 ? "success" : undefined} href="/crm/deals?view=list&status=won" /> : null}
          <Tile label={t("home.tiles.followUps")} value={followUps.length} hint={followUpOverdue ? t("home.tiles.followUpsOverdue") : t("home.tiles.followUpsDue")} tone={followUpOverdue ? "destructive" : followUps.length > 0 ? "warning" : undefined} />
          {dashboard ? <Tile label={t("home.tiles.winRate")} value={f.percent(dashboard.winRate)} hint={t("home.tiles.winRateHint")} href="/crm/reports" /> : null}
        </TileGrid>
      ) : null}

      {handoffs.length ? (
        <Section title={t("home.handoffs")} count={handoffs.length}>
          <List>
            {handoffs.map((handoff) => (
              <ListItem key={handoff.projectId} className="flex-col items-stretch gap-2">
                <p>
                  <RecordLink kind="deal" id={handoff.dealId} className="font-medium">
                    {handoff.dealTitle}
                  </RecordLink>{" "}
                  → <RecordLink kind="project" id={handoff.projectId}>{handoff.projectName}</RecordLink>
                  <span className="text-xs text-faint"> · {t.rich("home.handoffFrom", { name: handoff.fromName ?? "—", date: f.when(handoff.createdAt), person: (chunks) => <RecordLink kind="person" id={handoff.fromPersonId}>{chunks}</RecordLink> })}</span>
                </p>
                <HandoffAnswerForm projectId={handoff.projectId} />
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      <Section title={t("home.followUps")} count={followUps.length || null}>
        <FollowUpList items={followUps} canEdit={(item) => canEditActivity(viewer, item, null)} people={people} meId={me} today={today} />
      </Section>

      <Section
        title={t("home.myDeals")}
        count={deals.length || null}
        action={shell.show.deals ? <Link href="/crm/deals">{t("home.pipeline")}</Link> : null}
      >
        {shell.show.deals && columns.length ? (
          deals.length === 0 ? (
            <List>
              <ListItem className="justify-center text-muted-foreground">{t("home.noDeals")}</ListItem>
            </List>
          ) : (
            <DealBoard columns={columns} />
          )
        ) : (
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
                    <RecordLink kind="deal" id={deal.id} className="font-medium">
                      {deal.title}
                    </RecordLink>
                  </TableCell>
                  <TableCell>
                    <RecordLink kind="account" id={deal.clientId}>{deal.accountName}</RecordLink>
                  </TableCell>
                  <TableCell>
                    <Badge dot variant="info">{deal.stage.name}</Badge>
                  </TableCell>
                  <TableCell kind="money">{deal.value ? f.money(deal.value.totalVnd) : "—"}</TableCell>
                  <TableCell kind="date">{deal.expectedCloseOn ? f.date(deal.expectedCloseOn) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {shell.show.leads ? (
        <Section title={t("home.myLeads")} count={leads.length || null}>
          <TableCard>
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
                      <RecordLink kind="lead" id={lead.id} className="font-medium">
                        {lead.companyName}
                      </RecordLink>
                    </TableCell>
                    <TableCell>
                      <Badge dot variant="outline">
                        {t(`enums.leadStatus.${lead.status as "new"}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{lead.ownerName ? <RecordLink kind="person" id={lead.ownerPersonId}>{lead.ownerName}</RecordLink> : t("leads.unassigned")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TableAddRow label={t("leads.new")}>
              <NewLeadForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} accounts={accounts} sellers={sellers} canAssign={sells(viewer)} />
            </TableAddRow>
          </TableCard>
        </Section>
      ) : null}

      {renewals.length ? (
        <Section title={t("home.renewals")} count={renewals.length}>
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
                    <RecordLink kind="contract" id={contract.id} className="font-medium text-foreground">
                      {contract.number}
                    </RecordLink>
                  </TableCell>
                  <TableCell>{contract.title}</TableCell>
                  <TableCell>
                    <RecordLink kind="account" id={contract.clientId}>{contract.accountName}</RecordLink>
                  </TableCell>
                  <TableCell kind="date">{f.date(contract.endDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {aging && aging.total > 0 ? (
        <Section title={t("home.receivables")} action={<Link href="/crm/invoices">{t("home.openReceivables")}</Link>}>
          <TileGrid>
            <Tile label={t("invoices.totalOpen", { count: aging.invoices })} value={f.money(aging.total)} href="/crm/invoices" />
            <Tile label={t("invoices.statuses.overdue")} value={f.money(overdue)} tone={overdue > 0 ? "destructive" : undefined} href="/crm/invoices?status=overdue" />
          </TileGrid>
        </Section>
      ) : null}
    </Page>
  );
}
