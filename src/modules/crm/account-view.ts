// Account 360 (FR-CRM-04): one page per account that reads the account from every module that
// knows something about it — the CRM's own profile, contacts, follow-ups and pipeline; PJM's
// projects, retainers, client decisions and billing; the time logged on its work — each through
// the rule of the screen it comes from. Nothing is copied: a figure here is the figure there.
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { listPersonNames } from "../platform/people/service";
import { listPortfolio, type PortfolioRow, type RetainerConsumption, retainerConsumption } from "@/modules/projects/service";
import { canViewProject, projectFacts, projectsWithTeams, type WorkViewer, workDirectory } from "@/modules/work/service";
import { type AccountRef, type AccountSignals, accountSignals, listAccountTeam, type TeamMemberView } from "./accounts";
import { type ActivityView, listActivities, listOpenFollowUps } from "./activities";
import { type ContactView, listContacts } from "./contacts";
import {
  canCreateDeal,
  canEditAccount,
  canEditCommercialTerms,
  canEditContacts,
  canEditContracts,
  canEraseContact,
  canLogActivity,
  canManageAccountTeam,
  canSeeAccountMoney,
  canSeeReceivables,
  canWorkAccount,
  type CrmViewer,
} from "./policy";
import { accountTimeline, clientDecisionCounts, hoursByMonth, type TimelineItem } from "./timeline";

export type AccountAbilities = {
  work: boolean;
  editContacts: boolean;
  logActivity: boolean;
  editAccount: boolean;
  manageTeam: boolean;
  editTerms: boolean;
  seeMoney: boolean;
  seeReceivables: boolean;
  eraseContacts: boolean;
  createDeal: boolean;
  editContracts: boolean;
};

export function accountAbilities(viewer: CrmViewer, account: AccountRef): AccountAbilities {
  const facts = account.facts;
  return {
    work: canWorkAccount(viewer, facts),
    editContacts: canEditContacts(viewer, facts),
    logActivity: canLogActivity(viewer, facts),
    editAccount: canEditAccount(viewer, facts),
    manageTeam: canManageAccountTeam(viewer, facts),
    editTerms: canEditCommercialTerms(viewer, facts),
    seeMoney: canSeeAccountMoney(viewer, facts),
    seeReceivables: canSeeReceivables(viewer, facts),
    eraseContacts: canEraseContact(viewer, facts),
    createDeal: canCreateDeal(viewer, facts, account.profile?.contractingEntityId ?? account.client.entityId),
    editContracts: canEditContracts(viewer, facts),
  };
}

/** The account's projects (its own and its brands') that this reader may open — ids only, from the cached directory. */
export async function visibleAccountProjectIds(work: WorkViewer, account: AccountRef): Promise<string[]> {
  const clientIds = new Set([account.client.id, ...account.brands.map((brand) => brand.id)]);
  return projectsWithTeams(await workDirectory())
    .filter(({ project, team }) => !!project.clientId && clientIds.has(project.clientId) && canViewProject(work, projectFacts(project, team)))
    .map(({ project }) => project.id);
}

export type BillingSummary = { ready: number; readyVnd: number | null; invoiced12m: number; invoicedVnd12m: number | null };

/** Billing items of the account's projects: how many wait for finance and how many were invoiced this year. Amounts only when allowed. */
async function billingSummary(projectIds: readonly string[], seesMoney: boolean, today: IsoDate): Promise<BillingSummary> {
  if (projectIds.length === 0) return { ready: 0, readyVnd: seesMoney ? 0 : null, invoiced12m: 0, invoicedVnd12m: seesMoney ? 0 : null };
  const [row] = await db()
    .select({
      ready: sql<number>`count(*) filter (where ${schema.projectBillingItem.status} = 'ready')`,
      readyVnd: sql<number>`coalesce(sum(${schema.projectBillingItem.amountVnd}) filter (where ${schema.projectBillingItem.status} = 'ready'), 0)`,
      invoiced: sql<number>`count(*) filter (where ${schema.projectBillingItem.status} = 'invoiced' and ${schema.projectBillingItem.invoiceDate} >= ${addDays(today, -365)}::date)`,
      invoicedVnd: sql<number>`coalesce(sum(${schema.projectBillingItem.amountVnd}) filter (where ${schema.projectBillingItem.status} = 'invoiced' and ${schema.projectBillingItem.invoiceDate} >= ${addDays(today, -365)}::date), 0)`,
    })
    .from(schema.projectBillingItem)
    .where(inArray(schema.projectBillingItem.projectId, [...projectIds]));
  return { ready: Number(row?.ready ?? 0), readyVnd: seesMoney ? Number(row?.readyVnd ?? 0) : null, invoiced12m: Number(row?.invoiced ?? 0), invoicedVnd12m: seesMoney ? Number(row?.invoicedVnd ?? 0) : null };
}

