import "server-only";
import { and, arrayContains, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { invalidatePeople } from "../people/service";
import { buildTree, flattenTree, placementOf, type TreeNode, type UnitNode, wouldLoop } from "./engine/tree";
import { type OrgUnitKind, PAYING_BANK_KEYS } from "./enums";

type Executor = Tx | ReturnType<typeof db>;

export type EntityRow = typeof schema.entity.$inferSelect;
export type OrgUnitRow = typeof schema.orgUnit.$inferSelect;

// Entities, branches and the unit tree are read on nearly every page and change a few times a
// year, so they live in the shared cache (src/lib/cache). Every write below drops its entry.
const ORG_CACHE = { entities: "org:entities", branches: "org:branches", units: "org:units", bankAccounts: "org:entity-bank-accounts" } as const;
const ORG_TTL = 60 * 60;

/** For writers outside this file (the department import, seeds): the tree or entities changed. */
export const invalidateOrgCache = () => invalidate(...Object.values(ORG_CACHE));

export async function listEntities(): Promise<EntityRow[]> {
  return cached(ORG_CACHE.entities, ORG_TTL, () => db().select().from(schema.entity).orderBy(asc(schema.entity.code)));
}

export type BranchRow = typeof schema.branch.$inferSelect;

export async function listBranches(): Promise<BranchRow[]> {
  return cached(ORG_CACHE.branches, ORG_TTL, () => db().select().from(schema.branch).orderBy(asc(schema.branch.name)));
}

/** Every unit. Inside a transaction pass it, and the rows come from that transaction, not the cache. */
export async function listOrgUnits(executor?: Executor): Promise<OrgUnitRow[]> {
  const load = (from: Executor) => from.select().from(schema.orgUnit).orderBy(asc(schema.orgUnit.name));
  return executor ? load(executor) : cached(ORG_CACHE.units, ORG_TTL, () => load(db()));
}

/** The units as a forest — what the admin screen draws and every unit picker flattens. */
export async function orgUnitTree(executor?: Executor): Promise<TreeNode[]> {
  return buildTree(await listOrgUnits(executor));
}

/** Units in tree order, for a `<select>`: each row knows its depth so the label can be indented. */
export async function orgUnitOptions(options: { activeOnly?: boolean } = {}, executor?: Executor): Promise<{ id: string; name: string; kind: OrgUnitKind; depth: number; entityId: string | null; path: readonly string[]; isActive: boolean }[]> {
  const units = await listOrgUnits(executor);
  return flattenTree(buildTree(options.activeOnly ? units.filter((unit) => unit.isActive) : units)).map(({ id, name, kind, depth, entityId, path, isActive }) => ({ id, name, kind, depth, entityId, path, isActive }));
}

/**
 * Units for a `<select>`: tree order, each name prefixed with one dash per level down, so a list
 * of plain `{ id, name }` options still shows where each unit sits. Inactive units are left out.
 */
export async function unitChoices(executor?: Executor): Promise<{ id: string; name: string }[]> {
  const options = await orgUnitOptions({ activeOnly: true }, executor);
  return options.map((unit) => ({ id: unit.id, name: `${"— ".repeat(unit.depth)}${unit.name}` }));
}

/** The two legacy placement columns for a chosen unit; the database derives the same for `person`. */
export async function placementFor(unitId: string | null, executor?: Executor): Promise<{ departmentId: string | null; teamId: string | null }> {
  if (!unitId) return { departmentId: null, teamId: null };
  const units = await listOrgUnits(executor);
  return placementOf(unitId, new Map(units.map((unit) => [unit.id, unit as UnitNode])));
}

/** The ancestors-and-self of each unit, for the pure policy's `unitPath`. */
export async function unitPathsOf(ids: readonly string[], executor?: Executor): Promise<Map<string, string[]>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  if (!executor) {
    const units = new Map((await listOrgUnits()).map((unit) => [unit.id, unit.path]));
    return new Map(wanted.flatMap((id) => (units.has(id) ? [[id, units.get(id)!] as const] : [])));
  }
  const rows = await executor.select({ id: schema.orgUnit.id, path: schema.orgUnit.path }).from(schema.orgUnit).where(inArray(schema.orgUnit.id, wanted));
  return new Map(rows.map((row) => [row.id, row.path]));
}

export const unitPathOf = async (id: string | null | undefined, executor?: Executor): Promise<string[]> => (id ? ((await unitPathsOf([id], executor)).get(id) ?? []) : []);

export type EntityInput = {
  code: string;
  legalName: string;
  shortName: string;
  taxCode?: string;
  wageRegion?: number;
};

export type EntityDetails = Pick<EntityRow, "legalName" | "shortName" | "taxCode" | "insuranceUnitCode" | "wageRegion" | "address" | "legalRepresentative" | "isActive">;

