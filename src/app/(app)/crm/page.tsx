import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("home.handoffs")}</h2>
          <ul className="flex flex-col gap-2">
            {handoffs.map((handoff) => (
              <li key={handoff.projectId} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
                <p>
                  <Link href={`/crm/deals/${handoff.dealId}`} className="font-medium underline">
                    {handoff.dealTitle}
                  </Link>{" "}
                  → <Link href={`/projects/${handoff.projectId}`}>{handoff.projectName}</Link>
                  <span className="text-xs text-muted-foreground"> · {t("home.handoffFrom", { name: handoff.fromName ?? "—", date: f.when(handoff.createdAt) })}</span>
                </p>
                <HandoffAnswerForm projectId={handoff.projectId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("home.followUps")}</h2>
        <FollowUpList items={followUps} canEdit={(item) => canEditActivity(viewer, item, null)} people={people} meId={me} today={today} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("home.myDeals")}</h2>
          {shell.show.deals ? (
            <Link href="/crm/deals" className="text-xs underline">
              {t("home.pipeline")}
            </Link>
          ) : null}
        </div>
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("home.noDeals")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {deals.map((deal) => (
              <li key={deal.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Link href={`/crm/deals/${deal.id}`} className="font-medium hover:underline">
                  {deal.title}
                </Link>
                <span className="text-xs text-muted-foreground">{deal.accountName}</span>
                <Badge variant="outline">{deal.stage.name}</Badge>
                {deal.value ? <span className="ml-auto tabular-nums">{f.money(deal.value.totalVnd)}</span> : null}
                {deal.expectedCloseOn ? <span className="text-xs text-muted-foreground">{f.date(deal.expectedCloseOn)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {shell.show.leads && leads.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("home.myLeads")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {leads.slice(0, 10).map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Link href={`/crm/leads/${lead.id}`} className="font-medium hover:underline">
                  {lead.companyName}
                </Link>
                <Badge dot variant="outline">
                  {t(`enums.leadStatus.${lead.status as "new"}`)}
                </Badge>
                <span className="text-xs text-muted-foreground">{lead.ownerName ?? t("leads.unassigned")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {renewals.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("home.renewals")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {renewals.map((contract) => (
              <li key={contract.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Link href={`/crm/contracts/${contract.id}`} className="font-medium hover:underline">
                  {contract.number}
                </Link>
                <span>{contract.title}</span>
                <span className="text-xs text-muted-foreground">{contract.accountName}</span>
                <span className="ml-auto text-xs">{t("home.endsOn", { date: f.date(contract.endDate) })}</span>
              </li>
            ))}
          </ul>
        </section>
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

      {shell.show.leads ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("leads.new")}</summary>
          <div className="pt-3">
            <NewLeadForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} accounts={accounts} sellers={sellers} canAssign={sells(viewer)} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
