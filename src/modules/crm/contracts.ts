// Client contracts and renewals (FR-CRM-25..27). A contract is recorded against the account and the
// SuZu entity that signs it — a service contract, a framework contract (hợp đồng nguyên tắc) or an
// appendix of one — with its dates, value, payment terms and signed scan. Whether it is active or
// expired is read from its dates, never stored. The projects delivered under it carry its number on
// their billing items, and it opens its own renewal deal before it ends.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, gte, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { accountsById, findAccount } from "./accounts";
import { createDeal } from "./deals";
import { contractState, type ContractState, monthEnd, renewalDue } from "./engine/contract";
import type { ContractKind } from "./enums";
import { crmSettings, firstStageOf, listStages } from "./stages";

type Executor = Tx | ReturnType<typeof db>;
export type ContractRow = typeof schema.crmContract.$inferSelect;
export type ContractView = Omit<ContractRow, "valueVnd"> & { valueVnd?: number | null; state: ContractState; accountName: string; entityName: string | null; projectIds: string[]; renewalDealId: string | null };

export const findContract = async (contractId: string, executor: Executor = db()): Promise<ContractRow | undefined> => (await executor.select().from(schema.crmContract).where(eq(schema.crmContract.id, contractId)).limit(1))[0];

/** Contracts of some accounts (or all the reader may see, when `clientIds` is null), with their state today and value only where allowed. */
export async function listContracts(clientIds: readonly string[] | null, seesValue: (row: ContractRow) => boolean, today: IsoDate = todayInVietnam()): Promise<ContractView[]> {
  if (clientIds && clientIds.length === 0) return [];
  const rows = await db()
    .select({ contract: schema.crmContract, accountName: schema.workClient.name, entityName: schema.entity.shortName })
    .from(schema.crmContract)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmContract.clientId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.crmContract.entityId))
    .where(clientIds ? inArray(schema.crmContract.clientId, [...clientIds]) : undefined)
    .orderBy(desc(schema.crmContract.startDate), asc(schema.crmContract.number));
  const ids = rows.map((row) => row.contract.id);
  const [links, renewals] = ids.length
    ? await Promise.all([
        db().select().from(schema.crmContractProject).where(inArray(schema.crmContractProject.contractId, ids)),
        db().select({ id: schema.crmDeal.id, contractId: schema.crmDeal.renewsContractId }).from(schema.crmDeal).where(inArray(schema.crmDeal.renewsContractId, ids)),
      ])
    : [[], []];
  return rows.map(({ contract, accountName, entityName }) => {
    const { valueVnd, ...rest } = contract;
    return {
      ...rest,
      ...(seesValue(contract) ? { valueVnd } : {}),
      state: contractState(contract, today),
      accountName,
      entityName,
      projectIds: links.filter((link) => link.contractId === contract.id).map((link) => link.projectId),
      renewalDealId: renewals.find((row) => row.contractId === contract.id)?.id ?? null,
    };
  });
}

export type ContractInput = {
  number: string;
  title: string;
  kind: ContractKind;
  entityId: string | null;
  parentContractId: string | null;
  dealId: string | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** Only written when given: the value follows the money rule, and a reader without it never sends one. */
  valueVnd?: number | null;
  paymentTermsDays: number | null;
  autoRenew: boolean;
  noticeDays: number | null;
  note: string | null;
};

async function checkContract(executor: Executor, clientId: string, input: ContractInput, contractId: string | null): Promise<void> {
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new ActionError("contract_dates_invalid");
  if (input.kind === "appendix" && !input.parentContractId) throw new ActionError("contract_parent_required");
  if (input.parentContractId) {
    const parent = await findContract(input.parentContractId, executor);
    if (!parent || parent.clientId !== clientId || parent.id === contractId || parent.kind === "appendix") throw new ActionError("contract_parent_invalid");
  }
  if (input.dealId) {
    const [deal] = await executor.select({ clientId: schema.crmDeal.clientId }).from(schema.crmDeal).where(eq(schema.crmDeal.id, input.dealId)).limit(1);
    if (!deal || deal.clientId !== clientId) throw new ActionError("deal_not_found");
  }
  const [taken] = await executor
    .select({ id: schema.crmContract.id })
    .from(schema.crmContract)
    .where(and(eq(schema.crmContract.number, input.number), input.entityId ? eq(schema.crmContract.entityId, input.entityId) : isNull(schema.crmContract.entityId)))
    .limit(1);
  if (taken && taken.id !== contractId) throw new ActionError("contract_number_taken");
}