export async function createEntity(input: EntityInput): Promise<EntityRow> {
  const code = input.code.trim().toUpperCase();
  const [existing] = await db().select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.code, code)).limit(1);
  if (existing) throw new ActionError("entity_code_taken");

  const [created] = await db()
    .insert(schema.entity)
    .values({
      code,
      legalName: input.legalName.trim(),
      shortName: input.shortName.trim(),
      taxCode: input.taxCode?.trim() || null,
      wageRegion: input.wageRegion ?? null,
    })
    .returning();
  await invalidate(ORG_CACHE.entities);
  return created;
}

export async function findEntity(id: string): Promise<EntityRow | undefined> {
  const [row] = await db().select().from(schema.entity).where(eq(schema.entity.id, id)).limit(1);
  return row;
}

export async function findBranch(id: string): Promise<BranchRow | undefined> {
  const [row] = await db().select().from(schema.branch).where(eq(schema.branch.id, id)).limit(1);
  return row;
}

export async function findOrgUnit(id: string, executor: Executor = db()): Promise<OrgUnitRow | undefined> {
  const [row] = await executor.select().from(schema.orgUnit).where(eq(schema.orgUnit.id, id)).limit(1);
  return row;
}

// Switching something off while people still sit in it would leave them pointing at a dead unit.
async function hasCurrentPeople(column: typeof schema.person.primaryEntityId, id: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(and(eq(column, id), ne(schema.person.status, "offboarded")))
    .limit(1);
  return !!row;
}

// A unit with people anywhere below it is still in use: switching off "Marketing" would strand
// everyone in "Marketing › Social" just as surely as stranding Marketing's own people.
async function hasPeopleInSubtree(id: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(and(arrayContains(schema.person.orgUnitPath, [id]), ne(schema.person.status, "offboarded")))
    .limit(1);
  return !!row;
}

type Change<Row> = { before: Row; after: Row };

export async function updateEntity(id: string, details: EntityDetails): Promise<Change<EntityRow>> {
  const before = await findEntity(id);
  if (!before) throw new ActionError("not_found");
  if (before.isActive && !details.isActive && (await hasCurrentPeople(schema.person.primaryEntityId, id))) throw new ActionError("entity_in_use");
  const [after] = await db().update(schema.entity).set({ ...details, updatedAt: new Date() }).where(eq(schema.entity.id, id)).returning();
  await invalidate(ORG_CACHE.entities);
  return { before, after };
}

export async function createBranch(input: { entityId: string; name: string; address: string | null }): Promise<BranchRow> {
  if (!(await findEntity(input.entityId))) throw new ActionError("not_found");
  const [created] = await db().insert(schema.branch).values(input).returning();
  await invalidate(ORG_CACHE.branches);
  return created;
}

export async function updateBranch(id: string, details: Pick<BranchRow, "name" | "address" | "isActive">): Promise<Change<BranchRow>> {
  const before = await findBranch(id);
  if (!before) throw new ActionError("not_found");
  const [after] = await db().update(schema.branch).set({ ...details, updatedAt: new Date() }).where(eq(schema.branch.id, id)).returning();
  await invalidate(ORG_CACHE.branches);
  return { before, after };
}

// ── The entity's paying bank accounts (FR-PLT-11, FR-PAY-33) ────────────────────────────────

export type EntityBankAccountRow = typeof schema.entityBankAccount.$inferSelect;
export type EntityBankAccountInput = Pick<EntityBankAccountRow, "bank" | "accountNumber" | "accountName" | "branch" | "isDefault" | "isActive">;

/**
 * Every paying account of every entity — a handful of rows that change once in years — under one
 * cached key, in a fixed order. Inside a transaction pass it: the rows come from there.
 */
async function allBankAccounts(executor?: Executor): Promise<EntityBankAccountRow[]> {
  const load = (from: Executor) => from.select().from(schema.entityBankAccount).orderBy(asc(schema.entityBankAccount.entityId), asc(schema.entityBankAccount.bank), asc(schema.entityBankAccount.accountNumber), asc(schema.entityBankAccount.id));
  return executor ? load(executor) : cached(ORG_CACHE.bankAccounts, ORG_TTL, () => load(db()));
}

/** One entity's paying accounts, the default of each bank first. No authorization inside. */
export async function listEntityBankAccounts(entityId: string, options: { activeOnly?: boolean } = {}, executor?: Executor): Promise<EntityBankAccountRow[]> {
  const rows = await allBankAccounts(executor);
  return rows
    .filter((row) => row.entityId === entityId && (!options.activeOnly || row.isActive))
    .sort((left, right) => left.bank.localeCompare(right.bank) || Number(right.isDefault) - Number(left.isDefault) || left.accountNumber.localeCompare(right.accountNumber));
}

export async function findEntityBankAccount(id: string, executor: Executor = db()): Promise<EntityBankAccountRow | undefined> {
  const [row] = await executor.select().from(schema.entityBankAccount).where(eq(schema.entityBankAccount.id, id)).limit(1);
  return row;
}

/**
 * Adds a paying account (`accountId` null) or changes one. The number is kept as digits only. An
 * account marked default takes the mark from the entity's other accounts at the same bank, and the
 * first account in use at a bank is the default whether or not the box was ticked — there is
 * always exactly one to offer while any is in use.
 */
