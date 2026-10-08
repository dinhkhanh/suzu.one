// Accounts (FR-CRM-01, 03, 04): the CRM profile beside each client, the account's team, and the
// figures an account list shows. The client itself — code, name, brands, account manager — stays
// the work module's row; creating an account creates that row and its profile together.
//
// Profiles are a small table every CRM page reads, so the whole table sits in the shared cache
// (reference tier) and is filtered here; every writer below drops it once committed. The figures
// (open projects, pipeline, receivables, follow-ups) are live, and are computed in SQL per request.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { listPersonNames } from "../platform/people/service";
import { type ClientInput, type ClientRow, invalidateWorkClients, listClients, saveClient } from "@/modules/work/service";
import { likelyDuplicateAccounts, normalizeTaxCode, proposeLifecycle } from "./engine/account";
import type { AccountSize, AccountTier, Lifecycle, Source } from "./enums";
import { type AccountFacts, canSeeAccountMoney, canSeeReceivables, canViewAccount, type CrmViewer, tiesTo } from "./policy";
import { invalidateTies } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
export type AccountProfileRow = typeof schema.crmAccount.$inferSelect;

const PROFILES_KEY = "crm:accounts";

/** Every account profile, ordered by client id. Inside a transaction pass it and read from there. */
export async function listAccountProfiles(executor?: Executor): Promise<AccountProfileRow[]> {
  const read = (from: Executor) => from.select().from(schema.crmAccount).orderBy(schema.crmAccount.clientId);
  return executor && executor !== db() ? read(executor) : cached(PROFILES_KEY, TTL.reference, () => read(db()));
}

/** After a write to `crm_account` has committed (or as it is written, inside a short transaction). */
export const invalidateAccountProfiles = () => invalidate(PROFILES_KEY);

/** The account's facts for the policy. A brand is never an account: pass its client. */
export function accountFacts(client: Pick<ClientRow, "id" | "entityId" | "accountManagerPersonId">, profile: Pick<AccountProfileRow, "contractingEntityId" | "salesOwnerPersonId"> | null | undefined): AccountFacts {
  return { clientId: client.id, entityIds: [client.entityId, profile?.contractingEntityId ?? null], accountManagerPersonId: client.accountManagerPersonId, salesOwnerPersonId: profile?.salesOwnerPersonId ?? null };
}

export type AccountRef = { client: ClientRow; profile: AccountProfileRow | null; facts: AccountFacts; brands: ClientRow[] };

/** An account by its client id (or by one of its brands'): the client, its profile, its brands. */
export async function findAccount(clientId: string, executor?: Executor): Promise<AccountRef | null> {
  const [clients, profiles] = await Promise.all([executor && executor !== db() ? executor.select().from(schema.workClient) : listClients(), listAccountProfiles(executor)]);
  const found = clients.find((row) => row.id === clientId);
  if (!found) return null;
  const client = found.parentId ? clients.find((row) => row.id === found.parentId) : found;
  if (!client) return null;
  const profile = profiles.find((row) => row.clientId === client.id) ?? null;
  return { client, profile, facts: accountFacts(client, profile), brands: clients.filter((row) => row.parentId === client.id) };
}

/** Every account by client id (a brand maps to its client's account) — one read of the two cached lists. */
export async function accountsById(executor?: Executor): Promise<Map<string, AccountRef>> {
  const [clients, profiles] = await Promise.all([executor && executor !== db() ? executor.select().from(schema.workClient) : listClients(), listAccountProfiles(executor)]);
  const profileOf = new Map(profiles.map((row) => [row.clientId, row]));
  const accounts = new Map<string, AccountRef>();
  for (const client of clients.filter((row) => !row.parentId)) {
    const profile = profileOf.get(client.id) ?? null;
    accounts.set(client.id, { client, profile, facts: accountFacts(client, profile), brands: clients.filter((row) => row.parentId === client.id) });
  }
  for (const brand of clients.filter((row) => row.parentId)) {
    const account = accounts.get(brand.parentId!);
    if (account) accounts.set(brand.id, account);
  }
  return accounts;
}

