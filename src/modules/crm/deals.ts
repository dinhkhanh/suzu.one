// Deals (FR-CRM-11..14): the pipeline. A deal belongs to an account (the client; a brand is kept
// beside it), moves through the configured stages — each stage's gates checked on the way in —
// and ends won or lost. Values are shown only to the rule's people (`canSeeDealValue`); a reader
// without it gets the deal with no value at all, not a zero.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { entityReach } from "../platform/rbac/policy";
import { finishPitchProjectIn, jobPrefix, jobYear, nextJobNumber } from "@/modules/projects/service";
import { invalidateWorkDirectory, viewersOfPeople } from "@/modules/work/service";
import { type AccountRef, accountsById, dealValueSql, findAccount } from "./accounts";
import { moveFollowUps } from "./activities";
import { dealValue, effectiveProbability, type GateFacts, isStale, unmetGates, weightedValue } from "./engine/deal";
import type { DealStatus, LostReason, ServiceLine, Source, StageCategory, StageGate } from "./enums";
import { canEditDeal, canOwnDeal, canSeeDealValue, canViewDeal, type CrmViewer, type DealFacts } from "./policy";
import { crmSettings, firstStageOf, listStages, type StageRow } from "./stages";
import { invalidateTies } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
export type DealRow = typeof schema.crmDeal.$inferSelect;

export const dealFacts = (deal: Pick<DealRow, "id" | "entityId" | "ownerPersonId" | "status">, account: AccountRef): DealFacts => ({ id: deal.id, entityId: deal.entityId, ownerPersonId: deal.ownerPersonId, status: deal.status as DealStatus, account: account.facts });

export const findDeal = async (dealId: string, executor: Executor = db()): Promise<DealRow | undefined> => (await executor.select().from(schema.crmDeal).where(eq(schema.crmDeal.id, dealId)).limit(1))[0];

