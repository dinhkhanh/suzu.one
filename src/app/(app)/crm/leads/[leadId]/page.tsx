import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { listTeams } from "@/modules/work/service";
import { accountChoices, canEditActivity, canEraseLeadContact, canViewLead, canWorkLead, getLead, leadFacts, type LeadStatus, listActivities, listOpenFollowUps, listStages, stageName } from "@/modules/crm/service";
import { crmShell, sells } from "@/modules/crm/pages";
import { LogActivityForm } from "@/modules/crm/ui/activity-forms";
import { AssignLeadForm, ConvertLeadForm, DisqualifyForm, EditLeadForm, EraseLeadContactForm, LeadStatusButtons } from "@/modules/crm/ui/deal-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { ActivityList, FollowUpList, formatters } from "@/modules/crm/ui/views";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("crmLead");

export default async function LeadPage({ params }: PageProps<"/crm/leads/[leadId]">) {
  const user = await requireUser();
  const { leadId } = await params;
  const shell = await crmShell(user);
  const lead = await getLead(leadId);
  if (!lead || !canViewLead(shell.viewer, leadFacts(lead))) notFound();
  const works = canWorkLead(shell.viewer, leadFacts(lead));
  // Erasure on request (PDPL): while the lead still names somebody, open or closed.
  const erases = canEraseLeadContact(shell.viewer, leadFacts(lead)) && !!(lead.contactName || lead.contactTitle || lead.email || lead.phone);
  const today = todayInVietnam();
  const [t, f, locale, people, entities, accounts, teams, stages, activities, followUps] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    getLocale(),
    listPersonNames(),
    listEntities(),
    accountChoices(shell.viewer),
    listTeams(),
    listStages(),
    listActivities({ leadId }),
    listOpenFollowUps({ leadId }),
  ]);
  const entityOptions = entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const seller = sells(shell.viewer);

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <>
            <Link href="/crm/leads" className="underline">
              {t("leads.title")}
            </Link>
          </>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {lead.companyName}
            <Badge dot variant="outline">
              {t(`enums.leadStatus.${lead.status as LeadStatus}`)}
            </Badge>
          </span>
        }
      >
        <p className="text-sm text-muted-foreground">
          {[
            t(`enums.source.${lead.source as "referral"}`),
            lead.entityName ? (
              <RecordLink key="entity" kind="entity" id={lead.entityId}>
                {lead.entityName}
              </RecordLink>
            ) : null,
            lead.ownerName ? (
              <span key="owner">
                {t.rich("lead.ownerIs", {
                  name: lead.ownerName,
                  person: (chunks) => (
                    <RecordLink kind="person" id={lead.ownerPersonId}>
                      {chunks}
                    </RecordLink>
                  ),
                })}
              </span>
            ) : (
              t("leads.unassigned")
            ),
            lead.referrerName ? (
              <span key="referrer">
                {t.rich("leads.referredBy", {
                  name: lead.referrerName,
                  person: (chunks) => (
                    <RecordLink kind="person" id={lead.referrerPersonId}>
                      {chunks}
                    </RecordLink>
                  ),
                })}
              </span>
            ) : null,
            f.when(lead.createdAt),
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index ? [" · ", part] : [part]))}
        </p>
        {lead.status === "converted" && lead.convertedDealId ? (
          <p className="text-sm">
            <Link href={`/crm/deals/${lead.convertedDealId}`} className="underline">
              {t("lead.openDeal")}
            </Link>
          </p>
        ) : null}
        {lead.status === "disqualified" ? <p className="text-sm text-muted-foreground">{t("lead.disqualifiedBecause", { reason: lead.disqualifyReason ?? "—" })}</p> : null}
      </PageHeader>
      <CrmTabs current="leads" show={shell.show} />

      <section className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">{t("lead.fields.contactName")}: </span>
          {[lead.contactName, lead.contactTitle].filter(Boolean).join(" — ") || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">{t("lead.fields.email")}: </span>
          {[lead.email, lead.phone].filter(Boolean).join(" · ") || "—"}
        </p>
        <div className="sm:col-span-2">
          <span className="text-muted-foreground">{t("lead.fields.need")}: </span>
          {lead.need?.trim() ? <RichText text={lead.need} /> : "—"}
        </div>
        <p>
          <span className="text-muted-foreground">{t("lead.fields.budget")}: </span>
          {lead.budgetText ?? "—"}
        </p>
        {lead.clientName ? (
          <p>
            <span className="text-muted-foreground">{t("lead.fields.existingAccount")}: </span>
            <RecordLink kind="account" id={lead.clientId} className="underline">
              {lead.clientName}
            </RecordLink>
          </p>
        ) : null}
        {erases ? (
          <div className="sm:col-span-2">
            <EraseLeadContactForm leadId={lead.id} />
          </div>
        ) : null}
      </section>

      {works ? (
        <section className="flex flex-col gap-3">
          <LeadStatusButtons leadId={lead.id} status={lead.status} />
          {seller ? <AssignLeadForm leadId={lead.id} current={lead.ownerPersonId} sellers={people} /> : null}
          <details className="rounded-xl border p-4" open>
            <summary className="cursor-pointer text-sm font-medium">{t("lead.convert")}</summary>
            <div className="pt-3">
              <ConvertLeadForm
                leadId={lead.id}
                lead={lead}
                accounts={accounts}
                entities={entityOptions}
                teams={teams.filter((team) => team.isActive).map((team) => ({ id: team.id, name: team.name }))}
                stages={stages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stageName(stage, locale), category: stage.category }))}
                sellers={people}
                ownerId={lead.ownerPersonId ?? user.person.id}
              />
            </div>
          </details>
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("lead.edit")}</summary>
            <div className="pt-3">
              <EditLeadForm leadId={lead.id} lead={lead} entities={entityOptions} accounts={accounts} />
            </div>
          </details>
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("lead.disqualify")}</summary>
            <div className="pt-3">
              <DisqualifyForm leadId={lead.id} />
            </div>
          </details>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("account.sections.followUps")}</h2>
        <FollowUpList items={followUps} canEdit={(item) => canEditActivity(shell.viewer, item, null)} people={people} meId={user.person.id} today={today} showTarget={false} />
        {works ? (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("activity.log")}</summary>
            <div className="pt-3">
              <LogActivityForm target={{ leadId: lead.id }} contacts={[]} people={people} meId={user.person.id} today={today} />
            </div>
          </details>
        ) : null}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("account.sections.activities")}</h2>
        <ActivityList items={activities.filter((activity) => !!activity.doneAt)} />
      </section>
    </Page>
  );
}