/** A new contract (a draft), or a change to one not terminated. */
export async function saveContract(clientId: string, contractId: string | null, input: ContractInput, actorPersonId: string): Promise<{ before: ContractRow | null; after: ContractRow }> {
  return db().transaction(async (tx) => {
    const account = await findAccount(clientId, tx);
    if (!account || account.client.id !== clientId) throw new ActionError("account_not_found");
    await checkContract(tx, clientId, input, contractId);
    if (!contractId) {
      const [after] = await tx.insert(schema.crmContract).values({ ...input, clientId, createdByPersonId: actorPersonId }).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.crmContract).where(eq(schema.crmContract.id, contractId)).limit(1).for("update");
    if (!before || before.clientId !== clientId) throw new ActionError("contract_not_found");
    if (before.status === "terminated") throw new ActionError("contract_terminated");
    const [after] = await tx.update(schema.crmContract).set({ ...input, updatedAt: new Date() }).where(eq(schema.crmContract.id, contractId)).returning();
    return { before, after };
  });
}

/** Signed: the day, and the scan of the signed paper (uploaded first). */
export async function signContract(contractId: string, input: { signedOn: IsoDate; signedFileId: string }): Promise<{ before: ContractRow; after: ContractRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmContract).where(eq(schema.crmContract.id, contractId)).limit(1).for("update");
    if (!before) throw new ActionError("contract_not_found");
    if (before.status !== "draft") throw new ActionError("contract_not_draft");
    const [after] = await tx.update(schema.crmContract).set({ status: "signed", signedOn: input.signedOn, signedFileId: input.signedFileId, updatedAt: new Date() }).where(eq(schema.crmContract.id, contractId)).returning();
    return { before, after };
  });
}

export async function terminateContract(contractId: string, input: { terminatedOn: IsoDate; note: string }): Promise<{ before: ContractRow; after: ContractRow }> {
  if (!input.note.trim()) throw new ActionError("contract_reason_required");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmContract).where(eq(schema.crmContract.id, contractId)).limit(1).for("update");
    if (!before) throw new ActionError("contract_not_found");
    if (before.status !== "signed") throw new ActionError("contract_not_signed");
    const [after] = await tx.update(schema.crmContract).set({ status: "terminated", terminatedOn: input.terminatedOn, note: [before.note, input.note].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(schema.crmContract.id, contractId)).returning();
    return { before, after };
  });
}

/** Which contract a project is delivered under — set or cleared. The project must be the account's (or a brand's). */
export async function linkProjectToContract(projectId: string, contractId: string | null): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(schema.crmContractProject).where(eq(schema.crmContractProject.projectId, projectId));
    if (!contractId) return;
    const contract = await findContract(contractId, tx);
    const [project] = await tx.select({ clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
    const account = project?.clientId ? await findAccount(project.clientId, tx) : null;
    if (!contract || !account || account.client.id !== contract.clientId) throw new ActionError("contract_not_found");
    await tx.insert(schema.crmContractProject).values({ projectId, contractId });
  });
}

/** The contract number each project is delivered under (the billing queue's reference, FR-PJM-56). */
export async function contractNumbersOfProjects(projectIds: readonly string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db()
    .select({ projectId: schema.crmContractProject.projectId, number: schema.crmContract.number })
    .from(schema.crmContractProject)
    .innerJoin(schema.crmContract, eq(schema.crmContract.id, schema.crmContractProject.contractId))
    .where(inArray(schema.crmContractProject.projectId, [...projectIds]));
  return new Map(rows.map((row) => [row.projectId, row.number]));
}

/** Contracts a project could be linked to: the signed and draft ones of its account. */
export async function contractChoices(clientId: string): Promise<Pick<ContractRow, "id" | "number" | "title" | "status">[]> {
  return db().select({ id: schema.crmContract.id, number: schema.crmContract.number, title: schema.crmContract.title, status: schema.crmContract.status }).from(schema.crmContract).where(and(eq(schema.crmContract.clientId, clientId), inArray(schema.crmContract.status, ["draft", "signed"]))).orderBy(desc(schema.crmContract.startDate));
}

// ── Renewals (FR-CRM-26) ────────────────────────────────────────────────────────────────────

/**
 * The morning pass: every signed contract and every active retainer ending within the lead time gets
 * one renewal deal — owned by the account's manager (else whoever sold it), in the first open stage,
 * with a follow-up for today — and its owner is told. The unique indexes make a second run a no-op.
 */
