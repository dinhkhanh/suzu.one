import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { initialsOf } from "@/lib/text";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { decideBriefAction } from "@/modules/projects/actions";
import { awaitingAcceptance, briefEditable, briefProblems, briefSubmittable, type BriefStatus, getBriefRequest, listProjectBookings, listStatusUpdates, listStructure, loadStatusFacts, mondayOf, openBriefForApprover, openProject, PROJECT_KINDS, type ProjectKind } from "@/modules/projects/service";
import { AcceptanceWaitingList } from "@/modules/projects/ui/acceptance-waiting";
import { BriefView } from "@/modules/projects/ui/brief-view";
import { AccountManagerForm, BriefForm, PlanSettingsForm, SubmitBriefButton } from "@/modules/projects/ui/plan-forms";
import { burnTone, Meter } from "@/modules/projects/ui/progress";
import { healthVariant, ProjectHeader } from "@/modules/projects/ui/project-header";
import { listProjectMembers } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";
import { canViewDeal, contactChoicesFor, contractNumbersOfProjects, type DealStatus, dealOfProject, findAccount, loadCrm } from "@/modules/crm/service";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";

export const generateMetadata = pageTitle("project");

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);

/**
 * A project's overview: its properties, milestones and recent activity on the left; its progress,
 * what is due next and who is on it this week on the right; then the brief and its kick-off gate
 * (FR-PJM-03), what still waits for the client's signature, and the project's roles and settings
 * (FR-PJM-01, 14). An approver of the kick-off who may not open the project (the owners, for a
 * private project with no other lead) sees the brief and the request only.
 */
