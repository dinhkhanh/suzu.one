import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader } from "@/components/ui/page";
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
    <Page width="wide">
      <PageHeader eyebrow={<><Link href="/crm/accounts" className="underline">
            {t("accounts.title")}
          </Link></>} title={<span className="inline-flex flex-wrap items-center gap-2">{account.client.name}
          <span className="font-mono text-sm text-muted-foreground">{account.client.code}</span>
          <Badge dot variant={statusTone(lifecycle === "churned" ? "closed" : lifecycle === "dormant" ? "pending" : lifecycle)}>
            {t(`enums.lifecycle.${lifecycle}`)}
          </Badge>
          {profile?.tier ? <Badge variant="outline">{t(`enums.tier.${profile.tier as "a"}`)}</Badge> : null}
          {profile?.creditHold ? <Badge variant="destructive">{t("account.creditHold")}</Badge> : null}</span>}>
        <p className="text-sm text-muted-foreground">
          {[profile?.legalName, profile?.taxCode ? t("account.taxCodeIs", { code: profile.taxCode }) : null, profile?.industry].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm">
          {t.rich("account.managerIs", { name: page.managerName ?? "—", person: (chunks) => <RecordLink kind="person" id={account.client.accountManagerPersonId}>{chunks}</RecordLink> })} ·{" "}
          {t.rich("account.salesOwnerIs", { name: page.salesOwnerName ?? "—", person: (chunks) => <RecordLink kind="person" id={profile?.salesOwnerPersonId}>{chunks}</RecordLink> })}
          {brands.length ? ` · ${t("account.brands", { names: brands.map((brand) => brand.name).join(", ") })}` : ""}
        </p>
        {profile?.creditHold && profile.creditHoldReason ? <p className="text-sm text-destructive">{profile.creditHoldReason}</p> : null}
      </PageHeader>
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
            <TableCard>
              <TableCardHeader title={t("account.sections.projects")} count={page.projects.length || null} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="id">{tProjects("fields.jobNumber")}</TableHead>
                    <TableHead kind="text">{tProjects("fields.name")}</TableHead>
                    <TableHead kind="select">{tProjects("fields.kind")}</TableHead>
                    <TableHead kind="status">{tProjects("fields.health")}</TableHead>
                    <TableHead kind="person">{tProjects("fields.lead")}</TableHead>
                    <TableHead kind="select">{tProjects("fields.phase")}</TableHead>
                    <TableHead kind="date">{tProjects("fields.nextMilestone")}</TableHead>
                    <TableHead kind="number">{tProjects("fields.accepted")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.projects.length === 0 ? <TableEmpty>{t("account.noProjects")}</TableEmpty> : null}
                  {page.projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell kind="id">{project.jobNumber ?? "—"}</TableCell>
                      <TableCell>
                        <RecordLink kind="project" id={project.id} className="font-medium">
                          {project.name}
                        </RecordLink>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{tProjects(`kinds.${project.kind as "client"}`)}</Badge>
                      </TableCell>
                      <TableCell>{project.health ? <Badge dot variant={project.health === "on_track" ? "success" : project.health === "at_risk" ? "warning" : "destructive"}>{tProjects(`health.${project.health as "on_track"}`)}</Badge> : "—"}</TableCell>
                      <TableCell>{project.leadName ? <RecordLink kind="person" id={project.leadPersonId}>{project.leadName}</RecordLink> : "—"}</TableCell>
                      <TableCell>{project.phaseName ?? "—"}</TableCell>
                      <TableCell>{project.nextMilestone ? `${project.nextMilestone.name} · ${f.date(project.nextMilestone.dueDate)}` : "—"}</TableCell>
                      <TableCell kind="number">{t("account.registerProgress", { accepted: project.register.accepted, promised: project.register.promised })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
            {page.retainers.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {page.retainers.map((row) => (
                  <li key={`${row.projectId}-${row.month}`} className="flex flex-wrap gap-2">
                    <RecordLink kind="project" id={row.projectId}>{row.projectName}</RecordLink>
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

          <TableCard>
            <TableCardHeader title={t("account.sections.deals")} count={deals.length || null} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="id">{t("account.fields.code")}</TableHead>
                  <TableHead kind="text">{t("deals.columns.deal")}</TableHead>
                  <TableHead kind="status">{t("deals.columns.stage")}</TableHead>
                  <TableHead kind="person">{t("deals.columns.owner")}</TableHead>
                  <TableHead kind="money">{t("deals.columns.value")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.length === 0 ? <TableEmpty>{t("account.noDeals")}</TableEmpty> : null}
                {deals.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell kind="id">{deal.code}</TableCell>
                    <TableCell>
                      <RecordLink kind="deal" id={deal.id} className="font-medium">
                        {deal.title}
                      </RecordLink>
                    </TableCell>
                    <TableCell>
                      <Badge dot variant={deal.status === "won" ? "success" : deal.status === "lost" ? "secondary" : "info"}>
                        {stageName(deal.stage, locale)}
                      </Badge>
                    </TableCell>
                    <TableCell>{deal.ownerName ? <RecordLink kind="person" id={deal.ownerPersonId}>{deal.ownerName}</RecordLink> : "—"}</TableCell>
                    <TableCell kind="money">{deal.value ? f.money(deal.value.totalVnd) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {can.createDeal ? (
              <TableAddRow label={t("deals.new")}>
                <NewDealForm clientId={account.client.id} brands={brands} teams={teams.filter((team) => team.isActive).map((team) => ({ id: team.id, name: team.name }))} entities={entityOptions} contacts={contactOptions} stages={stages.filter((stage) => stage.isActive).map((stage) => ({ id: stage.id, name: stageName(stage, locale), category: stage.category }))} sellers={people} meId={user.person.id} />
              </TableAddRow>
            ) : null}
          </TableCard>

          {can.work ? (
            <TableCard>
              <TableCardHeader title={t("account.sections.contracts")} count={contracts.length || null} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="id">{t("contracts.columns.number")}</TableHead>
                    <TableHead kind="text">{t("contract.fields.title")}</TableHead>
                    <TableHead kind="status">{t("contracts.columns.state")}</TableHead>
                    <TableHead kind="date">{t("contracts.columns.period")}</TableHead>
                    {can.seeMoney ? <TableHead kind="money">{t("contracts.columns.value")}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.length === 0 ? <TableEmpty>{t("account.noContracts")}</TableEmpty> : null}
                  {contracts.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell kind="id">
                        <RecordLink kind="contract" id={contract.id} className="font-medium text-foreground">
                          {contract.number}
                        </RecordLink>
                      </TableCell>
                      <TableCell>{contract.title}</TableCell>
                      <TableCell>
                        <Badge dot variant={statusTone(contract.state === "upcoming" ? "scheduled" : contract.state)}>
                          {t(`enums.contractState.${contract.state}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {f.date(contract.startDate)} – {f.date(contract.endDate)}
                      </TableCell>
                      {can.seeMoney ? <TableCell kind="money">{"valueVnd" in contract && contract.valueVnd !== null ? f.money(contract.valueVnd) : "—"}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {can.editContracts ? (
                <TableAddRow label={t("contract.new")}>
                  <ContractForm clientId={account.client.id} entities={entityOptions} parents={contracts.filter((contract) => contract.kind !== "appendix").map((contract) => ({ id: contract.id, name: `${contract.number} · ${contract.title}` }))} deals={deals.map((deal) => ({ id: deal.id, name: `${deal.code} · ${deal.title}` }))} seesValue={can.seeMoney} />
                </TableAddRow>
              ) : null}
            </TableCard>
          ) : null}

          {can.seeReceivables && invoices.length ? (
            <TableCard>
              <TableCardHeader title={t("account.sections.invoices")} count={invoices.length} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="id">{t("invoices.columns.number")}</TableHead>
                    <TableHead kind="date">{t("invoices.columns.issued")}</TableHead>
                    <TableHead kind="status">{t("invoices.columns.standing")}</TableHead>
                    <TableHead kind="money">{t("invoices.columns.total")}</TableHead>
                    <TableHead kind="money">{t("invoices.columns.outstanding")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell kind="id">
                        <RecordLink kind="invoice" id={invoice.id} className="font-medium text-foreground">
                          {invoice.number}
                        </RecordLink>
                      </TableCell>
                      <TableCell>{f.date(invoice.issuedOn)}</TableCell>
                      <TableCell>
                        <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
                          {t(`enums.invoiceStanding.${invoice.standing}`)}
                        </Badge>
                      </TableCell>
                      <TableCell kind="money">{f.money(invoice.totalVnd)}</TableCell>
                      <TableCell kind="money">{invoice.outstandingVnd > 0 ? f.money(invoice.outstandingVnd) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
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

          <TableCard>
            <TableCardHeader title={t("account.sections.contacts")} count={page.contacts.length || null} />
            <List>
              {page.contacts.length === 0 ? <ListEmpty>{t("contacts.empty")}</ListEmpty> : null}
              {page.contacts.map((contact) => (
                <ListItem key={contact.id} className="block">
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
                </ListItem>
              ))}
            </List>
            {can.editContacts ? (
              <TableAddRow label={t("contacts.add")}>
                <ContactForm clientId={account.client.id} brands={brands} />
              </TableAddRow>
            ) : null}
          </TableCard>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("account.sections.team")}</h2>
            <List>
              {page.team.map((member) => (
                <ListItem key={member.personId} className="flex-wrap gap-2">
                  <RecordLink kind="person" id={member.personId}>{member.fullName}</RecordLink>
                  <span className="text-xs text-muted-foreground">{member.ties.map((tie) => t(`enums.tie.${tie as "member"}`)).join(", ")}</span>
                  {can.manageTeam && member.ties.includes("member") ? <RemoveMemberButton clientId={account.client.id} personId={member.personId} /> : null}
                </ListItem>
              ))}
            </List>
            {can.manageTeam ? (
              <div className="flex flex-col gap-3 rounded-xl border p-3">
                <SalesOwnerForm clientId={account.client.id} current={profile?.salesOwnerPersonId ?? null} people={people} />
                <AddMemberForm clientId={account.client.id} people={people.filter((person) => !page.team.some((member) => member.personId === person.id))} />
              </div>
            ) : null}
            {leftBehind.map(([personId, work]) => (
              <div key={personId} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 p-2 text-sm">
                <span>{t.rich("account.leftBehind", { name: nameOf(personId) ?? "—", deals: work.deals, followUps: work.followUps, person: (chunks) => <RecordLink kind="person" id={personId}>{chunks}</RecordLink> })}</span>
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
                      <p className="text-xs text-muted-foreground">{t.rich("account.handedOver", { from: handoff.fromName ?? "—", to: handoff.toName ?? "—", date: f.when(handoff.createdAt), giver: (chunks) => <RecordLink kind="person" id={handoff.fromPersonId}>{chunks}</RecordLink>, taker: (chunks) => <RecordLink kind="person" id={handoff.toPersonId}>{chunks}</RecordLink> })}</p>
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
    </Page>
  );
}
