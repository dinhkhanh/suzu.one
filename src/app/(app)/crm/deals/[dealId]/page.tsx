import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { listAssignableByTeam, listTeams, listWorkTemplates } from "@/modules/work/service";
import { HandoffNoteView } from "@/modules/work/ui/handoff";
import {
  accountTimeline,
  canEditActivity,
  canEditDeal,
  canLogActivity,
  canReassignDeal,
  canReopenDeal,
  canSetUpDelivery,
  canViewQuotes,
  contractChoices,
  getDeal,
  listActivities,
  listContacts,
  listDealContacts,
  listDealProjects,
  listOpenFollowUps,
  listQuotes,
  listStageChanges,
  listStages,
  stageName,
} from "@/modules/crm/service";
import { createQuoteAction } from "@/modules/crm/quote-actions";
import { crmShell } from "@/modules/crm/pages";
import { LogActivityForm } from "@/modules/crm/ui/activity-forms";
import { CrmButton } from "@/modules/crm/ui/common";
import { DealContactsForm, DeliverySetupForm, EditDealForm, HandoffAnswerForm, MoveStageForm, PitchForm, ReassignDealForm, ReopenDealForm, ResendHandoffForm } from "@/modules/crm/ui/deal-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { ActivityList, FollowUpList, formatters, Timeline } from "@/modules/crm/ui/views";
import { staffingCheck } from "@/modules/crm/staffing";
import { canFileHiringRequest } from "@/modules/recruit/service";

export const generateMetadata = pageTitle("crmDeal");