export type AccountPage = {
  account: AccountRef;
  can: AccountAbilities;
  managerName: string | null;
  salesOwnerName: string | null;
  signals: AccountSignals;
  team: TeamMemberView[];
  contacts: ContactView[];
  projects: PortfolioRow[];
  retainers: (RetainerConsumption & { projectName: string })[];
  hours: { month: string; minutes: number; people: number }[];
  decisions: { approved: number; approvedWithChanges: number; changesRequired: number };
  billing: BillingSummary;
  followUps: ActivityView[];
  activities: ActivityView[];
  timeline: TimelineItem[];
};

const firstOfMonthsAgo = (today: IsoDate, months: number): string => {
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 7);
};

export async function getAccountPage(viewer: CrmViewer, work: WorkViewer, account: AccountRef, today: IsoDate = todayInVietnam()): Promise<AccountPage> {
  const can = accountAbilities(viewer, account);
  const clientIds = [account.client.id, ...account.brands.map((brand) => brand.id)];
  const projectIds = await visibleAccountProjectIds(work, account);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [names, signalsMap, team, contacts, projects, retainers, hours, decisions, billing, followUps, activities, timeline] = await Promise.all([
    listPersonNames(),
    accountSignals([account.client.id], today),
    listAccountTeam(account),
    listContacts(account.client.id, can.work),
    listPortfolio(work, { today, includeDone: true, clientIds }),
    retainerConsumption(projectIds, { from: monthStart, to: today }),
    hoursByMonth(projectIds, firstOfMonthsAgo(today, 5)),
    clientDecisionCounts(projectIds, new Date(Date.parse(`${addDays(today, -90)}T00:00:00+07:00`))),
    billingSummary(projectIds, can.seeMoney, today),
    can.work ? listOpenFollowUps({ clientId: account.client.id }) : Promise.resolve([]),
    can.work ? listActivities({ clientId: account.client.id }, 20) : Promise.resolve([]),
    accountTimeline({ clientIds, accountId: account.client.id, projectIds, worksAccount: can.work, seesReceivables: can.seeReceivables }, 60),
  ]);
  const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
  const raw = signalsMap.get(account.client.id)!;
  const projectName = new Map(projects.map((row) => [row.id, row.name]));
  return {
    account,
    can,
    managerName: account.client.accountManagerPersonId ? (nameOf.get(account.client.accountManagerPersonId) ?? null) : null,
    salesOwnerName: account.profile?.salesOwnerPersonId ? (nameOf.get(account.profile.salesOwnerPersonId) ?? null) : null,
    signals: {
      ...raw,
      pipelineVnd: can.seeMoney ? raw.pipelineVnd : 0,
      weightedVnd: can.seeMoney ? raw.weightedVnd : 0,
      wonVnd12m: can.seeMoney ? raw.wonVnd12m : 0,
      receivableVnd: can.seeReceivables ? raw.receivableVnd : 0,
      overdueVnd: can.seeReceivables ? raw.overdueVnd : 0,
    },
    team,
    contacts,
    projects,
    retainers: retainers.map((row) => ({ ...row, projectName: projectName.get(row.projectId) ?? "" })),
    hours,
    decisions,
    billing,
    followUps,
    activities: activities.filter((activity) => !!activity.doneAt),
    timeline,
  };
}

/** The accounts a person manages (FR-CRM-46): their profile, the directory, the exit handover. */
export async function accountsManagedBy(personIds: readonly string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const result = new Map<string, { id: string; name: string }[]>();
  if (personIds.length === 0) return result;
  const rows = await db()
    .select({ id: schema.workClient.id, name: schema.workClient.name, personId: schema.workClient.accountManagerPersonId })
    .from(schema.workClient)
    .where(and(inArray(schema.workClient.accountManagerPersonId, [...personIds]), eq(schema.workClient.isActive, true), sql`${schema.workClient.parentId} is null`))
    .orderBy(schema.workClient.name);
  for (const row of rows) if (row.personId) result.set(row.personId, [...(result.get(row.personId) ?? []), { id: row.id, name: row.name }]);
  return result;
}