export async function openRenewals(today: IsoDate = todayInVietnam()): Promise<{ renewalsOpened: number }> {
  const { renewalLeadDays } = await crmSettings(today);
  const horizon = addDays(today, renewalLeadDays);
  const stage = firstStageOf(await listStages(), "open");
  if (!stage) return { renewalsOpened: 0 };
  const [contracts, retainers] = await Promise.all([
    db()
      .select({ contract: schema.crmContract, owner: sql<string | null>`(select ${schema.crmDeal.ownerPersonId} from ${schema.crmDeal} where ${schema.crmDeal.id} = ${schema.crmContract.dealId})` })
      .from(schema.crmContract)
      .where(and(eq(schema.crmContract.status, "signed"), gte(schema.crmContract.endDate, today), lte(schema.crmContract.endDate, horizon), sql`not exists (select 1 from ${schema.crmDeal} where ${schema.crmDeal.renewsContractId} = ${schema.crmContract.id})`)),
    db()
      .select({ projectId: schema.projectRetainer.projectId, endMonth: schema.projectRetainer.endMonth, clientId: schema.workProject.clientId, name: schema.workProject.name, entityId: schema.workProject.entityId, teamId: schema.workProject.teamId, manager: schema.projectPlan.accountManagerPersonId, lead: schema.workProject.leadPersonId, feePerMonthVnd: schema.projectRetainer.feePerMonthVnd })
      .from(schema.projectRetainer)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectRetainer.projectId))
      .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
      .where(and(eq(schema.projectRetainer.isActive, true), sql`${schema.projectRetainer.endMonth} is not null`, sql`not exists (select 1 from ${schema.crmDeal} where ${schema.crmDeal.renewsProjectId} = ${schema.projectRetainer.projectId})`)),
  ]);
  const accounts = await accountsById();
  let opened = 0;
  for (const { contract, owner } of contracts) {
    if (!renewalDue(contract.endDate, today, renewalLeadDays)) continue;
    const account = accounts.get(contract.clientId);
    const ownerId = account?.client.accountManagerPersonId ?? owner ?? contract.createdByPersonId;
    if (!account || !ownerId) continue;
    await openRenewal({ clientId: account.client.id, accountName: account.client.name, ownerId, entityId: contract.entityId, title: contract.title, endDate: contract.endDate!, contractNumber: contract.number, renewsContractId: contract.id, renewsProjectId: null, monthlyVnd: null, teamId: null, stageId: stage.id }, today);
    opened += 1;
  }
  for (const retainer of retainers) {
    const endDate = monthEnd(retainer.endMonth!);
    if (!retainer.clientId || !renewalDue(endDate, today, renewalLeadDays)) continue;
    const account = accounts.get(retainer.clientId);
    const ownerId = account?.client.accountManagerPersonId ?? retainer.manager ?? retainer.lead;
    if (!account || !ownerId) continue;
    await openRenewal({ clientId: account.client.id, accountName: account.client.name, ownerId, entityId: retainer.entityId, title: retainer.name, endDate, contractNumber: retainer.name, renewsContractId: null, renewsProjectId: retainer.projectId, monthlyVnd: retainer.feePerMonthVnd, teamId: retainer.teamId, stageId: stage.id }, today);
    opened += 1;
  }
  return { renewalsOpened: opened };
}

type Renewal = { clientId: string; accountName: string; ownerId: string; entityId: string | null; title: string; endDate: IsoDate; contractNumber: string; renewsContractId: string | null; renewsProjectId: string | null; monthlyVnd: number | null; teamId: string | null; stageId: string };

async function openRenewal(renewal: Renewal, today: IsoDate): Promise<void> {
  await db().transaction(async (tx) => {
    const deal = await createDeal(
      { clientId: renewal.clientId, title: `Gia hạn / Renewal: ${renewal.title}`.slice(0, 200), brandId: null, serviceLines: [], oneOffVnd: null, monthlyVnd: renewal.monthlyVnd, months: renewal.monthlyVnd ? 12 : null, probability: null, expectedCloseOn: renewal.endDate, teamId: renewal.teamId, entityId: renewal.entityId, source: "existing", competitors: null, nextStep: null, ownerPersonId: renewal.ownerId, stageId: renewal.stageId, leadId: null, contacts: [] },
      renewal.ownerId,
      tx,
      today,
    );
    await tx.update(schema.crmDeal).set({ renewsContractId: renewal.renewsContractId, renewsProjectId: renewal.renewsProjectId }).where(eq(schema.crmDeal.id, deal.id));
    await tx.insert(schema.crmActivity).values({ kind: "task", subject: `Gia hạn / Renewal: ${renewal.contractNumber}`.slice(0, 200), clientId: renewal.clientId, dealId: deal.id, ownerPersonId: renewal.ownerId, dueOn: today, createdByPersonId: null });
    await notify({ recipients: [renewal.ownerId], kind: "crm.renewal_opened", params: { contract: renewal.contractNumber, account: renewal.accountName, endDate: renewal.endDate }, link: `/crm/deals/${deal.id}` }, tx);
  });
}

/** What ends within the next `days` days — contracts signed and retainers active — for the account page and the pipeline. */
export async function expiringContracts(clientIds: readonly string[] | null, today: IsoDate, days = 90): Promise<{ id: string; number: string; title: string; endDate: IsoDate; clientId: string; accountName: string }[]> {
  const rows = await db()
    .select({ id: schema.crmContract.id, number: schema.crmContract.number, title: schema.crmContract.title, endDate: schema.crmContract.endDate, clientId: schema.crmContract.clientId, accountName: schema.workClient.name })
    .from(schema.crmContract)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmContract.clientId))
    .where(and(eq(schema.crmContract.status, "signed"), gte(schema.crmContract.endDate, today), lte(schema.crmContract.endDate, addDays(today, days)), clientIds ? inArray(schema.crmContract.clientId, [...clientIds]) : undefined))
    .orderBy(asc(schema.crmContract.endDate));
  return rows.map((row) => ({ ...row, endDate: row.endDate! }));
}