// ── Figures per account ─────────────────────────────────────────────────────────────────────

export type AccountSignals = {
  openProjects: number;
  projects: number;
  openDeals: number;
  pipelineVnd: number;
  weightedVnd: number;
  wonVnd12m: number;
  lastActivityOn: IsoDate | null;
  nextFollowUpOn: IsoDate | null;
  openFollowUps: number;
  receivableVnd: number;
  overdueVnd: number;
};

const EMPTY_SIGNALS: AccountSignals = { openProjects: 0, projects: 0, openDeals: 0, pipelineVnd: 0, weightedVnd: 0, wonVnd12m: 0, lastActivityOn: null, nextFollowUpOn: null, openFollowUps: 0, receivableVnd: 0, overdueVnd: 0 };

const n = (value: unknown): number => Number(value ?? 0);

/** SQL: a deal's value (one-off + monthly × months). The same sum as `dealValue`. */
export const dealValueSql = sql`(coalesce(${schema.crmDeal.oneOffVnd}, 0) + coalesce(${schema.crmDeal.monthlyVnd}, 0) * greatest(coalesce(${schema.crmDeal.months}, 1), 1))`;

/**
 * The live figures of many accounts in five grouped queries, whatever their number. Projects of a
 * brand count for its client; everything else is recorded on the client itself.
 */
export async function accountSignals(accountIds: readonly string[], today: IsoDate = todayInVietnam(), executor: Executor = db()): Promise<Map<string, AccountSignals>> {
  const result = new Map<string, AccountSignals>();
  if (accountIds.length === 0) return result;
  const ids = [...new Set(accountIds)];
  const accountOfProject = sql<string>`coalesce(${schema.workClient.parentId}, ${schema.workClient.id})`;
  const yearAgo = sql`(${today}::date - interval '12 months')`;
  const [projects, deals, activities, receivables] = await Promise.all([
    executor
      .select({ accountId: accountOfProject, open: sql<number>`count(*) filter (where ${schema.workProject.status} in ('planned', 'active', 'paused'))`, all: sql<number>`count(*)` })
      .from(schema.workProject)
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
      .where(inArray(accountOfProject, ids))
      .groupBy(accountOfProject),
    executor
      .select({
        accountId: schema.crmDeal.clientId,
        open: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'open')`,
        pipeline: sql<number>`coalesce(sum(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'open'), 0)`,
        weighted: sql<number>`coalesce(sum(${dealValueSql} * coalesce(${schema.crmDeal.probability}, ${schema.crmStage.probability}) / 100) filter (where ${schema.crmDeal.status} = 'open'), 0)`,
        won12m: sql<number>`coalesce(sum(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'won' and ${schema.crmDeal.wonAt} >= ${yearAgo}), 0)`,
      })
      .from(schema.crmDeal)
      .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDeal.stageId))
      .where(inArray(schema.crmDeal.clientId, ids))
      .groupBy(schema.crmDeal.clientId),
    executor
      .select({
        accountId: schema.crmActivity.clientId,
        last: sql<string | null>`to_char(max(coalesce(${schema.crmActivity.occurredAt}, ${schema.crmActivity.doneAt})) at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
        next: sql<string | null>`to_char(min(${schema.crmActivity.dueOn}) filter (where ${schema.crmActivity.doneAt} is null), 'YYYY-MM-DD')`,
        openFollowUps: sql<number>`count(*) filter (where ${schema.crmActivity.doneAt} is null and ${schema.crmActivity.dueOn} is not null)`,
      })
      .from(schema.crmActivity)
      .where(inArray(schema.crmActivity.clientId, ids))
      .groupBy(schema.crmActivity.clientId),
    receivablesByAccount(ids, today, executor),
  ]);
  for (const id of ids) result.set(id, { ...EMPTY_SIGNALS });
  for (const row of projects) Object.assign(result.get(row.accountId) ?? {}, { openProjects: n(row.open), projects: n(row.all) });
  for (const row of deals) Object.assign(result.get(row.accountId) ?? {}, { openDeals: n(row.open), pipelineVnd: n(row.pipeline), weightedVnd: Math.round(n(row.weighted)), wonVnd12m: n(row.won12m) });
  for (const row of activities) if (row.accountId) Object.assign(result.get(row.accountId) ?? {}, { lastActivityOn: row.last, nextFollowUpOn: row.next, openFollowUps: n(row.openFollowUps) });
  for (const [accountId, row] of receivables) Object.assign(result.get(accountId) ?? {}, row);
  return result;
}