export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  const t = await getTranslations("projects");
  const format = await getFormatter();

  if (!context) {
    const approver = await openBriefForApprover(user, projectId);
    if (!approver) notFound();
    return (
      <Page width="narrow">
        <PageHeader eyebrow={approver.plan.jobNumber ? <span className="font-mono tabular-nums">{approver.plan.jobNumber}</span> : undefined} title={approver.projectName} description={t("kickoff.approverOnly")} />
        <BriefView brief={approver.plan.brief} />
        {approver.request.canDecide ? <DecisionForm requestId={approver.request.request.id} action={decideBriefAction} /> : null}
        <RequestTools view={approver.request} viewerPersonId={user.person.id} />
        <RequestHistory view={approver.request} />
      </Page>
    );
  }

  const { project, plan, can } = context;
  const today = todayInVietnam();
  const monday = mondayOf(today);
  const [request, updates, members, people, waiting, origin, contracts, account, structure, facts, bookings, entities] = await Promise.all([
    getBriefRequest({ personId: user.person.id, principal: user.principal }, plan),
    listStatusUpdates(project.id, 5),
    listProjectMembers(project.id),
    can.editPlan ? listPersonNames() : Promise.resolve([]),
    awaitingAcceptance(project.id),
    // Where the work came from (FR-CRM-46): the account, the won deal and the contract it is delivered under.
    dealOfProject(project.id),
    contractNumbersOfProjects([project.id]),
    project.clientId ? findAccount(project.clientId) : Promise.resolve(null),
    listStructure(project.id),
    loadStatusFacts(project.id, { budgetMinutes: plan.budgetMinutes, baseline: plan.baseline }, today),
    listProjectBookings(project.id, monday, monday),
    listEntities(),
  ]);
  // The deal is shown only to whoever may see it (`canViewDeal`): reading a project does not open its sale.
  const showsDeal = !!origin && !!account && canViewDeal((await loadCrm(user)).viewer, { id: origin.dealId, entityId: origin.entityId, ownerPersonId: origin.ownerPersonId, status: origin.status as DealStatus, account: account.facts });
  const status = plan.briefStatus as BriefStatus;
  const editable = can.editClientSide && briefEditable(status);
  // A brief naming nobody on the client's side starts from the account's contacts (FR-CRM-46).
  const accountContacts = editable && !plan.brief.clientContacts?.length ? await contactChoicesFor(project.clientId) : [];
  const problems = briefProblems(plan.brief, plan.kind as ProjectKind);
  const lastComment = request?.events.findLast((event) => event.type === "returned" || event.type === "rejected")?.comment ?? null;
  const leads = members.filter((member) => member.role === "lead");
  const accountManager = members.find((member) => member.role === "account_manager");
  const entityName = entities.find((entity) => entity.id === project.entityId)?.shortName ?? null;
  const contract = contracts.get(project.id) ?? null;

  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 });
  const money = (value: number) => format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const daysLeft = project.dueDate && !plan.closedAt ? daysBetween(today, project.dueDate) : null;
  const tasksTotal = facts.tasksDone + facts.tasksOpen;
  const percentOf = (part: number, whole: number | null) => (whole ? Math.floor((part / whole) * 100) : null);
  // The two lines of the register due next: open, dated, soonest first.
  const nextLines = structure.deliverables
    .filter((line) => !line.cancelledAt && line.dueDate && line.dueDate >= today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 2);
  const milestoneState = (milestone: (typeof structure.milestones)[number]) => (milestone.doneAt ? "done" : milestone.dueDate && milestone.dueDate < today ? "late" : "upcoming");

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("fields.client"),
      value: account ? (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/crm/accounts/${account.client.id}`} className="font-medium hover:underline">
            {account.client.name}
          </Link>
          {account.profile?.creditHold ? <Badge variant="destructive">{t("crm.creditHold")}</Badge> : null}
        </span>
      ) : (
        <span className="text-muted-foreground">{t("portfolio.noClient")}</span>
      ),
    },
    {
      label: t("fields.lead"),
      value: leads.length ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {leads.map((lead) => (
            <span key={lead.personId} className="flex items-center gap-1.5">
              <PersonAvatar person={{ id: lead.personId, fullName: lead.fullName, photoFileId: null }} size="sm" />
              {lead.fullName}
            </span>
          ))}
        </span>
      ) : (
        "—"
      ),
    },
    { label: t("fields.accountManager"), value: accountManager?.fullName ?? <span className="text-muted-foreground">{t("settings.noAccountManager")}</span> },
    {
      label: t("overview.people"),
      value: members.length ? (
        <span className="flex items-center gap-2">
          <AvatarGroup>
            {members.slice(0, 5).map((member) => (
              <Avatar key={member.personId} size="sm" title={member.fullName}>
                <AvatarFallback>{initialsOf(member.fullName)}</AvatarFallback>
              </Avatar>
            ))}
            {members.length > 5 ? <AvatarGroupCount>+{members.length - 5}</AvatarGroupCount> : null}
          </AvatarGroup>
          <span className="font-mono text-xs text-faint tabular-nums">{t("overview.peopleCount", { count: members.length })}</span>
        </span>
      ) : (
        "—"
      ),
    },
    {
      label: t("overview.dates"),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.8125rem] tabular-nums">
            {date(project.startDate)} → {date(project.dueDate)}
          </span>
          {daysLeft !== null ? <span className={`text-xs ${daysLeft < 0 ? "text-destructive" : daysLeft <= 7 ? "text-warning" : "text-faint"}`}>{daysLeft < 0 ? t("overview.daysOver", { count: -daysLeft }) : daysLeft === 0 ? t("overview.dueToday") : t("overview.daysLeft", { count: daysLeft })}</span> : null}
        </span>
      ),
    },
    ...(can.seeFees ? [{ label: t("fields.feeVnd"), value: <span className="font-mono text-[0.8125rem] tabular-nums">{plan.feeVnd === null || plan.feeVnd === undefined ? "—" : money(plan.feeVnd)}</span> }] : []),
    ...(entityName ? [{ label: t("fields.entity"), value: entityName }] : []),
    ...(contract || (origin && showsDeal)
      ? [
          {
            label: t("overview.origin"),
            value: (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {origin && showsDeal ? (
                  <Link href={`/crm/deals/${origin.dealId}`} className="hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{origin.code}</span> {origin.title} <span className="text-xs text-faint">({t(`crm.handoff.${origin.handoffStatus as "pending"}`)})</span>
                  </Link>
                ) : null}
                {contract ? <span className="text-muted-foreground">{t("crm.contract", { number: contract })}</span> : null}
              </span>
            ),
          },
        ]
      : []),
    ...(plan.driveUrl
      ? [
          {
            label: t("fields.driveUrl"),
            value: (
              <a href={plan.driveUrl} target="_blank" rel="noreferrer" className="block truncate text-link hover:underline">
                {plan.driveUrl}
              </a>
            ),
          },
        ]
      : []),
  ];

  return (
    <Page>
      <ProjectHeader context={context} current="overview" />

      <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-8">
        <div className="flex min-w-0 flex-col gap-6 md:gap-8">
          <Section title={t("overview.properties")}>
            <dl className="flex flex-col">
              {rows.map((row) => (
                <div key={row.label} className="flex min-h-8 items-center gap-3 text-sm">
                  <dt className="w-[120px] shrink-0 text-[0.8125rem] text-faint">{row.label}</dt>
                  <dd className="min-w-0 flex-1 py-1">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section
            title={t("plan.milestones")}
            count={structure.milestones.length || undefined}
            action={<Link href={`/projects/${project.id}/plan`}>{t("overview.allPlan")}</Link>}
          >
            <List>
              {structure.milestones.length === 0 ? <ListEmpty>{t("plan.noMilestones")}</ListEmpty> : null}
              {structure.milestones.map((milestone) => {
                const state = milestoneState(milestone);
                return (
                  <ListItem key={milestone.id} className="gap-3">
                    <span aria-hidden className={`size-2 shrink-0 rounded-full ${state === "done" ? "bg-success" : state === "late" ? "bg-destructive" : "bg-faint/50"}`} />
                    <span className={`min-w-0 flex-1 truncate ${state === "done" ? "text-muted-foreground" : "font-medium"}`}>{milestone.name}</span>
                    {state === "done" ? <Badge variant="success">{t("plan.done")}</Badge> : state === "late" ? <Badge variant="destructive">{t("plan.late")}</Badge> : milestone.isClientFacing ? <Badge variant="outline">{t("fields.isClientFacing")}</Badge> : null}
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{milestone.dueDate ? date(milestone.dueDate) : "—"}</span>
                  </ListItem>
                );
              })}
            </List>
          </Section>

          <Section title={t("overview.activity")} action={<Link href={`/projects/${project.id}/updates`}>{t("updates.all")}</Link>}>
            <List>
              {updates.length === 0 ? <ListEmpty>{t("updates.none")}</ListEmpty> : null}
              {updates.map((update) => (
                <ListItem key={update.id} className="items-start gap-3 py-3">
                  <Badge variant={healthVariant(update.health)} className="mt-0.5">
                    {t(`health.${update.health as "on_track"}`)}
                  </Badge>
                  <span className="min-w-0 flex-1 text-sm">{noteToPlainText(update.summary)}</span>
                  <span className="shrink-0 font-mono text-xs text-faint tabular-nums">{format.dateTime(update.createdAt, { day: "2-digit", month: "2-digit" })}</span>
                </ListItem>
              ))}
            </List>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("overview.progress")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Meter label={t("facts.tasks")} figure={`${facts.tasksDone}/${tasksTotal}`} percent={percentOf(facts.tasksDone, tasksTotal)} hint={facts.overdue || facts.blocked ? t("overview.tasksHint", { overdue: facts.overdue, blocked: facts.blocked }) : undefined} />
              <Meter label={t("facts.hours")} figure={facts.budgetMinutes ? t("facts.hoursOfBudget", { used: hours(facts.minutesLogged), budget: hours(facts.budgetMinutes) }) : hours(facts.minutesLogged)} percent={percentOf(facts.minutesLogged, facts.budgetMinutes)} tone={burnTone(percentOf(facts.minutesLogged, facts.budgetMinutes))} hint={facts.budgetMinutes ? undefined : t("budget.noBudget")} />
              <Meter label={t("facts.deliverables")} figure={`${facts.deliverablesAccepted}/${facts.deliverablesPromised}`} percent={percentOf(facts.deliverablesAccepted, facts.deliverablesPromised)} tone="success" hint={facts.deliverablesPromised ? undefined : t("register.empty")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("overview.nextDeliverables")}</CardTitle>
            </CardHeader>
            <CardContent>
              {nextLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("overview.noNextDeliverables")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {nextLines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3 text-sm">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{date(line.dueDate)}</span>
                      <Link href={`/projects/${project.id}/deliverables`} className="min-w-0 flex-1 truncate hover:underline">
                        {line.quantity} × {line.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("overview.thisWeek")}</CardTitle>
            </CardHeader>
            <CardContent>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("overview.nobodyThisWeek")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {bookings.map((booking) => (
                    <li key={booking.id} className="flex items-center gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate">{booking.personName ?? <span className="italic text-muted-foreground">{t("bookings.placeholder", { role: booking.placeholderRole ?? "" })}</span>}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {t("bookings.hoursShort", { hours: hours(booking.minutes) })}
                        {booking.status === "tentative" ? <span className="text-faint">?</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="pt-2 text-xs">
                <Link href={`/projects/${project.id}/team`} className="text-link hover:underline">
                  {t("overview.allTeam")}
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Section title={t("kickoff.title")}>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{status === "approved" ? t("kickoff.approvedNote", { date: plan.briefApprovedAt ? format.dateTime(plan.briefApprovedAt, { dateStyle: "medium" }) : "—" }) : project.status === "planned" ? t("kickoff.gateNote") : t("kickoff.notApprovedNote")}</p>
            <div className="flex items-center gap-2">
              {request ? <RequestStatusBadge status={request.request.status} /> : null}
              <Badge dot variant={statusTone(status)}>{t(`brief.status.${status}`)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {status === "returned" && lastComment ? <Alert variant="warning">{t("kickoff.returnedWith", { comment: lastComment })}</Alert> : null}

            {editable ? <BriefForm projectId={project.id} brief={plan.brief} kind={plan.kind} accountContacts={accountContacts} /> : <BriefView brief={plan.brief} />}

            {editable && briefSubmittable(status) ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                {problems.length ? <p className="text-sm text-muted-foreground">{t("kickoff.missing", { fields: problems.map((field) => t(`brief.fields.${field}`)).join(", ") })}</p> : <p className="text-sm text-muted-foreground">{t("kickoff.ready")}</p>}
                <div>
                  <SubmitBriefButton projectId={project.id} resubmit={status === "returned" && !!plan.briefApprovalRequestId} />
                </div>
              </div>
            ) : null}

            {request?.canDecide ? <DecisionForm requestId={request.request.id} action={decideBriefAction} /> : null}
            {request ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("kickoff.history")}</summary>
                <div className="flex flex-col gap-4 pt-3">
                  <RequestTools view={request} viewerPersonId={user.person.id} />
                  <RequestHistory view={request} />
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </Section>

      <AcceptanceWaitingList projectId={project.id} waiting={waiting} />

      {can.editPlan ? (
        <Section title={t("settings.title")}>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <AccountManagerForm projectId={project.id} current={accountManager?.personId ?? null} people={people} />
              <PlanSettingsForm projectId={project.id} values={{ kind: plan.kind, budgetMinutes: plan.budgetMinutes, budgetByRole: plan.budgetByRole, updateCadenceDays: plan.updateCadenceDays, driveUrl: plan.driveUrl }} kinds={PROJECT_KINDS} />
            </CardContent>
          </Card>
        </Section>
      ) : null}
    </Page>
  );
}