export default async function DealPage({ params, searchParams }: PageProps<"/crm/deals/[dealId]">) {
  const user = await requireUser();
  const { dealId } = await params;
  const shell = await crmShell(user);
  const found = await getDeal(shell.viewer, dealId);
  if (!found) notFound();
  const { deal, account, facts } = found;
  const query = await searchParams;
  const today = todayInVietnam();
  const edits = canEditDeal(shell.viewer, facts);
  const quotesVisible = canViewQuotes(shell.viewer, facts);
  const setsUp = canSetUpDelivery(shell.viewer, facts);
  const [t, f, locale, people, entities, teams, stages, contacts, dealContacts, changes, quotes, projects, activities, followUps, timeline] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    getLocale(),
    listPersonNames(),
    listEntities(),
    listTeams(),
    listStages(),
    listContacts(account.client.id, false),
    listDealContacts(dealId),
    listStageChanges(dealId),
    quotesVisible ? listQuotes(dealId) : Promise.resolve([]),
    listDealProjects([dealId]),
    listActivities({ dealId }),
    listOpenFollowUps({ dealId }),
    accountTimeline({ clientIds: [account.client.id], accountId: account.client.id, projectIds: [], worksAccount: true, seesReceivables: false, dealId }, 40),
  ]);
  const activeTeams = teams.filter((team) => team.isActive);
  const needsTeams = (edits && !deal.pitchProjectId) || setsUp;
  // The staffing check (FR-CRM-17): the quote's hours against the team's free time, for whoever may plan that team.
  const staffing = quotesVisible && deal.status === "open" ? await staffingCheck(user, deal, quotes, today) : null;
  const hours = (minutes: number) => f.hours(minutes);
  const [members, templates, contracts] = await Promise.all([needsTeams ? listAssignableByTeam(activeTeams.map((team) => team.id)) : Promise.resolve(new Map<string, { id: string; fullName: string }[]>()), setsUp ? listWorkTemplates(undefined, { activeOnly: true }) : Promise.resolve([]), setsUp ? contractChoices(account.client.id) : Promise.resolve([])]);
  const teamsWithPeople = activeTeams.map((team) => ({ id: team.id, name: team.name, people: members.get(team.id) ?? [] })).filter((team) => team.people.length > 0);
  const stageOptions = stages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stageName(stage, locale), category: stage.category }));
  const currentStage = stages.find((stage) => stage.id === deal.stageId);
  const contactOptions = contacts.filter((contact) => contact.status === "active").map((contact) => ({ id: contact.id, name: contact.title ? `${contact.fullName} — ${contact.title}` : contact.fullName }));
  const allowsPitch = !!currentStage?.allowsPitch && deal.status === "open" && !deal.pitchProjectId;
  const entityOptions = entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const handoffWaiting = projects.find((project) => project.handoffStatus === "pending" && project.handoffToPersonId === user.person.id);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/crm/deals" className="underline">
            {t("deals.title")}
          </Link>{" "}
          ·{" "}
          <Link href={`/crm/accounts/${account.client.id}`} className="underline">
            {account.client.name}
          </Link>
          {deal.brandName ? ` · ${deal.brandName}` : ""}
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {deal.title}
          <span className="font-mono text-sm text-muted-foreground">{deal.code}</span>
          <Badge dot variant={deal.status === "won" ? "success" : deal.status === "lost" ? "secondary" : "info"}>
            {stageName(deal.stage, locale)}
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {[t("deal.ownerIs", { name: deal.ownerName ?? "—" }), deal.teamName ? t("deal.teamIs", { name: deal.teamName }) : null, deal.entityName, deal.serviceLines.map((line) => t(`enums.serviceLine.${line as "social"}`)).join(", ") || null].filter(Boolean).join(" · ")}
        </p>
        {deal.value ? (
          <p className="text-sm">
            {t("deal.valueIs", { total: f.money(deal.value.totalVnd), weighted: f.money(deal.value.weightedVnd), probability: deal.probabilityNow })}
            {deal.value.monthlyVnd ? ` · ${t("deal.monthlyIs", { amount: f.money(deal.value.monthlyVnd), months: deal.value.months ?? 1 })}` : ""}
          </p>
        ) : null}
        <p className="text-sm">
          {t("deal.closeIs", { date: f.date(deal.expectedCloseOn) })}
          {deal.nextStep ? ` · ${t("deal.nextStepIs", { step: deal.nextStep })}` : ""}
        </p>
        {deal.status === "lost" ? <p className="text-sm text-muted-foreground">{t("deal.lostBecause", { reason: deal.lostReason ? t(`enums.lostReason.${deal.lostReason as "price"}`) : "—", note: deal.lostNote ?? "" })}</p> : null}
        {account.profile?.creditHold ? <p className="text-sm text-destructive">{t("deal.creditHoldWarning", { reason: account.profile.creditHoldReason ?? "" })}</p> : null}
      </header>
      <CrmTabs current="deals" show={shell.show} />

      {handoffWaiting ? (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4">
          <h2 className="text-sm font-medium">{t("deal.handoff.waiting", { project: handoffWaiting.projectName })}</h2>
          <HandoffNoteView note={handoffWaiting.handoffNote} />
          <HandoffAnswerForm projectId={handoffWaiting.projectId} />
        </section>
      ) : null}

      {edits ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <MoveStageForm dealId={dealId} stages={stageOptions} currentStageId={query.lose === "1" ? (stageOptions.find((stage) => stage.category === "lost")?.id ?? deal.stageId) : deal.stageId} />
        </section>
      ) : null}
      {canReopenDeal(shell.viewer, facts) && projects.length === 0 ? (
        <section className="rounded-xl border p-4">
          <ReopenDealForm dealId={dealId} stages={stageOptions} />
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {deal.status === "won" || projects.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("deal.sections.delivery")}</h2>
              {projects.length === 0 ? <p className="text-sm text-muted-foreground">{t("deal.delivery.none")}</p> : null}
              <ul className="flex flex-col gap-2">
                {projects.map((project) => (
                  <li key={project.projectId} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{project.jobNumber ?? "—"}</span>
                      <Link href={`/projects/${project.projectId}`} className="font-medium hover:underline">
                        {project.projectName}
                      </Link>
                      <Badge dot variant={statusTone(project.handoffStatus)}>
                        {t(`enums.handoffStatus.${project.handoffStatus as "pending"}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{t("deal.handoff.to", { name: project.leadName ?? "—", date: f.when(project.createdAt) })}</span>
                    </p>
                    {project.handoffStatus === "returned" ? <p className="text-sm text-destructive">{t("deal.handoff.returnedBecause", { reason: project.handoffReturnReason ?? "—" })}</p> : null}
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("deal.handoff.note")}</summary>
                      <HandoffNoteView note={project.handoffNote} />
                    </details>
                    {project.handoffStatus === "returned" && setsUp ? <ResendHandoffForm dealId={dealId} projectId={project.projectId} /> : null}
                  </li>
                ))}
              </ul>
              {setsUp && teamsWithPeople.length ? (
                <details className="rounded-xl border p-4" open={projects.length === 0}>
                  <summary className="cursor-pointer text-sm font-medium">{t("deal.delivery.title")}</summary>
                  <div className="pt-3">
                    <DeliverySetupForm dealId={dealId} dealTitle={deal.title} teams={teamsWithPeople} defaultTeamId={deal.teamId} templates={templates.filter((template) => template.purpose === "work_project").map((template) => ({ id: template.id, name: template.name }))} contracts={contracts.map((contract) => ({ id: contract.id, name: `${contract.number} · ${contract.title}` }))} today={today} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          {quotesVisible ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("deal.sections.quotes")}</h2>
              {quotes.length === 0 ? <p className="text-sm text-muted-foreground">{t("deal.noQuotes")}</p> : null}
              <ul className="flex flex-col divide-y rounded-xl border">
                {quotes.map((quote) => (
                  <li key={quote.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Link href={`/crm/deals/${dealId}/quotes/${quote.id}`} className="font-medium hover:underline">
                      {quote.number} v{quote.version}
                    </Link>
                    <span>{quote.title}</span>
                    <Badge dot variant={statusTone(quote.status === "in_approval" ? "pending" : quote.status)}>
                      {t(`enums.quoteStatus.${quote.status as "draft"}`)}
                    </Badge>
                    <span className="ml-auto tabular-nums">{f.money(quote.totalVnd)}</span>
                  </li>
                ))}
              </ul>
              {edits ? <CrmButton action={createQuoteAction} input={{ dealId }} label={t("quote.create")} navigateTo={(data) => `/crm/deals/${dealId}/quotes/${(data as { id: string }).id}`} /> : null}
            </section>
          ) : null}

          {staffing ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("deal.staffing.title")}</h2>
              <div className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${staffing.shortMinutes > 0 ? "border-destructive/50" : ""}`}>
                <p>{t("deal.staffing.summary", { need: hours(staffing.needMinutes), quote: staffing.quoteNumber, free: hours(staffing.freeMinutes), people: staffing.people, weeks: staffing.weeks, from: f.date(staffing.from) })}</p>
                <p className="text-xs text-muted-foreground">
                  {staffing.needByRole.map((entry) => t("deal.staffing.role", { role: entry.role, hours: hours(entry.minutes) })).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {staffing.freeByPosition.map((entry) => t("deal.staffing.position", { position: entry.name ?? t("deal.staffing.noPosition"), hours: hours(entry.minutes), people: entry.people })).join(" · ")}
                </p>
                {staffing.shortMinutes > 0 ? (
                  <p className="flex flex-wrap items-center gap-2 text-destructive">
                    {t("deal.staffing.short", { hours: hours(staffing.shortMinutes) })}
                    {canFileHiringRequest(user.principal) ? (
                      <Link
                        className="underline"
                        href={`/recruit/hiring/new?${new URLSearchParams({
                          title: [...staffing.needByRole].sort((a, b) => b.minutes - a.minutes)[0]?.role ?? "",
                          start: staffing.from,
                          reason: t("deal.staffing.reason", { deal: `${deal.code} ${deal.title}`, need: hours(staffing.needMinutes), free: hours(staffing.freeMinutes), weeks: staffing.weeks, from: staffing.from }),
                        }).toString()}`}
                      >
                        {t("deal.staffing.hire")}
                      </Link>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("deal.staffing.fits")}</p>
                )}
              </div>
            </section>
          ) : null}

          {deal.pitchProjectId || allowsPitch ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("deal.sections.pitch")}</h2>
              {deal.pitchProjectId ? (
                <p className="text-sm">
                  <Link href={`/projects/${deal.pitchProjectId}`} className="underline">
                    {t("deal.pitch.openProject")}
                  </Link>{" "}
                  <span className="text-muted-foreground">{t("deal.pitch.costHint")}</span>
                </p>
              ) : edits && teamsWithPeople.length ? (
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">{t("deal.pitch.open")}</summary>
                  <div className="pt-3">
                    <PitchForm dealId={dealId} dealTitle={deal.title} teams={teamsWithPeople} defaultTeamId={deal.teamId} today={today} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("deal.sections.history")}</h2>
            <Timeline items={timeline} />
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {changes.map((change) => (
                <li key={change.id}>{t("deal.stageChange", { from: change.fromName ?? "—", to: change.toName, by: change.byName ?? "—", date: f.when(change.changedAt) })}</li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.activities")}</h2>
            <ActivityList items={activities.filter((activity) => !!activity.doneAt)} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.followUps")}</h2>
            <FollowUpList items={followUps} canEdit={(item) => canEditActivity(shell.viewer, item, account.facts)} people={people} meId={user.person.id} today={today} showTarget={false} />
            {canLogActivity(shell.viewer, account.facts) || edits ? (
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("activity.log")}</summary>
                <div className="pt-3">
                  <LogActivityForm target={{ clientId: account.client.id, dealId }} contacts={contactOptions} people={people} meId={user.person.id} today={today} />
                </div>
              </details>
            ) : null}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("deal.sections.contacts")}</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {dealContacts.map((contact) => (
                <li key={contact.contactId}>
                  {contact.fullName}
                  <span className="text-xs text-muted-foreground"> {[contact.title, contact.role].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
            {edits ? (
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm">{t("deal.editContacts")}</summary>
                <div className="pt-3">
                  <DealContactsForm dealId={dealId} contacts={contactOptions} chosen={dealContacts.map((contact) => ({ contactId: contact.contactId, role: contact.role }))} />
                </div>
              </details>
            ) : null}
          </section>
          {edits ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("deal.sections.details")}</h2>
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm">{t("deal.edit")}</summary>
                <div className="pt-3">
                  <EditDealForm dealId={dealId} deal={{ title: deal.title, brandId: deal.brandId, serviceLines: deal.serviceLines, oneOffVnd: deal.value?.oneOffVnd ?? null, monthlyVnd: deal.value?.monthlyVnd ?? null, months: deal.value?.months ?? null, probability: deal.probability, expectedCloseOn: deal.expectedCloseOn, teamId: deal.teamId, entityId: deal.entityId, source: deal.source, competitors: deal.competitors, nextStep: deal.nextStep }} brands={account.brands.map((brand) => ({ id: brand.id, name: brand.name }))} teams={activeTeams.map((team) => ({ id: team.id, name: team.name }))} entities={entityOptions} />
                </div>
              </details>
              {canReassignDeal(shell.viewer, facts) ? <ReassignDealForm dealId={dealId} current={deal.ownerPersonId} sellers={people} /> : null}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