/** Open and overdue amounts per account: invoice totals less what was paid, open invoices only. */
export async function receivablesByAccount(accountIds: readonly string[], today: IsoDate, executor: Executor = db()): Promise<Map<string, { receivableVnd: number; overdueVnd: number }>> {
  if (accountIds.length === 0) return new Map();
  const paid = executor
    .select({ invoiceId: schema.crmPayment.invoiceId, amount: sql<number>`sum(${schema.crmPayment.amountVnd})`.as("paid_amount") })
    .from(schema.crmPayment)
    .where(isNull(schema.crmPayment.reversedAt))
    .groupBy(schema.crmPayment.invoiceId)
    .as("paid");
  const outstanding = sql`greatest(${schema.crmInvoice.totalVnd} - coalesce(${paid.amount}, 0), 0)`;
  const rows = await executor
    .select({ accountId: schema.crmInvoice.clientId, open: sql<number>`coalesce(sum(${outstanding}), 0)`, overdue: sql<number>`coalesce(sum(${outstanding}) filter (where ${schema.crmInvoice.dueOn} < ${today}::date), 0)` })
    .from(schema.crmInvoice)
    .leftJoin(paid, eq(paid.invoiceId, schema.crmInvoice.id))
    .where(and(inArray(schema.crmInvoice.clientId, [...accountIds]), eq(schema.crmInvoice.status, "open")))
    .groupBy(schema.crmInvoice.clientId);
  return new Map(rows.map((row) => [row.accountId, { receivableVnd: n(row.open), overdueVnd: n(row.overdue) }]));
}

// ── The account list ────────────────────────────────────────────────────────────────────────

export type AccountListItem = {
  client: ClientRow;
  profile: AccountProfileRow | null;
  brands: ClientRow[];
  managerName: string | null;
  salesOwnerName: string | null;
  mine: boolean;
  signals: AccountSignals;
  /** Money columns the reader may see on this row. */
  seesMoney: boolean;
  seesReceivables: boolean;
};

export type AccountFilters = { q?: string; lifecycle?: Lifecycle | "all"; tier?: AccountTier | "all"; mine?: boolean; managerId?: string | null; includeInactive?: boolean };

/**
 * The accounts this viewer may see, with their figures. Money columns are blanked row by row for a
 * reader who may not see them — the row stays, since the client list is open to every employee.
 */