/** The deal with its account, for the policy: what every action asks before it acts. */
export async function dealContext(dealId: string, executor?: Executor): Promise<{ deal: DealRow; account: AccountRef; facts: DealFacts } | null> {
  const deal = await findDeal(dealId, executor ?? db());
  if (!deal) return null;
  const account = await findAccount(deal.clientId, executor);
  return account ? { deal, account, facts: dealFacts(deal, account) } : null;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type DealView = Omit<DealRow, "oneOffVnd" | "monthlyVnd"> & {
  accountName: string;
  brandName: string | null;
  ownerName: string | null;
  teamName: string | null;
  entityName: string | null;
  stage: Pick<StageRow, "id" | "name" | "nameEn" | "category" | "probability">;
  probabilityNow: number;
  lastTouchedOn: IsoDate;
  /** Present only for a reader who may see the value. */
  value?: { oneOffVnd: number | null; monthlyVnd: number | null; months: number | null; totalVnd: number; weightedVnd: number };
  /** May this reader change it (`canEditDeal`)? */
  canEdit: boolean;
};

const brand = alias(schema.workClient, "deal_brand");
const owner = alias(schema.person, "deal_owner");

async function readDeals(where: SQL | undefined, limit: number, executor: Executor = db()) {
  // The last time anything happened: a stage change, or a logged activity on the deal.
  const lastActivity = executor
    .select({ dealId: schema.crmActivity.dealId, at: sql<Date>`max(coalesce(${schema.crmActivity.occurredAt}, ${schema.crmActivity.doneAt}))`.as("last_activity_at") })
    .from(schema.crmActivity)
    .where(sql`${schema.crmActivity.dealId} is not null`)
    .groupBy(schema.crmActivity.dealId)
    .as("last_activity");
  return executor
    .select({
      deal: schema.crmDeal,
      accountName: schema.workClient.name,
      brandName: brand.name,
      ownerName: owner.fullName,
      teamName: schema.workTeam.name,
      entityName: schema.entity.shortName,
      stage: { id: schema.crmStage.id, name: schema.crmStage.name, nameEn: schema.crmStage.nameEn, category: schema.crmStage.category, probability: schema.crmStage.probability },
      lastTouchedOn: sql<string>`to_char(greatest(${schema.crmDeal.stageChangedAt}, coalesce(${lastActivity.at}, ${schema.crmDeal.stageChangedAt})) at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    })
    .from(schema.crmDeal)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmDeal.clientId))
    .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDeal.stageId))
    .leftJoin(brand, eq(brand.id, schema.crmDeal.brandId))
    .leftJoin(owner, eq(owner.id, schema.crmDeal.ownerPersonId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.crmDeal.teamId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.crmDeal.entityId))
    .leftJoin(lastActivity, eq(lastActivity.dealId, schema.crmDeal.id))
    .where(where)
    .orderBy(asc(schema.crmStage.sortOrder), desc(schema.crmDeal.updatedAt))
    .limit(limit);
}

type ReadRow = Awaited<ReturnType<typeof readDeals>>[number];

function shapeDeal(row: ReadRow, seesValue: boolean, canEdit: boolean): DealView {
  const { oneOffVnd, monthlyVnd, ...deal } = row.deal;
  const probabilityNow = effectiveProbability(row.deal, { category: row.stage.category as StageCategory, probability: row.stage.probability });
  const total = dealValue(row.deal);
  return {
    ...deal,
    accountName: row.accountName,
    brandName: row.brandName,
    ownerName: row.ownerName,
    teamName: row.teamName,
    entityName: row.entityName,
    stage: row.stage,
    probabilityNow,
    lastTouchedOn: row.lastTouchedOn,
    canEdit,
    ...(seesValue ? { value: { oneOffVnd, monthlyVnd, months: row.deal.months, totalVnd: total, weightedVnd: weightedValue(total, probabilityNow) } } : {}),
  };
}

export type DealFilters = { status?: DealStatus | "all"; ownerId?: string | null; teamId?: string | null; entityId?: string | null; clientId?: string | null; serviceLine?: ServiceLine | null; closeMonth?: string | null; q?: string | null; mine?: boolean };

/**
 * The deals this viewer may see, filtered in SQL by the rule of `canViewDeal` — their own, their
 * accounts', and every deal of the entities they sell in — then asked of the policy again, row by
 * row, with the value shaped per deal.
 */
export async function listDeals(viewer: CrmViewer, filters: DealFilters = {}, limit = 500): Promise<DealView[]> {
  const me = viewer.principal.personId;
  const sell = entityReach(viewer.principal, "crm:sell");
  const manage = entityReach(viewer.principal, "crm:manage");
  const all = sell.all || manage.all;
  const entities = [...(sell.all ? [] : sell.entityIds), ...(manage.all ? [] : manage.entityIds)];
  const tied = [...viewer.ties.keys()];
  const own = me ? eq(schema.crmDeal.ownerPersonId, me) : undefined;
  const reach = filters.mine ? own : all ? undefined : or(own, tied.length ? inArray(schema.crmDeal.clientId, tied) : undefined, entities.length ? inArray(schema.crmDeal.entityId, entities) : undefined);
  if (!all && !reach) return [];
  const q = filters.q?.trim();
  const conditions = [
    reach,
    filters.status && filters.status !== "all" ? eq(schema.crmDeal.status, filters.status) : undefined,
    filters.ownerId ? eq(schema.crmDeal.ownerPersonId, filters.ownerId) : undefined,
    filters.teamId ? eq(schema.crmDeal.teamId, filters.teamId) : undefined,
    filters.entityId ? eq(schema.crmDeal.entityId, filters.entityId) : undefined,
    filters.clientId ? eq(schema.crmDeal.clientId, filters.clientId) : undefined,
    filters.serviceLine ? sql`${filters.serviceLine} = any(${schema.crmDeal.serviceLines})` : undefined,
    filters.closeMonth ? sql`to_char(${schema.crmDeal.expectedCloseOn}, 'YYYY-MM') = ${filters.closeMonth}` : undefined,
    q ? sql`(${schema.crmDeal.title} ilike ${`%${q}%`} or ${schema.crmDeal.code} ilike ${`%${q}%`} or ${schema.workClient.name} ilike ${`%${q}%`})` : undefined,
  ];
  const [rows, accounts] = await Promise.all([readDeals(and(...conditions), limit), accountsById()]);
  const result: DealView[] = [];
  for (const row of rows) {
    const account = accounts.get(row.deal.clientId);
    if (!account) continue;
    const facts = dealFacts(row.deal, account);
    if (!canViewDeal(viewer, facts)) continue;
    result.push(shapeDeal(row, canSeeDealValue(viewer, facts), canEditDeal(viewer, facts)));
  }
  return result;
}

/** One deal as the page shows it, or null when the reader may not see it. */
export async function getDeal(viewer: CrmViewer, dealId: string): Promise<{ deal: DealView; account: AccountRef; facts: DealFacts } | null> {
  const [row] = await readDeals(eq(schema.crmDeal.id, dealId), 1);
  if (!row) return null;
  const account = await findAccount(row.deal.clientId);
  if (!account) return null;
  const facts = dealFacts(row.deal, account);
  if (!canViewDeal(viewer, facts)) return null;
  return { deal: shapeDeal(row, canSeeDealValue(viewer, facts), canEditDeal(viewer, facts)), account, facts };
}

export type DealContactView = { contactId: string; fullName: string; title: string | null; decisionRole: string | null; role: string | null };

export async function listDealContacts(dealId: string): Promise<DealContactView[]> {
  return db()
    .select({ contactId: schema.crmContact.id, fullName: schema.crmContact.fullName, title: schema.crmContact.title, decisionRole: schema.crmContact.decisionRole, role: schema.crmDealContact.role })
    .from(schema.crmDealContact)
    .innerJoin(schema.crmContact, eq(schema.crmContact.id, schema.crmDealContact.contactId))
    .where(eq(schema.crmDealContact.dealId, dealId))
    .orderBy(asc(schema.crmContact.searchName));
}

export type StageChangeView = { id: string; fromName: string | null; toName: string; toCategory: string; changedAt: Date; byName: string | null };

export async function listStageChanges(dealId: string): Promise<StageChangeView[]> {
  const from = alias(schema.crmStage, "from_stage");
  const to = alias(schema.crmStage, "to_stage");
  const by = alias(schema.person, "changed_by");
  const rows = await db()
    .select({ id: schema.crmDealStageChange.id, fromName: from.name, toName: to.name, toCategory: to.category, changedAt: schema.crmDealStageChange.changedAt, byName: by.fullName })
    .from(schema.crmDealStageChange)
    .leftJoin(from, eq(from.id, schema.crmDealStageChange.fromStageId))
    .innerJoin(to, eq(to.id, schema.crmDealStageChange.toStageId))
    .leftJoin(by, eq(by.id, schema.crmDealStageChange.changedByPersonId))
    .where(eq(schema.crmDealStageChange.dealId, dealId))
    .orderBy(desc(schema.crmDealStageChange.changedAt));
  return rows;
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

export type DealInput = {
  title: string;
  brandId: string | null;
  serviceLines: ServiceLine[];
  oneOffVnd: number | null;
  monthlyVnd: number | null;
  months: number | null;
  probability: number | null;
  expectedCloseOn: IsoDate | null;
  teamId: string | null;
  entityId: string | null;
  source: Source | null;
  competitors: string | null;
  nextStep: string | null;
};

async function checkDealInput(executor: Executor, clientId: string, input: DealInput): Promise<void> {
  if (input.brandId) {
    const [row] = await executor.select({ parentId: schema.workClient.parentId }).from(schema.workClient).where(eq(schema.workClient.id, input.brandId)).limit(1);
    if (!row || row.parentId !== clientId) throw new ActionError("deal_brand_invalid");
  }
  if (input.teamId) {
    const [team] = await executor.select({ isActive: schema.workTeam.isActive }).from(schema.workTeam).where(eq(schema.workTeam.id, input.teamId)).limit(1);
    if (!team?.isActive) throw new ActionError("team_not_found");
  }
  if ((input.monthlyVnd ?? 0) > 0 && input.months !== null && input.months < 1) throw new ActionError("deal_months_invalid");
}

/** "DL-SZM-26-014": the deal's entity (or the group), the year it was opened, a running number. */
async function nextDealCode(tx: Tx, entityId: string | null, today: IsoDate): Promise<string> {
  const [entity] = entityId ? await tx.select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1) : [];
  return nextJobNumber(tx, `DL-${jobPrefix(entity?.code)}`, jobYear(today));
}

export type NewDeal = DealInput & { clientId: string; ownerPersonId: string; stageId: string | null; leadId: string | null; contacts: { contactId: string; role: string | null }[] };

/** Opens a deal. A brand given as the client is filed under its client, with the brand beside it. */
export async function createDeal(input: NewDeal, actorPersonId: string, executor?: Tx, today: IsoDate = todayInVietnam()): Promise<DealRow> {
  const run = async (tx: Tx) => {
    const account = await findAccount(input.clientId, tx);
    if (!account) throw new ActionError("account_not_found");
    const brandId = input.brandId ?? (account.client.id !== input.clientId ? input.clientId : null);
    const values = { ...input, brandId };
    await checkDealInput(tx, account.client.id, values);
    const stages = await listStages(tx);
    const stage = input.stageId ? stages.find((row) => row.id === input.stageId && row.isActive) : firstStageOf(stages, "open");
    if (!stage || stage.category !== "open") throw new ActionError("stage_not_found");
    const entityId = input.entityId ?? account.profile?.contractingEntityId ?? account.client.entityId;
    const unmet = unmetGates(stage.gates as StageGate[], { contacts: input.contacts.length, expectedCloseOn: input.expectedCloseOn, value: dealValue(input), quoteAccepted: false, contractSigned: false, pitchProject: false });
    if (unmet.length) throw new ActionError("deal_gates", { gates: unmet });
    const code = await nextDealCode(tx, entityId, today);
    const [deal] = await tx
      .insert(schema.crmDeal)
      .values({ ...values, code, entityId, clientId: account.client.id, stageId: stage.id, status: "open", createdByPersonId: actorPersonId })
      .returning();
    await tx.insert(schema.crmDealStageChange).values({ dealId: deal.id, fromStageId: null, toStageId: stage.id, changedByPersonId: actorPersonId });
    await replaceContacts(tx, deal, account, input.contacts);
    if (input.ownerPersonId !== actorPersonId) await notify({ recipients: [input.ownerPersonId], kind: "crm.deal_assigned", params: { deal: deal.title, account: account.client.name }, link: `/crm/deals/${deal.id}` }, tx);
    await invalidateTies(input.ownerPersonId);
    return deal;
  };
  return executor ? run(executor) : db().transaction(run);
}

async function replaceContacts(tx: Tx, deal: Pick<DealRow, "id">, account: AccountRef, contacts: readonly { contactId: string; role: string | null }[]): Promise<void> {
  const ids = [...new Set(contacts.map((contact) => contact.contactId))];
  if (ids.length) {
    const rows = await tx.select({ id: schema.crmContact.id }).from(schema.crmContact).where(and(inArray(schema.crmContact.id, ids), eq(schema.crmContact.clientId, account.client.id), isNull(schema.crmContact.erasedAt)));
    if (rows.length !== ids.length) throw new ActionError("contact_not_found");
  }
  await tx.delete(schema.crmDealContact).where(eq(schema.crmDealContact.dealId, deal.id));
  if (ids.length) await tx.insert(schema.crmDealContact).values(ids.map((contactId) => ({ dealId: deal.id, contactId, role: contacts.find((contact) => contact.contactId === contactId)?.role ?? null })));
}

async function lockDeal(tx: Tx, dealId: string): Promise<DealRow> {
  const [deal] = await tx.select().from(schema.crmDeal).where(eq(schema.crmDeal.id, dealId)).limit(1).for("update");
  if (!deal) throw new ActionError("deal_not_found");
  return deal;
}

export async function updateDeal(dealId: string, input: DealInput): Promise<{ before: DealRow; after: DealRow }> {
  return db().transaction(async (tx) => {
    const before = await lockDeal(tx, dealId);
    if (before.status !== "open") throw new ActionError("deal_closed");
    await checkDealInput(tx, before.clientId, input);
    const [after] = await tx.update(schema.crmDeal).set({ ...input, updatedAt: new Date() }).where(eq(schema.crmDeal.id, dealId)).returning();
    return { before, after };
  });
}

export async function setDealContacts(dealId: string, contacts: { contactId: string; role: string | null }[]): Promise<void> {
  await db().transaction(async (tx) => {
    const deal = await lockDeal(tx, dealId);
    const account = await findAccount(deal.clientId, tx);
    if (!account) throw new ActionError("account_not_found");
    await replaceContacts(tx, deal, account, contacts);
  });
}

/** What the gates of any stage ask of this deal, as it stands. */
export async function gateFacts(executor: Executor, deal: DealRow): Promise<GateFacts> {
  const [row] = await executor
    .select({
      contacts: sql<number>`(select count(*) from ${schema.crmDealContact} where ${schema.crmDealContact.dealId} = ${deal.id})`,
      quoteAccepted: sql<boolean>`exists (select 1 from ${schema.crmQuote} where ${schema.crmQuote.dealId} = ${deal.id} and ${schema.crmQuote.status} = 'accepted')`,
      contractSigned: sql<boolean>`exists (select 1 from ${schema.crmContract} where ${schema.crmContract.dealId} = ${deal.id} and ${schema.crmContract.status} = 'signed')`,
    })
    .from(sql`(select 1) as one`);
  return { contacts: Number(row?.contacts ?? 0), expectedCloseOn: deal.expectedCloseOn, value: dealValue(deal), quoteAccepted: !!row?.quoteAccepted, contractSigned: !!row?.contractSigned, pitchProject: !!deal.pitchProjectId };
}

export type MoveResult = { before: DealRow; after: DealRow; stage: StageRow; pitchFinished: boolean };

/**
 * Moves an open deal to a stage. The stage's gates are checked; a stage of category "won" wins it
 * (the people who will deliver are told), "lost" loses it and needs a reason. A deal already won or
 * lost does not move — reopening it is `reopenDeal`, a `crm:manage` decision.
 */
export async function moveDeal(dealId: string, stageId: string, actorPersonId: string, lost: { reason: LostReason; note: string | null } | null = null): Promise<MoveResult> {
  const result = await db().transaction(async (tx) => {
    const before = await lockDeal(tx, dealId);
    if (before.status !== "open") throw new ActionError("deal_closed");
    const stage = (await listStages(tx)).find((row) => row.id === stageId && row.isActive);
    if (!stage) throw new ActionError("stage_not_found");
    if (stage.id === before.stageId) return { before, after: before, stage, pitchFinished: false };
    const unmet = unmetGates(stage.gates as StageGate[], await gateFacts(tx, before));
    if (unmet.length) throw new ActionError("deal_gates", { gates: unmet });
    if (stage.category === "lost" && !lost?.reason) throw new ActionError("deal_lost_reason_required");
    const now = new Date();
    const [after] = await tx
      .update(schema.crmDeal)
      .set({
        stageId: stage.id,
        status: stage.category,
        stageChangedAt: now,
        staleNotifiedOn: null,
        wonAt: stage.category === "won" ? now : null,
        lostAt: stage.category === "lost" ? now : null,
        lostReason: stage.category === "lost" ? lost!.reason : null,
        lostNote: stage.category === "lost" ? lost!.note : null,
        updatedAt: now,
      })
      .where(eq(schema.crmDeal.id, dealId))
      .returning();
    await tx.insert(schema.crmDealStageChange).values({ dealId, fromStageId: before.stageId, toStageId: stage.id, changedByPersonId: actorPersonId });
    let pitchFinished = false;
    if (stage.category !== "open" && after.pitchProjectId) pitchFinished = await finishPitchProjectIn(tx, after.pitchProjectId);
    if (stage.category === "won") await announceWin(tx, after, actorPersonId);
    return { before, after, stage, pitchFinished };
  });
  if (result.pitchFinished) await invalidateWorkDirectory();
  return result;
}

/** A won deal: its account's manager and sales owner, and the leads of the team that will deliver it. */
async function announceWin(tx: Tx, deal: DealRow, actorPersonId: string): Promise<void> {
  const account = await findAccount(deal.clientId, tx);
  const leads = deal.teamId ? await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, deal.teamId), eq(schema.workTeamMember.role, "lead"))) : [];
  const recipients = [...new Set([account?.client.accountManagerPersonId, account?.profile?.salesOwnerPersonId, deal.ownerPersonId, ...leads.map((row) => row.personId)].filter((id): id is string => !!id && id !== actorPersonId))];
  if (recipients.length) await notify({ recipients, kind: "crm.deal_won", params: { deal: deal.title, account: account?.client.name ?? "" }, link: `/crm/deals/${deal.id}` }, tx);
}

/** A won or lost deal back into an open stage (`crm:manage`). Not once it became a project: undo the project first. */
export async function reopenDeal(dealId: string, stageId: string, actorPersonId: string): Promise<{ before: DealRow; after: DealRow }> {
  return db().transaction(async (tx) => {
    const before = await lockDeal(tx, dealId);
    if (before.status === "open") throw new ActionError("deal_open");
    const [project] = await tx.select({ id: schema.crmDealProject.projectId }).from(schema.crmDealProject).where(eq(schema.crmDealProject.dealId, dealId)).limit(1);
    if (project) throw new ActionError("deal_has_projects");
    const stage = (await listStages(tx)).find((row) => row.id === stageId && row.isActive && row.category === "open");
    if (!stage) throw new ActionError("stage_not_found");
    const now = new Date();
    const [after] = await tx.update(schema.crmDeal).set({ stageId, status: "open", wonAt: null, lostAt: null, lostReason: null, lostNote: null, stageChangedAt: now, updatedAt: now }).where(eq(schema.crmDeal.id, dealId)).returning();
    await tx.insert(schema.crmDealStageChange).values({ dealId, fromStageId: before.stageId, toStageId: stageId, changedByPersonId: actorPersonId });
    return { before, after };
  });
}

/**
 * A new owner for an open deal. The new owner must be able to hold it (`canOwnDeal`, asked with
 * their own grants), takes its open follow-ups, and is told.
 */
export async function reassignDeal(dealId: string, toPersonId: string, actorPersonId: string): Promise<{ before: DealRow; after: DealRow; movedFollowUps: number }> {
  const context = await dealContext(dealId);
  if (!context) throw new ActionError("deal_not_found");
  const target = (await viewersOfPeople([toPersonId])).get(toPersonId);
  if (!target || target.principal.workforceType === "collaborator" || !canOwnDeal({ principal: target.principal, ties: new Map() }, context.account.facts, context.deal.entityId)) throw new ActionError("deal_owner_ineligible");
  const result = await db().transaction(async (tx) => {
    const before = await lockDeal(tx, dealId);
    if (before.status !== "open") throw new ActionError("deal_closed");
    const [after] = await tx.update(schema.crmDeal).set({ ownerPersonId: toPersonId, updatedAt: new Date() }).where(eq(schema.crmDeal.id, dealId)).returning();
    const movedFollowUps = await moveFollowUps(tx, { ownerPersonId: before.ownerPersonId, dealIds: [dealId] }, toPersonId);
    if (toPersonId !== actorPersonId) await notify({ recipients: [toPersonId], kind: "crm.deal_assigned", params: { deal: after.title, account: context.account.client.name }, link: `/crm/deals/${dealId}` }, tx);
    return { before, after, movedFollowUps };
  });
  await invalidateTies(result.before.ownerPersonId, toPersonId);
  return result;
}

// ── The pipeline as a whole ─────────────────────────────────────────────────────────────────

/**
 * Stale deals (FR-CRM-13): open deals nobody has touched for the configured number of days. The
 * owner is told once per quiet spell — a new touch starts the count again. Returns how many.
 */
export async function sendStaleReminders(today: IsoDate = todayInVietnam()): Promise<{ staleDeals: number }> {
  const { staleDealDays } = await crmSettings(today);
  if (staleDealDays <= 0) return { staleDeals: 0 };
  const rows = await readDeals(and(eq(schema.crmDeal.status, "open"), or(isNull(schema.crmDeal.staleNotifiedOn), sql`${schema.crmDeal.staleNotifiedOn} < ${addDays(today, -staleDealDays)}::date`)), 2000);
  // Quiet for the whole spell, and not already told since it went quiet (the SQL left out anyone told within the spell).
  const stale = rows.filter((row) => isStale({ lastTouchedOn: row.lastTouchedOn }, today, staleDealDays));
  if (stale.length === 0) return { staleDeals: 0 };
  await db().transaction(async (tx) => {
    await tx.update(schema.crmDeal).set({ staleNotifiedOn: today }).where(inArray(schema.crmDeal.id, stale.map((row) => row.deal.id)));
    for (const row of stale) await notify({ recipients: [row.deal.ownerPersonId], kind: "crm.deal_stale", params: { deal: row.deal.title, account: row.accountName, days: staleDealDays }, link: `/crm/deals/${row.deal.id}` }, tx);
  });
  return { staleDeals: stale.length };
}

/** Deals each person owns that are still open (the exit handover, leave cover and the pipeline gate). */
export async function openDealsOf(personIds: readonly string[], executor: Executor = db()): Promise<(Pick<DealRow, "id" | "code" | "title" | "clientId" | "expectedCloseOn" | "ownerPersonId"> & { accountName: string })[]> {
  if (personIds.length === 0) return [];
  return executor
    .select({ id: schema.crmDeal.id, code: schema.crmDeal.code, title: schema.crmDeal.title, clientId: schema.crmDeal.clientId, expectedCloseOn: schema.crmDeal.expectedCloseOn, ownerPersonId: schema.crmDeal.ownerPersonId, accountName: schema.workClient.name })
    .from(schema.crmDeal)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmDeal.clientId))
    .where(and(inArray(schema.crmDeal.ownerPersonId, [...personIds]), eq(schema.crmDeal.status, "open")))
    .orderBy(asc(schema.crmDeal.expectedCloseOn));
}

/** Does this person own any deal at all (the pipeline's navigation entry)? */
export async function ownsAnyDeal(personId: string): Promise<boolean> {
  const [row] = await db().select({ id: schema.crmDeal.id }).from(schema.crmDeal).where(eq(schema.crmDeal.ownerPersonId, personId)).limit(1);
  return !!row;
}

/**
 * The board's column headers, over the cards the board already shows: how many, and the value of
 * those the reader may value (`valued` says how many that is, so a partial sum never passes for the whole).
 */
export function pipelineTotals(deals: readonly DealView[]): Map<string, { count: number; valued: number; totalVnd: number; weightedVnd: number }> {
  const totals = new Map<string, { count: number; valued: number; totalVnd: number; weightedVnd: number }>();
  for (const deal of deals) {
    const row = totals.get(deal.stageId) ?? { count: 0, valued: 0, totalVnd: 0, weightedVnd: 0 };
    row.count += 1;
    if (deal.value) {
      row.valued += 1;
      row.totalVnd += deal.value.totalVnd;
      row.weightedVnd += deal.value.weightedVnd;
    }
    totals.set(deal.stageId, row);
  }
  return totals;
}

export { dealValueSql };