export async function saveEntityBankAccount(entityId: string, accountId: string | null, input: EntityBankAccountInput): Promise<{ before: EntityBankAccountRow | null; after: EntityBankAccountRow }> {
  if (!(PAYING_BANK_KEYS as readonly string[]).includes(input.bank)) throw new ActionError("bank_unknown");
  const accountNumber = input.accountNumber.replace(/[\s-]/g, "");
  if (!/^\d{6,32}$/.test(accountNumber)) throw new ActionError("bank_account_number_invalid");

  const saved = await db().transaction(async (tx) => {
    const table = schema.entityBankAccount;
    // The entity's accounts are locked together: two saves at once must not both end up default.
    const existing = await tx.select().from(table).where(eq(table.entityId, entityId)).for("update");
    const before = accountId ? (existing.find((row) => row.id === accountId) ?? null) : null;
    if (accountId && !before) throw new ActionError("not_found");
    if (!accountId && (await tx.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1)).length === 0) throw new ActionError("not_found");
    if (existing.some((row) => row.id !== accountId && row.bank === input.bank && row.accountNumber === accountNumber)) throw new ActionError("bank_account_exists");

    const others = existing.filter((row) => row.id !== accountId && row.bank === input.bank && row.isActive).sort((left, right) => left.accountNumber.localeCompare(right.accountNumber));
    const isDefault = input.isActive && (input.isDefault || !others.some((row) => row.isDefault));
    // The mark is taken from the others before this row takes it (one default per bank is an index).
    const demoted = isDefault ? others.filter((row) => row.isDefault).map((row) => row.id) : [];
    if (demoted.length > 0) await tx.update(table).set({ isDefault: false, updatedAt: new Date() }).where(inArray(table.id, demoted));
    const values = { bank: input.bank, accountNumber, accountName: input.accountName.trim(), branch: input.branch?.trim() || null, isDefault, isActive: input.isActive };
    const [after] = before ? await tx.update(table).set({ ...values, updatedAt: new Date() }).where(eq(table.id, before.id)).returning() : await tx.insert(table).values({ entityId, ...values }).returning();
    // The default itself was switched off: the mark passes to another account still in use.
    if (!isDefault && others.length > 0 && !others.some((row) => row.isDefault)) await tx.update(table).set({ isDefault: true, updatedAt: new Date() }).where(eq(table.id, others[0].id));
    return { before, after };
  });
  await invalidate(ORG_CACHE.bankAccounts);
  return saved;
}

export type OrgUnitDetails = Pick<OrgUnitRow, "name" | "kind" | "parentId" | "isActive">;

// A unit may not sit under itself, directly or through its own descendants. The database refuses
// it too (`org_unit_path_set`); this is the error the form can show.
async function assertParentAllowed(unitId: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const parent = await findOrgUnit(parentId);
  if (!parent) throw new ActionError("unit_parent_not_found");
  if (unitId && wouldLoop(unitId, parentId, new Map((await listOrgUnits()).map((unit) => [unit.id, unit.parentId])))) throw new ActionError("unit_parent_loop");
}

export async function createOrgUnit(input: { code: string | null; name: string; kind: OrgUnitKind; parentId: string | null; entityId: string | null }): Promise<OrgUnitRow> {
  const code = input.code?.trim().toUpperCase() || null;
  if (code) {
    const [existing] = await db().select({ id: schema.orgUnit.id }).from(schema.orgUnit).where(eq(schema.orgUnit.code, code)).limit(1);
    if (existing) throw new ActionError("unit_code_taken");
  }
  await assertParentAllowed(null, input.parentId);
  // A unit created inside another starts in its parent's entity unless the form says otherwise —
  // a shared unit may still hold an entity-specific one (HR › HR Creative).
  const parent = input.parentId ? await findOrgUnit(input.parentId) : undefined;
  const [created] = await db().insert(schema.orgUnit).values({ ...input, code, entityId: input.entityId ?? parent?.entityId ?? null }).returning();
  await invalidate(ORG_CACHE.units);
  return created;
}

export async function updateOrgUnit(id: string, details: OrgUnitDetails): Promise<Change<OrgUnitRow>> {
  const before = await findOrgUnit(id);
  if (!before) throw new ActionError("not_found");
  await assertParentAllowed(id, details.parentId);
  if (before.isActive && !details.isActive && (await hasPeopleInSubtree(id))) throw new ActionError("unit_in_use");
  const [after] = await db().update(schema.orgUnit).set({ ...details, updatedAt: new Date() }).where(eq(schema.orgUnit.id, id)).returning();
  // A move rewrites the path of every unit below, so the whole tree entry goes — and with it the
  // cached rows of everyone in the subtree, whose `org_unit_path` the database trigger rewrote.
  await invalidate(ORG_CACHE.units);
  if (before.parentId !== after.parentId) {
    const people = await db().select({ id: schema.person.id, workEmail: schema.person.workEmail }).from(schema.person).where(arrayContains(schema.person.orgUnitPath, [id]));
    await invalidatePeople(people);
  }
  return { before, after };
}
