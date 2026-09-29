import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { canChangeAccountManager, listAccountHandoffs, listTeams } from "@/modules/work/service";
import { AccountHandoverForm } from "@/modules/work/ui/exit-handover";
import { HandoffNoteView } from "@/modules/work/ui/handoff";
import { accountWorkOf, canEditActivity, canViewAccount, findAccount, getAccountPage, type Lifecycle, listContracts, listDeals, listInvoices, listStages, stageName } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { AddMemberForm, ContactForm, EraseContactForm, LifecycleForm, MoveAccountWorkButton, ProfileForm, RemoveMemberButton, SalesOwnerForm, TermsForm } from "@/modules/crm/ui/account-forms";
import { LogActivityForm } from "@/modules/crm/ui/activity-forms";
import { NewDealForm } from "@/modules/crm/ui/deal-forms";
import { ContractForm } from "@/modules/crm/ui/money-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { FollowUpList, formatters, Timeline } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmAccount");

export default async function AccountPage({ params }: PageProps<"/crm/accounts/[clientId]">) {
  const user = await requireUser();
  const { clientId } = await params;
  const shell = await crmShell(user);
  const account = await findAccount(clientId);
  if (!account || !canViewAccount(shell.viewer, account.facts)) notFound();
  // A brand opens its client's account.
  if (account.client.id !== clientId) redirect(`/crm/accounts/${account.client.id}`);
  const today = todayInVietnam();
  const page = await getAccountPage(shell.viewer, shell.work, account, today);
  const { can } = page;
  const [t, tProjects, f, people, entities, teams, stages, deals, contracts, invoices, handoffs] = await Promise.all([
    getTranslations("crm"),
    getTranslations("projects"),
    formatters(),
    listPersonNames(),
    listEntities(),
    listTeams(),
    listStages(),
    listDeals(shell.viewer, { clientId: account.client.id, status: "all" }),
    can.work ? listContracts([account.client.id], () => can.seeMoney, today) : Promise.resolve([]),
    can.seeReceivables ? listInvoices(shell.viewer, { clientId: account.client.id, status: "all" }, today) : Promise.resolve([]),
    canChangeAccountManager(shell.work, account.client) ? listAccountHandoffs([account.client.id]) : Promise.resolve(null),
  ]);
  const locale = await getLocale();
  // Previous account managers who still hold open deals or follow-ups here (FR-CRM-42).
  const previousManagers = [...new Set((handoffs?.get(account.client.id) ?? []).map((handoff) => handoff.fromPersonId).filter((id): id is string => !!id && id !== account.client.accountManagerPersonId))];
  const leftBehind = can.manageTeam && previousManagers.length ? [...(await accountWorkOf(account.client.id, previousManagers))].filter(([, work]) => work.deals + work.followUps > 0) : [];
  const entityOptions = entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const brands = account.brands.map((brand) => ({ id: brand.id, name: brand.name }));
  const contactOptions = page.contacts.filter((contact) => contact.status === "active").map((contact) => ({ id: contact.id, name: contact.title ? `${contact.fullName} — ${contact.title}` : contact.fullName }));
  const profile = account.profile;
  const lifecycle = (profile?.lifecycle ?? "prospect") as Lifecycle;
  const nameOf = (personId: string | null) => (personId ? (people.find((person) => person.id === personId)?.fullName ?? null) : null);
  const signal = (label: string, value: string, tone?: string) => (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-medium tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/crm/accounts" className="underline">
            {t("accounts.title")}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {account.client.name}
          <span className="font-mono text-sm text-muted-foreground">{account.client.code}</span>
          <Badge dot variant={statusTone(lifecycle === "churned" ? "closed" : lifecycle === "dormant" ? "pending" : lifecycle)}>
            {t(`enums.lifecycle.${lifecycle}`)}
          </Badge>
          {profile?.tier ? <Badge variant="outline">{t(`enums.tier.${profile.tier as "a"}`)}</Badge> : null}
          {profile?.creditHold ? <Badge variant="destructive">{t("account.creditHold")}</Badge> : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[profile?.legalName, profile?.taxCode ? t("account.taxCodeIs", { code: profile.taxCode }) : null, profile?.industry].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm">
          {t("account.managerIs", { name: page.managerName ?? "—" })} · {t("account.salesOwnerIs", { name: page.salesOwnerName ?? "—" })}
          {brands.length ? ` · ${t("account.brands", { names: brands.map((brand) => brand.name).join(", ") })}` : ""}
        </p>
        {profile?.creditHold && profile.creditHoldReason ? <p className="text-sm text-destructive">{profile.creditHoldReason}</p> : null}
      </header>
      <CrmTabs current="accounts" show={shell.show} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {signal(t("account.signals.openProjects"), String(page.signals.openProjects))}
        {signal(t("account.signals.openDeals"), String(page.signals.openDeals))}
        {can.seeMoney ? signal(t("account.signals.pipeline"), f.money(page.signals.weightedVnd)) : null}
        {can.seeMoney ? signal(t("account.signals.won12m"), f.money(page.signals.wonVnd12m)) : null}
        {can.seeReceivables ? signal(t("account.signals.receivable"), f.money(page.signals.receivableVnd)) : null}
        {can.seeReceivables ? signal(t("account.signals.overdue"), f.money(page.signals.overdueVnd), page.signals.overdueVnd > 0 ? "text-destructive" : "") : null}
        {signal(t("account.signals.hours"), f.hours(page.hours.reduce((sum, month) => sum + month.minutes, 0)))}
        {signal(t("account.signals.clientRounds"), String(page.decisions.changesRequired))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.projects")}</h2>
            {page.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.noProjects")}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {page.projects.map((project) => (
                  <li key={project.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{project.jobNumber ?? "—"}</span>
                    <Link href={`/projects/${project.id}`} className="font-medium hover:underline">
                      {project.name}
                    </Link>
                    <Badge variant="outline">{tProjects(`kinds.${project.kind as "client"}`)}</Badge>
                    {project.health ? <Badge dot variant={project.health === "on_track" ? "success" : project.health === "at_risk" ? "warning" : "destructive"}>{tProjects(`health.${project.health as "on_track"}`)}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{[project.leadName, project.phaseName, project.nextMilestone ? `${project.nextMilestone.name} ${f.date(project.nextMilestone.dueDate)}` : null].filter(Boolean).join(" · ")}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{t("account.registerProgress", { accepted: project.register.accepted, promised: project.register.promised })}</span>
                  </li>
                ))}
              </ul>
            )}
            {page.retainers.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {page.retainers.map((row) => (
                  <li key={`${row.projectId}-${row.month}`} className="flex flex-wrap gap-2">
                    <span>{row.projectName}</span>
                    <span className="text-muted-foreground">{t("account.retainerMonth", { month: row.month, delivered: row.delivered, contracted: row.contracted, hours: f.hours(row.minutesLogged) })}</span>
                    {row.contracted > 0 && row.delivered > row.contracted ? <Badge variant="warning">{t("account.overservicing")}</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("account.workFacts", { approved: page.decisions.approved, withChanges: page.decisions.approvedWithChanges, changes: page.decisions.changesRequired, ready: page.billing.ready })}
              {page.billing.readyVnd !== null ? ` · ${t("account.billingReady", { amount: f.money(page.billing.readyVnd) })}` : ""}
            </p>
            {page.hours.length ? (
              <p className="text-xs text-muted-foreground">
                {t("account.hoursByMonth")}: {page.hours.map((month) => `${month.month} ${f.hours(month.minutes)}h (${month.people})`).join(" · ")}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.deals")}</h2>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.noDeals")}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {deals.map((deal) => (
                  <li key={deal.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{deal.code}</span>
                    <Link href={`/crm/deals/${deal.id}`} className="font-medium hover:underline">
                      {deal.title}
                    </Link>
                    <Badge dot variant={deal.status === "won" ? "success" : deal.status === "lost" ? "secondary" : "info"}>
                      {stageName(deal.stage, locale)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{deal.ownerName}</span>
                    {deal.value ? <span className="ml-auto tabular-nums">{f.money(deal.value.totalVnd)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {can.createDeal ? (
              <details className="rounded-xl border p-4">
                <summary className="cursor-pointer text-sm font-medium">{t("deals.new")}</summary>
                <div className="pt-3">
                  <NewDealForm clientId={account.client.id} brands={brands} teams={teams.filter((team) => team.isActive).map((team) => ({ id: team.id, name: team.name }))} entities={entityOptions} contacts={contactOptions} stages={stages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stageName(stage, locale), category: stage.category }))} sellers={people} meId={user.person.id} />
                </div>
              </details>
            ) : null}
          </section>

          {can.work ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("account.sections.contracts")}</h2>
              {contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("account.noContracts")}</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-xl border">
                  {contracts.map((contract) => (
                    <li key={contract.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <Link href={`/crm/contracts/${contract.id}`} className="font-medium hover:underline">
                        {contract.number}
                      </Link>
                      <span>{contract.title}</span>
                      <Badge dot variant={statusTone(contract.state === "upcoming" ? "scheduled" : contract.state)}>
                        {t(`enums.contractState.${contract.state}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {f.date(contract.startDate)} – {f.date(contract.endDate)}
                      </span>
                      {"valueVnd" in contract && contract.valueVnd !== null ? <span className="ml-auto tabular-nums">{f.money(contract.valueVnd)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {can.editContracts ? (
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">{t("contract.new")}</summary>
                  <div className="pt-3">
                    <ContractForm clientId={account.client.id} entities={entityOptions} parents={contracts.filter((contract) => contract.kind !== "appendix").map((contract) => ({ id: contract.id, name: `${contract.number} · ${contract.title}` }))} deals={deals.map((deal) => ({ id: deal.id, name: `${deal.code} · ${deal.title}` }))} seesValue={can.seeMoney} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          {can.seeReceivables && invoices.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("account.sections.invoices")}</h2>
              <ul className="flex flex-col divide-y rounded-xl border">
                {invoices.map((invoice) => (
                  <li key={invoice.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Link href={`/crm/invoices/${invoice.id}`} className="font-medium hover:underline">
                      {invoice.number}
                    </Link>
                    <span className="text-xs text-muted-foreground">{f.date(invoice.issuedOn)}</span>
                    <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
                      {t(`enums.invoiceStanding.${invoice.standing}`)}
                    </Badge>
                    <span className="ml-auto tabular-nums">{f.money(invoice.totalVnd)}</span>
                    {invoice.outstandingVnd > 0 ? <span className="text-xs text-muted-foreground">{t("invoice.outstandingIs", { amount: f.money(invoice.outstandingVnd) })}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.timeline")}</h2>
            <Timeline items={page.timeline} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {can.work ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("account.sections.followUps")}</h2>
              <FollowUpList items={page.followUps} canEdit={(item) => canEditActivity(shell.viewer, item, account.facts)} people={people} meId={user.person.id} today={today} showTarget={false} />
              {can.logActivity ? (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("activity.log")}</summary>
                  <div className="pt-3">
                    <LogActivityForm target={{ clientId: account.client.id }} contacts={contactOptions} people={people} meId={user.person.id} today={today} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.contacts")}</h2>
            {page.contacts.length === 0 ? <p className="text-sm text-muted-foreground">{t("contacts.empty")}</p> : null}
            <ul className="flex flex-col gap-2">
              {page.contacts.map((contact) => (
                <li key={contact.id} className="rounded-lg border p-3 text-sm">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{contact.fullName}</span>
                      {contact.isPrimary ? <Badge variant="info" className="ml-2">{t("contacts.primary")}</Badge> : null}
                      {contact.status === "left" ? <Badge variant="secondary" className="ml-2">{t("enums.contactStatus.left")}</Badge> : null}
                      <p className="text-xs text-muted-foreground">{[contact.title, contact.decisionRole ? t(`enums.decisionRole.${contact.decisionRole as "approver"}`) : null].filter(Boolean).join(" · ")}</p>
                      {contact.details ? <p className="text-xs">{[contact.details.email, contact.details.phone, contact.details.zalo ? `Zalo ${contact.details.zalo}` : null].filter(Boolean).join(" · ")}</p> : null}
                    </summary>
                    {contact.details && can.editContacts && !contact.details.erasedAt ? (
                      <div className="flex flex-col gap-3 pt-3">
                        <ContactForm clientId={account.client.id} contact={contact as never} brands={brands} />
                        {can.eraseContacts ? <EraseContactForm contactId={contact.id} /> : null}
                      </div>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
            {can.editContacts ? (
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("contacts.add")}</summary>
                <div className="pt-3">
                  <ContactForm clientId={account.client.id} brands={brands} />
                </div>
              </details>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.team")}</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {page.team.map((member) => (
                <li key={member.personId} className="flex flex-wrap items-center gap-2">
                  <span>{member.fullName}</span>
                  <span className="text-xs text-muted-foreground">{member.ties.map((tie) => t(`enums.tie.${tie as "member"}`)).join(", ")}</span>
                  {can.manageTeam && member.ties.includes("member") ? <RemoveMemberButton clientId={account.client.id} personId={member.personId} /> : null}
                </li>
              ))}
            </ul>
            {can.manageTeam ? (
              <div className="flex flex-col gap-3 rounded-xl border p-3">
                <SalesOwnerForm clientId={account.client.id} current={profile?.salesOwnerPersonId ?? null} people={people} />
                <AddMemberForm clientId={account.client.id} people={people.filter((person) => !page.team.some((member) => member.personId === person.id))} />
              </div>
            ) : null}
            {leftBehind.map(([personId, work]) => (
              <div key={personId} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 p-2 text-sm">
                <span>{t("account.leftBehind", { name: nameOf(personId) ?? "—", deals: work.deals, followUps: work.followUps })}</span>
                <MoveAccountWorkButton clientId={account.client.id} fromPersonId={personId} label={t("account.moveWork", { name: page.managerName ?? "—" })} />
              </div>
            ))}
            {handoffs ? (
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("account.changeManager")}</summary>
                <div className="flex flex-col gap-3 pt-3">
                  <AccountHandoverForm clientId={account.client.id} currentName={nameOf(account.client.accountManagerPersonId)} people={people.filter((person) => person.id !== account.client.accountManagerPersonId)} />
                  {(handoffs.get(account.client.id) ?? []).map((handoff) => (
                    <div key={handoff.id} className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2">
                      <p className="text-xs text-muted-foreground">{t("account.handedOver", { from: handoff.fromName ?? "—", to: handoff.toName ?? "—", date: f.when(handoff.createdAt) })}</p>
                      <HandoffNoteView note={handoff.note} />
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          {can.editAccount || can.editTerms ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{t("account.sections.profile")}</h2>
              {can.editAccount ? (
                <>
                  <LifecycleForm clientId={account.client.id} lifecycle={lifecycle} manual={profile?.lifecycleManual ?? false} />
                  <details className="rounded-xl border p-3">
                    <summary className="cursor-pointer text-sm">{t("account.editProfile")}</summary>
                    <div className="pt-3">
                      <ProfileForm clientId={account.client.id} profile={profile} entities={entityOptions} />
                    </div>
                  </details>
                </>
              ) : null}
              {can.editTerms ? (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm">{t("account.editTerms")}</summary>
                  <div className="pt-3">
                    <TermsForm clientId={account.client.id} terms={{ paymentTermsDays: profile?.paymentTermsDays ?? null, creditHold: profile?.creditHold ?? false, creditHoldReason: profile?.creditHoldReason ?? null, creditLimitVnd: profile?.creditLimitVnd ?? null }} />
                  </div>
                </details>
              ) : (
                <p className="text-xs text-muted-foreground">{t("account.termsAre", { days: profile?.paymentTermsDays ?? "—" })}</p>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