export async function listAccounts(viewer: CrmViewer, filters: AccountFilters = {}, today: IsoDate = todayInVietnam()): Promise<AccountListItem[]> {
  const [clients, profiles, names] = await Promise.all([listClients(), listAccountProfiles(), listPersonNames()]);
  const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
  const profileOf = new Map(profiles.map((row) => [row.clientId, row]));
  const q = filters.q?.trim().toLowerCase();
  const candidates = clients.filter((client) => {
    if (client.parentId || (!filters.includeInactive && !client.isActive)) return false;
    const profile = profileOf.get(client.id);
    const facts = accountFacts(client, profile);
    if (!canViewAccount(viewer, facts)) return false;
    if (filters.mine && tiesTo(viewer, client.id).length === 0) return false;
    if (filters.managerId && client.accountManagerPersonId !== filters.managerId) return false;
    if (filters.lifecycle && filters.lifecycle !== "all" && (profile?.lifecycle ?? "prospect") !== filters.lifecycle) return false;
    if (filters.tier && filters.tier !== "all" && profile?.tier !== filters.tier) return false;
    if (q) {
      const brands = clients.filter((row) => row.parentId === client.id);
      const haystack = [client.name, client.code, profile?.legalName, profile?.taxCode, ...brands.map((brand) => brand.name)].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const signals = await accountSignals(
    candidates.map((client) => client.id),
    today,
  );
  return candidates.map((client) => {
    const profile = profileOf.get(client.id) ?? null;
    const facts = accountFacts(client, profile);
    const seesMoney = canSeeAccountMoney(viewer, facts);
    const seesReceivables = canSeeReceivables(viewer, facts);
    const raw = signals.get(client.id) ?? EMPTY_SIGNALS;
    return {
      client,
      profile,
      brands: clients.filter((row) => row.parentId === client.id),
      managerName: client.accountManagerPersonId ? (nameOf.get(client.accountManagerPersonId) ?? null) : null,
      salesOwnerName: profile?.salesOwnerPersonId ? (nameOf.get(profile.salesOwnerPersonId) ?? null) : null,
      mine: tiesTo(viewer, client.id).length > 0,
      signals: {
        ...raw,
        pipelineVnd: seesMoney ? raw.pipelineVnd : 0,
        weightedVnd: seesMoney ? raw.weightedVnd : 0,
        wonVnd12m: seesMoney ? raw.wonVnd12m : 0,
        receivableVnd: seesReceivables ? raw.receivableVnd : 0,
        overdueVnd: seesReceivables ? raw.overdueVnd : 0,
      },
      seesMoney,
      seesReceivables,
    };
  });
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

export type ProfileInput = {
  legalName: string | null;
  taxCode: string | null;
  address: string | null;
  website: string | null;
  industry: string | null;
  size: AccountSize | null;
  source: Source | null;
  tier: AccountTier | null;
  contractingEntityId: string | null;
};

export type CommercialTermsInput = { paymentTermsDays: number | null; creditHold: boolean; creditHoldReason: string | null; creditLimitVnd: number | null };

function cleanProfile(input: ProfileInput): ProfileInput {
  let taxCode: string | null = null;
  if (input.taxCode) {
    taxCode = normalizeTaxCode(input.taxCode);
    if (!taxCode) throw new ActionError("tax_code_invalid");
  }
  return { ...input, taxCode };
}

async function upsertProfile(tx: Executor, clientId: string, values: Partial<typeof schema.crmAccount.$inferInsert>): Promise<{ before: AccountProfileRow | null; after: AccountProfileRow }> {
  const [before] = await tx.select().from(schema.crmAccount).where(eq(schema.crmAccount.clientId, clientId)).limit(1);
  const [after] = await tx
    .insert(schema.crmAccount)
    .values({ clientId, ...values })
    .onConflictDoUpdate({ target: schema.crmAccount.clientId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return { before: before ?? null, after };
}

/** Likely duplicates of a new account among every existing one (FR-CRM-07). */
export async function findDuplicateAccounts(candidate: { name: string; legalName: string | null; taxCode: string | null }): Promise<{ clientId: string; name: string; reason: "tax_code" | "name" }[]> {
  const [clients, profiles] = await Promise.all([listClients(), listAccountProfiles()]);
  const profileOf = new Map(profiles.map((row) => [row.clientId, row]));
  const existing = clients.filter((client) => !client.parentId).map((client) => ({ clientId: client.id, name: client.name, legalName: profileOf.get(client.id)?.legalName ?? null, taxCode: profileOf.get(client.id)?.taxCode ?? null }));
  const nameOf = new Map(clients.map((client) => [client.id, client.name]));
  return likelyDuplicateAccounts(candidate, existing).map((hit) => ({ ...hit, name: nameOf.get(hit.clientId) ?? "" }));
}

export type NewAccountInput = { code: string; name: string; entityId: string | null; note: string | null; profile: ProfileInput; salesOwnerPersonId: string | null; accountManagerPersonId: string | null; confirmDuplicate: boolean };

/**
 * A new client with its profile. A likely duplicate is refused with the candidates (the form shows
 * them) until the person confirms it is a different company.
 */
export async function createAccount(input: NewAccountInput): Promise<{ client: ClientRow; profile: AccountProfileRow }> {
  const profile = cleanProfile(input.profile);
  if (!input.confirmDuplicate) {
    const duplicates = await findDuplicateAccounts({ name: input.name, legalName: profile.legalName, taxCode: profile.taxCode });
    if (duplicates.length) throw new ActionError("account_duplicate", { duplicates });
  }
  const clientInput: ClientInput = { code: input.code, name: input.name, kind: "client", parentId: null, entityId: input.entityId, note: input.note, isActive: true };
  const { after: client } = await saveClient(null, clientInput);
  const saved = await db().transaction(async (tx) => {
    if (input.accountManagerPersonId) await tx.update(schema.workClient).set({ accountManagerPersonId: input.accountManagerPersonId, updatedAt: new Date() }).where(eq(schema.workClient.id, client.id));
    return upsertProfile(tx, client.id, { ...profile, salesOwnerPersonId: input.salesOwnerPersonId, lifecycle: "prospect" });
  });
  await Promise.all([invalidateAccountProfiles(), invalidateTies(input.salesOwnerPersonId, input.accountManagerPersonId), input.accountManagerPersonId ? invalidateWorkClients() : null]);
  return { client: input.accountManagerPersonId ? { ...client, accountManagerPersonId: input.accountManagerPersonId } : client, profile: saved.after };
}

/** The profile of an existing client. A brand has none: its client's is the account's. */
export async function saveProfile(clientId: string, input: ProfileInput): Promise<{ before: AccountProfileRow | null; after: AccountProfileRow }> {
  const account = await findAccount(clientId);
  if (!account || account.client.id !== clientId) throw new ActionError("account_not_found");
  const saved = await db().transaction((tx) => upsertProfile(tx, clientId, cleanProfile(input)));
  await invalidateAccountProfiles();
  return saved;
}

export async function saveCommercialTerms(clientId: string, input: CommercialTermsInput): Promise<{ before: AccountProfileRow | null; after: AccountProfileRow }> {
  if (input.creditHold && !input.creditHoldReason?.trim()) throw new ActionError("credit_hold_reason_required");
  const saved = await db().transaction((tx) => upsertProfile(tx, clientId, { ...input, creditHoldReason: input.creditHold ? input.creditHoldReason : null }));
  await invalidateAccountProfiles();
  return saved;
}

/** Setting the lifecycle by hand stops the nightly proposal from moving it; `null` hands it back. */
export async function setLifecycle(clientId: string, lifecycle: Lifecycle | null, today: IsoDate = todayInVietnam()): Promise<{ before: AccountProfileRow | null; after: AccountProfileRow }> {
  const saved = await db().transaction(async (tx) => {
    if (lifecycle) return upsertProfile(tx, clientId, { lifecycle, lifecycleManual: true, lifecycleChangedAt: new Date() });
    const proposed = (await lifecycleProposals([clientId], today, tx)).get(clientId) ?? "prospect";
    return upsertProfile(tx, clientId, { lifecycle: proposed, lifecycleManual: false, lifecycleChangedAt: new Date() });
  });
  await invalidateAccountProfiles();
  return saved;
}

async function activePerson(executor: Executor, personId: string): Promise<void> {
  const [row] = await executor.select({ status: schema.person.status, workforceType: schema.person.workforceType }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || row.status === "offboarded") throw new ActionError("person_not_found");
}

export async function setSalesOwner(clientId: string, personId: string | null): Promise<{ before: AccountProfileRow | null; after: AccountProfileRow }> {
  if (personId) await activePerson(db(), personId);
  const saved = await db().transaction((tx) => upsertProfile(tx, clientId, { salesOwnerPersonId: personId }));
  await Promise.all([invalidateAccountProfiles(), invalidateTies(saved.before?.salesOwnerPersonId, personId)]);
  return saved;
}

export async function addAccountMember(clientId: string, personId: string, actorPersonId: string): Promise<void> {
  await activePerson(db(), personId);
  await db().insert(schema.crmAccountMember).values({ clientId, personId, createdByPersonId: actorPersonId }).onConflictDoNothing();
  await invalidateTies(personId);
}

export async function removeAccountMember(clientId: string, personId: string): Promise<void> {
  await db()
    .delete(schema.crmAccountMember)
    .where(and(eq(schema.crmAccountMember.clientId, clientId), eq(schema.crmAccountMember.personId, personId)));
  await invalidateTies(personId);
}

export type TeamMemberView = { personId: string; fullName: string; ties: string[] };

/**
 * The account's team as the access rules derive it (FR-CRM-03): the manager, the sales owner, named
 * members, deal owners and the people of its open projects — each with the ties that put them there.
 */
export async function listAccountTeam(account: AccountRef): Promise<TeamMemberView[]> {
  const clientIds = [account.client.id, ...account.brands.map((brand) => brand.id)];
  const [members, dealOwners, projectPeople, names] = await Promise.all([
    db().select({ personId: schema.crmAccountMember.personId }).from(schema.crmAccountMember).where(eq(schema.crmAccountMember.clientId, account.client.id)),
    db().selectDistinct({ personId: schema.crmDeal.ownerPersonId }).from(schema.crmDeal).where(eq(schema.crmDeal.clientId, account.client.id)),
    db()
      .selectDistinct({ personId: schema.workProjectMember.personId, role: schema.workProjectMember.role })
      .from(schema.workProjectMember)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.workProjectMember.projectId))
      .where(and(inArray(schema.workProject.clientId, clientIds), inArray(schema.workProject.status, ["planned", "active", "paused"]), inArray(schema.workProjectMember.role, ["lead", "account_manager", "member"]))),
    listPersonNames(),
  ]);
  const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
  const ties = new Map<string, Set<string>>();
  const add = (personId: string | null, tie: string) => {
    if (!personId) return;
    const set = ties.get(personId) ?? new Set<string>();
    set.add(tie);
    ties.set(personId, set);
  };
  add(account.client.accountManagerPersonId, "manager");
  add(account.profile?.salesOwnerPersonId ?? null, "sales_owner");
  for (const row of members) add(row.personId, "member");
  for (const row of dealOwners) add(row.personId, "deal_owner");
  for (const row of projectPeople) add(row.personId, row.role === "lead" ? "project_lead" : "project");
  return [...ties]
    .filter(([personId]) => nameOf.has(personId))
    .map(([personId, set]) => ({ personId, fullName: nameOf.get(personId) ?? "", ties: [...set] }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
}

export const isNamedMember = async (clientId: string, personId: string): Promise<boolean> =>
  (
    await db()
      .select({ personId: schema.crmAccountMember.personId })
      .from(schema.crmAccountMember)
      .where(and(eq(schema.crmAccountMember.clientId, clientId), eq(schema.crmAccountMember.personId, personId)))
      .limit(1)
  ).length > 0;

// ── Lifecycle (FR-CRM-01) ───────────────────────────────────────────────────────────────────

/** The lifecycle each account's facts suggest, from grouped queries. */
export async function lifecycleProposals(accountIds: readonly string[], today: IsoDate, executor: Executor = db()): Promise<Map<string, Lifecycle>> {
  if (accountIds.length === 0) return new Map();
  const ids = [...new Set(accountIds)];
  const accountOfProject = sql<string>`coalesce(${schema.workClient.parentId}, ${schema.workClient.id})`;
  const [projects, deals, invoices] = await Promise.all([
    executor
      .select({
        accountId: accountOfProject,
        open: sql<number>`count(*) filter (where ${schema.workProject.status} in ('planned', 'active', 'paused'))`,
        all: sql<number>`count(*)`,
        last: sql<string | null>`to_char(max(${schema.workProject.updatedAt}) at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
      })
      .from(schema.workProject)
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.workProject.clientId))
      .where(inArray(accountOfProject, ids))
      .groupBy(accountOfProject),
    executor
      .select({ accountId: schema.crmDeal.clientId, lastWon: sql<string | null>`to_char(max(${schema.crmDeal.wonAt}) at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')` })
      .from(schema.crmDeal)
      .where(and(inArray(schema.crmDeal.clientId, ids), eq(schema.crmDeal.status, "won")))
      .groupBy(schema.crmDeal.clientId),
    executor
      .select({ accountId: schema.crmInvoice.clientId, last: sql<string | null>`to_char(max(${schema.crmInvoice.issuedOn}), 'YYYY-MM-DD')` })
      .from(schema.crmInvoice)
      .where(inArray(schema.crmInvoice.clientId, ids))
      .groupBy(schema.crmInvoice.clientId),
  ]);
  const projectOf = new Map(projects.map((row) => [row.accountId, row]));
  const wonOf = new Map(deals.map((row) => [row.accountId, row.lastWon]));
  const invoiceOf = new Map(invoices.map((row) => [row.accountId, row.last]));
  return new Map(
    ids.map((id) => {
      const project = projectOf.get(id);
      const lastWonOn = wonOf.get(id) ?? null;
      const lastWorkOn =
        [project?.last ?? null, invoiceOf.get(id) ?? null]
          .filter((day): day is string => !!day)
          .sort()
          .at(-1) ?? null;
      return [id, proposeLifecycle({ openProjects: n(project?.open), lastWorkOn, lastWonOn, everBought: n(project?.all) > 0 || !!lastWonOn }, today)];
    }),
  );
}

/**
 * The nightly pass: every account whose lifecycle nobody set by hand takes the one its facts
 * suggest. Returns how many moved. Running it twice moves nothing the second time.
 */
export async function refreshLifecycles(today: IsoDate = todayInVietnam()): Promise<{ lifecyclesChanged: number }> {
  const clients = (
    await db()
      .select({ id: schema.workClient.id })
      .from(schema.workClient)
      .where(sql`${schema.workClient.parentId} is null`)
  ).map((row) => row.id);
  const [proposals, profiles] = await Promise.all([lifecycleProposals(clients, today), db().select().from(schema.crmAccount)]);
  const profileOf = new Map(profiles.map((row) => [row.clientId, row]));
  // Clients nobody has opened in the CRM keep no profile row until there is something to say.
  const moves = [...proposals].filter(([clientId, lifecycle]) => {
    const profile = profileOf.get(clientId);
    return !profile?.lifecycleManual && (profile?.lifecycle ?? "prospect") !== lifecycle;
  });
  const now = new Date();
  if (moves.length) {
    await db()
      .insert(schema.crmAccount)
      .values(moves.map(([clientId, lifecycle]) => ({ clientId, lifecycle, lifecycleChangedAt: now })))
      .onConflictDoUpdate({ target: schema.crmAccount.clientId, set: { lifecycle: sql`excluded.lifecycle`, lifecycleChangedAt: now, updatedAt: now }, where: sql`${schema.crmAccount.lifecycleManual} = false` });
  }
  const changed = moves.length;
  if (changed) await invalidateAccountProfiles();
  return { lifecyclesChanged: changed };
}

/** Accounts as a picker shows them — names only, from the cached lists, those the viewer may see. */
export async function accountChoices(viewer: CrmViewer): Promise<{ id: string; name: string }[]> {
  const [clients, profiles] = await Promise.all([listClients({ activeOnly: true }), listAccountProfiles()]);
  const profileOf = new Map(profiles.map((row) => [row.clientId, row]));
  return clients.filter((client) => !client.parentId && canViewAccount(viewer, accountFacts(client, profileOf.get(client.id)))).map((client) => ({ id: client.id, name: client.name }));
}

// ── Account handover (FR-CRM-42) ────────────────────────────────────────────────────────────

/** Open deals and open follow-ups each of these people still holds on the account — grouped in SQL. */
export async function accountWorkOf(clientId: string, personIds: readonly string[]): Promise<Map<string, { deals: number; followUps: number }>> {
  const result = new Map<string, { deals: number; followUps: number }>();
  if (personIds.length === 0) return result;
  const [deals, followUps] = await Promise.all([
    db()
      .select({ personId: schema.crmDeal.ownerPersonId, count: sql<number>`count(*)` })
      .from(schema.crmDeal)
      .where(and(eq(schema.crmDeal.clientId, clientId), eq(schema.crmDeal.status, "open"), inArray(schema.crmDeal.ownerPersonId, [...personIds])))
      .groupBy(schema.crmDeal.ownerPersonId),
    db()
      .select({ personId: schema.crmActivity.ownerPersonId, count: sql<number>`count(*)` })
      .from(schema.crmActivity)
      .where(and(eq(schema.crmActivity.clientId, clientId), sql`${schema.crmActivity.doneAt} is null`, sql`${schema.crmActivity.dueOn} is not null`, inArray(schema.crmActivity.ownerPersonId, [...personIds])))
      .groupBy(schema.crmActivity.ownerPersonId),
  ]);
  for (const personId of personIds) result.set(personId, { deals: 0, followUps: 0 });
  for (const row of deals) result.get(row.personId)!.deals = n(row.count);
  for (const row of followUps) result.get(row.personId)!.followUps = n(row.count);
  return result;
}

/**
 * After the account changed manager: the previous manager's open deals and follow-ups on it go to
 * the manager it has now, who is told once. Returns how many of each moved.
 */
export async function moveAccountWork(clientId: string, fromPersonId: string, actorPersonId: string): Promise<{ deals: number; followUps: number; toPersonId: string }> {
  const account = await findAccount(clientId);
  if (!account || account.client.id !== clientId) throw new ActionError("account_not_found");
  const toPersonId = account.client.accountManagerPersonId;
  if (!toPersonId || toPersonId === fromPersonId) throw new ActionError("account_work_nowhere");
  const moved = await db().transaction(async (tx) => {
    const now = new Date();
    const deals = await tx
      .update(schema.crmDeal)
      .set({ ownerPersonId: toPersonId, updatedAt: now })
      .where(and(eq(schema.crmDeal.clientId, clientId), eq(schema.crmDeal.status, "open"), eq(schema.crmDeal.ownerPersonId, fromPersonId)))
      .returning({ id: schema.crmDeal.id });
    const followUps = await tx
      .update(schema.crmActivity)
      .set({ ownerPersonId: toPersonId, remindedOn: null, updatedAt: now })
      .where(and(eq(schema.crmActivity.clientId, clientId), eq(schema.crmActivity.ownerPersonId, fromPersonId), sql`${schema.crmActivity.doneAt} is null`, sql`${schema.crmActivity.dueOn} is not null`))
      .returning({ id: schema.crmActivity.id });
    if ((deals.length || followUps.length) && toPersonId !== actorPersonId) {
      await notify({ recipients: [toPersonId], kind: "crm.account_team_added", params: { account: account.client.name }, link: `/crm/accounts/${clientId}` }, tx);
    }
    return { deals: deals.length, followUps: followUps.length };
  });
  await invalidateTies(fromPersonId, toPersonId);
  return { ...moved, toPersonId };
}
