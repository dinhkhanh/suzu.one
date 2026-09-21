// The asset register's use-cases (FR-AST-01, 02) and the only entry point other modules use.
//
// An asset's `status` and its open assignment are two views of one fact, so every use-case that
// moves a thing writes both inside one transaction, and the database's partial unique index
// (`asset_assignment_open_key`) is what actually stops two people holding the same camera — the
// check in code is there to give a decent message, not to be the rule.
import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { cancelOpenTasksOfContext, createTasks } from "@/modules/platform/tasks-engine/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { type AssetCondition, type AssetKind, type AssetStatus, type BillingCycle, BOOKING_CLOSED, BOOKING_HOLDS_SLOT, type BookingStatus, CYCLE_MONTHS, type HolderType, type LicenceStatus, UNASSIGNABLE_STATUSES } from "./enums";
import { assetReach, canManageAssets, canReadAssetMoney, canReadRegister, canViewAsset } from "./policy";
import { renewalsBetween } from "./engine/renewal";

export * from "./enums";
export * from "./engine/booking";
export * from "./engine/renewal";
export { assetReach, canActOnBooking, canBookAssets, canConfirmHandover, canDecideBookings, canManageAssets, canManageCategories, canManageLicences, canReadAssetMoney, canReadLicences, canReadPersonAssets, canReadRegister, canViewAsset } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type AssetRow = typeof schema.asset.$inferSelect;
export type AssetCategoryRow = typeof schema.assetCategory.$inferSelect;
export type AssetAssignmentRow = typeof schema.assetAssignment.$inferSelect;

const now = () => new Date();

// ── Codes and tokens ────────────────────────────────────────────────────────────────────────

/** What the QR label carries: unguessable, so a code cannot be walked, and not a credential. */
export const newQrToken = (): string => randomBytes(16).toString("hex");

/**
 * The next code for a category in an entity: SZM-LAP-0007. Counted from the codes already on the
 * books rather than a sequence, so an imported register keeps its own numbering and the next one
 * carries on from it.
 */
export async function nextAssetCode(executor: Executor, entityCode: string, categoryCode: string): Promise<string> {
  const prefix = `${entityCode}-${categoryCode}-`;
  const rows = await executor
    .select({ code: schema.asset.code })
    .from(schema.asset)
    .where(sql`${schema.asset.code} like ${prefix + "%"}`);
  const highest = rows.reduce((top, row) => {
    const tail = row.code.slice(prefix.length);
    return /^\d+$/.test(tail) ? Math.max(top, Number(tail)) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

// ── The register ────────────────────────────────────────────────────────────────────────────

export type CategoryInput = { code: string; name: string; kind: AssetKind; requiresSerial: boolean; defaultWarrantyMonths: number | null; bookable: boolean; sortOrder: number; isActive: boolean };

export async function listCategories(executor: Executor = db()): Promise<AssetCategoryRow[]> {
  return executor.select().from(schema.assetCategory).orderBy(asc(schema.assetCategory.sortOrder), asc(schema.assetCategory.name));
}

export async function saveCategory(categoryId: string | null, input: CategoryInput): Promise<{ before: AssetCategoryRow | null; after: AssetCategoryRow }> {
  const values = { ...input, code: input.code.toUpperCase(), updatedAt: now() };
  if (!categoryId) {
    const [after] = await db().insert(schema.assetCategory).values(values).returning();
    return { before: null, after };
  }
  const [before] = await db().select().from(schema.assetCategory).where(eq(schema.assetCategory.id, categoryId)).limit(1);
  if (!before) throw new ActionError("asset_category_not_found");
  const [after] = await db().update(schema.assetCategory).set(values).where(eq(schema.assetCategory.id, categoryId)).returning();
  return { before, after };
}

export type AssetInput = {
  categoryId: string;
  entityId: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchaseDate: IsoDate | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: IsoDate | null;
  condition: AssetCondition;
  location: string | null;
  notes: string | null;
};

async function categoryAndEntity(executor: Executor, categoryId: string, entityId: string) {
  const [category] = await executor.select().from(schema.assetCategory).where(eq(schema.assetCategory.id, categoryId)).limit(1);
  if (!category) throw new ActionError("asset_category_not_found");
  const [entity] = await executor.select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1);
  if (!entity) throw new ActionError("asset_entity_not_found");
  return { category, entity };
}

/** Puts a thing on the books. The code and the QR token are the register's to give, not the form's. */
export async function registerAsset(input: AssetInput, actorPersonId: string, executor: Executor = db()): Promise<AssetRow> {
  const { category, entity } = await categoryAndEntity(executor, input.categoryId, input.entityId);
  if (category.requiresSerial && !input.serial?.trim()) throw new ActionError("asset_serial_required");
  if (input.purchasePrice !== null && (!Number.isSafeInteger(input.purchasePrice) || input.purchasePrice < 0)) throw new ActionError("asset_price_invalid");
  const code = await nextAssetCode(executor, entity.code, category.code);
  const [asset] = await executor
    .insert(schema.asset)
    .values({ ...input, code, qrToken: newQrToken(), status: "in_stock", createdByPersonId: actorPersonId })
    .returning();
  await executor.insert(schema.assetEvent).values({ assetId: asset.id, type: "acquired", actorPersonId, detail: { code, name: asset.name } });
  return asset;
}

export async function findAsset(assetId: string, executor: Executor = db()): Promise<AssetRow | undefined> {
  const [row] = await executor.select().from(schema.asset).where(eq(schema.asset.id, assetId)).limit(1);
  return row;
}

/** The asset a label names. The token identifies; it does not admit — the caller still checks. */
export async function findAssetByQrToken(token: string): Promise<AssetRow | undefined> {
  const [row] = await db().select().from(schema.asset).where(eq(schema.asset.qrToken, token)).limit(1);
  return row;
}

export async function updateAsset(assetId: string, input: Partial<AssetInput>, actorPersonId: string): Promise<{ before: AssetRow; after: AssetRow }> {
  return db().transaction(async (tx) => {
    const before = await findAsset(assetId, tx);
    if (!before) throw new ActionError("asset_not_found");
    if (input.purchasePrice !== undefined && input.purchasePrice !== null && (!Number.isSafeInteger(input.purchasePrice) || input.purchasePrice < 0)) throw new ActionError("asset_price_invalid");
    const [after] = await tx.update(schema.asset).set({ ...input, updatedAt: now() }).where(eq(schema.asset.id, assetId)).returning();
    const changed = Object.keys(input).filter((field) => JSON.stringify(before[field as keyof AssetRow]) !== JSON.stringify(after[field as keyof AssetRow]));
    // The history is read more widely than the money, so it names the field and never the figure.
    if (changed.length) await tx.insert(schema.assetEvent).values({ assetId, type: "edited", actorPersonId, detail: { fields: changed } });
    return { before, after };
  });
}

/**
 * In for repair, lost, written off, or back in stock. Refuses while somebody is still holding the
 * thing: take it back first, so the handover record says what came back and in what state.
 */
export async function setAssetStatus(assetId: string, status: AssetStatus, note: string | null, actorPersonId: string): Promise<{ before: AssetRow; after: AssetRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.asset).where(eq(schema.asset.id, assetId)).limit(1).for("update");
    if (!before) throw new ActionError("asset_not_found");
    if (status === "assigned") throw new ActionError("asset_status_follows_assignment");
    const open = await openAssignment(tx, assetId);
    if (open) throw new ActionError("asset_still_out");
    const [after] = await tx
      .update(schema.asset)
      .set({ status, retiredAt: status === "disposed" || status === "lost" ? now() : null, updatedAt: now() })
      .where(eq(schema.asset.id, assetId))
      .returning();
    const type = status === "lost" ? "lost" : status === "disposed" ? "disposed" : status === "in_repair" ? "condition_changed" : "repaired";
    await tx.insert(schema.assetEvent).values({ assetId, type, actorPersonId, note, detail: { from: before.status, to: status } });
    return { before, after };
  });
}

// ── Holding, handing over and giving back ───────────────────────────────────────────────────

export async function openAssignment(executor: Executor, assetId: string): Promise<AssetAssignmentRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.assetAssignment)
    .where(and(eq(schema.assetAssignment.assetId, assetId), isNull(schema.assetAssignment.returnedAt)))
    .limit(1);
  return row;
}

export type AssignInput = {
  assetId: string;
  holderType: HolderType;
  holderId: string;
  conditionOut: AssetCondition;
  dueBack: IsoDate | null;
  purpose: string | null;
  accessories: string[];
};

async function holderColumns(executor: Executor, holderType: HolderType, holderId: string) {
  if (holderType === "person") {
    const [row] = await executor.select({ id: schema.person.id, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, holderId)).limit(1);
    if (!row) throw new ActionError("asset_holder_unknown");
    // Someone who has left cannot be handed anything.
    if (row.status === "offboarded") throw new ActionError("asset_holder_inactive");
    return { holderPersonId: holderId, holderTeamId: null, holderEntityId: null };
  }
  if (holderType === "team") {
    const [row] = await executor.select({ id: schema.orgUnit.id }).from(schema.orgUnit).where(eq(schema.orgUnit.id, holderId)).limit(1);
    if (!row) throw new ActionError("asset_holder_unknown");
    return { holderPersonId: null, holderTeamId: holderId, holderEntityId: null };
  }
  const [row] = await executor.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, holderId)).limit(1);
  if (!row) throw new ActionError("asset_holder_unknown");
  return { holderPersonId: null, holderTeamId: null, holderEntityId: holderId };
}

/** Hands a thing to somebody. The holder confirms separately that they got it. */
export async function assignAsset(input: AssignInput, actorPersonId: string, executor?: Tx): Promise<AssetAssignmentRow> {
  const run = async (tx: Tx): Promise<AssetAssignmentRow> => {
    const [asset] = await tx.select().from(schema.asset).where(eq(schema.asset.id, input.assetId)).limit(1).for("update");
    if (!asset) throw new ActionError("asset_not_found");
    if (UNASSIGNABLE_STATUSES.includes(asset.status)) throw new ActionError("asset_not_assignable");
    if (await openAssignment(tx, input.assetId)) throw new ActionError("asset_already_assigned");
    const holder = await holderColumns(tx, input.holderType, input.holderId);
    const [assignment] = await tx
      .insert(schema.assetAssignment)
      .values({
        assetId: input.assetId,
        holderType: input.holderType,
        ...holder,
        assignedByPersonId: actorPersonId,
        dueBack: input.dueBack,
        purpose: input.purpose,
        conditionOut: input.conditionOut,
        accessories: input.accessories,
      })
      .returning();
    await tx.update(schema.asset).set({ status: "assigned", condition: input.conditionOut, updatedAt: now() }).where(eq(schema.asset.id, input.assetId));
    await tx.insert(schema.assetEvent).values({ assetId: input.assetId, assignmentId: assignment.id, type: "assigned", actorPersonId, detail: { holderType: input.holderType, holderId: input.holderId } });
    return assignment;
  };
  return executor ? run(executor) : db().transaction(run);
}

/** The holder says, in their own name, that they received it (FR-AST-02). */
export async function confirmHandover(assignmentId: string, actorPersonId: string, note: string | null): Promise<AssetAssignmentRow> {
  return db().transaction(async (tx) => {
    const [assignment] = await tx.select().from(schema.assetAssignment).where(eq(schema.assetAssignment.id, assignmentId)).limit(1).for("update");
    if (!assignment) throw new ActionError("asset_assignment_not_found");
    if (assignment.returnedAt) throw new ActionError("asset_assignment_closed");
    if (assignment.handoverConfirmedAt) throw new ActionError("asset_handover_already_confirmed");
    const [after] = await tx
      .update(schema.assetAssignment)
      .set({ handoverConfirmedAt: now(), handoverNote: note, updatedAt: now() })
      .where(eq(schema.assetAssignment.id, assignmentId))
      .returning();
    await tx.insert(schema.assetEvent).values({ assetId: assignment.assetId, assignmentId, type: "handover_confirmed", actorPersonId, note });
    return after;
  });
}

export type ReturnInput = { assignmentId: string; conditionIn: AssetCondition; returnNote: string | null; /** Where it goes back to; null leaves the asset's own location. */ location?: string | null };

/** Takes a thing back. What state it came back in is recorded on the spell that just ended. */
export async function returnAsset(input: ReturnInput, actorPersonId: string, executor?: Tx): Promise<AssetAssignmentRow> {
  const run = async (tx: Tx): Promise<AssetAssignmentRow> => {
    const [assignment] = await tx.select().from(schema.assetAssignment).where(eq(schema.assetAssignment.id, input.assignmentId)).limit(1).for("update");
    if (!assignment) throw new ActionError("asset_assignment_not_found");
    if (assignment.returnedAt) throw new ActionError("asset_assignment_closed");
    const [after] = await tx
      .update(schema.assetAssignment)
      .set({ returnedAt: now(), returnedToPersonId: actorPersonId, conditionIn: input.conditionIn, returnNote: input.returnNote, updatedAt: now() })
      .where(eq(schema.assetAssignment.id, input.assignmentId))
      .returning();
    // Something that came back broken goes to the repair shelf, not the ready one.
    const status: AssetStatus = input.conditionIn === "broken" ? "in_repair" : "in_stock";
    await tx
      .update(schema.asset)
      .set({ status, condition: input.conditionIn, ...(input.location === undefined ? {} : { location: input.location }), updatedAt: now() })
      .where(eq(schema.asset.id, assignment.assetId));
    await tx.insert(schema.assetEvent).values({ assetId: assignment.assetId, assignmentId: assignment.id, type: "returned", actorPersonId, note: input.returnNote, detail: { conditionIn: input.conditionIn } });
    // Whatever was asked of anyone about this spell — the offboarding return task — is settled.
    await cancelOpenTasksOfContext(tx, { type: "asset_assignment", id: assignment.id });
    return after;
  };
  return executor ? run(executor) : db().transaction(run);
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

const holderPerson = alias(schema.person, "holder_person");

export type AssetListRow = {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  location: string | null;
  entityId: string;
  entityName: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryKind: AssetKind | null;
  holderName: string | null;
  holderType: HolderType | null;
  holderPersonId: string | null;
  assignmentId: string | null;
  handoverConfirmedAt: Date | null;
  dueBack: string | null;
  /** Only ever filled for a reader the policy allows; null is "not your business", not "unknown". */
  purchasePrice: number | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  supplier: string | null;
};

export type AssetFilter = { entityId?: string; categoryId?: string; status?: AssetStatus; holderPersonId?: string; search?: string; kind?: AssetKind };

const openOnly = and(isNull(schema.assetAssignment.returnedAt));

/** The register, as far as this reader may see it. Entity scope is a WHERE clause, not a filter in code. */
export async function listAssets(viewer: Principal, filter: AssetFilter = {}): Promise<AssetListRow[]> {
  const reach = assetReach(viewer);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const scoped = reach.all ? undefined : inArray(schema.asset.entityId, reach.entityIds);
  const search = filter.search?.trim();
  const rows = await db()
    .select({
      asset: schema.asset,
      entityName: schema.entity.shortName,
      categoryName: schema.assetCategory.name,
      categoryKind: schema.assetCategory.kind,
      assignment: schema.assetAssignment,
      holderPersonName: holderPerson.fullName,
      holderTeamName: schema.orgUnit.name,
      holderEntityName: schema.entity.shortName,
    })
    .from(schema.asset)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.asset.entityId))
    .leftJoin(schema.assetCategory, eq(schema.assetCategory.id, schema.asset.categoryId))
    .leftJoin(schema.assetAssignment, and(eq(schema.assetAssignment.assetId, schema.asset.id), openOnly))
    .leftJoin(holderPerson, eq(holderPerson.id, schema.assetAssignment.holderPersonId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.assetAssignment.holderTeamId))
    .where(
      and(
        scoped,
        filter.entityId ? eq(schema.asset.entityId, filter.entityId) : undefined,
        filter.categoryId ? eq(schema.asset.categoryId, filter.categoryId) : undefined,
        filter.kind ? eq(schema.assetCategory.kind, filter.kind) : undefined,
        filter.status ? eq(schema.asset.status, filter.status) : undefined,
        filter.holderPersonId ? eq(schema.assetAssignment.holderPersonId, filter.holderPersonId) : undefined,
        search ? sql`(${schema.asset.code} ilike ${"%" + search + "%"} or ${schema.asset.name} ilike ${"%" + search + "%"} or coalesce(${schema.asset.serial}, '') ilike ${"%" + search + "%"})` : undefined,
      ),
    )
    .orderBy(asc(schema.asset.code))
    .limit(500);

  return rows.map(({ asset, entityName, categoryName, categoryKind, assignment, holderPersonName, holderTeamName }) => {
    const money = canReadAssetMoney(viewer, asset.entityId);
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      brand: asset.brand,
      model: asset.model,
      serial: asset.serial,
      status: asset.status,
      condition: asset.condition,
      location: asset.location,
      entityId: asset.entityId,
      entityName,
      categoryId: asset.categoryId,
      categoryName,
      categoryKind,
      holderType: assignment?.holderType ?? null,
      holderPersonId: assignment?.holderPersonId ?? null,
      holderName: assignment ? (assignment.holderType === "person" ? holderPersonName : assignment.holderType === "team" ? holderTeamName : entityName) : null,
      assignmentId: assignment?.id ?? null,
      handoverConfirmedAt: assignment?.handoverConfirmedAt ?? null,
      dueBack: assignment?.dueBack ?? null,
      purchasePrice: money ? asset.purchasePrice : null,
      purchaseDate: money ? asset.purchaseDate : null,
      warrantyUntil: asset.warrantyUntil,
      supplier: money ? asset.supplier : null,
    };
  });
}

/**
 * What a sheet of labels needs, for the assets this reader keeps. The QR token lives only here and
 * on the asset's own page: it is on every list row nowhere, because nothing else has a use for it.
 */
export async function listLabelRows(viewer: Principal, filter: { entityId?: string; assetIds?: readonly string[] } = {}): Promise<{ id: string; code: string; name: string; entityName: string | null; qrToken: string }[]> {
  const reach = assetReach(viewer);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await db()
    .select({ id: schema.asset.id, code: schema.asset.code, name: schema.asset.name, qrToken: schema.asset.qrToken, entityName: schema.entity.shortName })
    .from(schema.asset)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.asset.entityId))
    .where(
      and(
        reach.all ? undefined : inArray(schema.asset.entityId, reach.entityIds),
        filter.entityId ? eq(schema.asset.entityId, filter.entityId) : undefined,
        filter.assetIds && filter.assetIds.length > 0 ? inArray(schema.asset.id, [...filter.assetIds]) : undefined,
        // Nothing written off: a label for a thing that no longer exists wastes a sticker.
        sql`${schema.asset.status} <> 'disposed'`,
      ),
    )
    .orderBy(asc(schema.asset.code))
    .limit(500);
  return rows;
}

export type AssetHistoryEntry = { id: number; type: string; at: Date; actorName: string | null; note: string | null; detail: Record<string, unknown> | null };
export type AssetSpell = AssetAssignmentRow & { holderName: string | null; assignedByName: string | null; returnedToName: string | null };
export type AssetView = { asset: AssetListRow; history: AssetHistoryEntry[]; spells: AssetSpell[]; canSeeMoney: boolean };

/** One asset with everything that ever happened to it. null = not found, or none of the viewer's business. */
export async function getAssetView(viewer: Principal, assetId: string): Promise<AssetView | null> {
  const asset = await findAsset(assetId);
  if (!asset) return null;
  const open = await openAssignment(db(), assetId);
  // Shared production gear is common property: whether the category is bookable is part of who
  // may look at the thing at all (`canViewAsset`).
  const [category] = await db().select({ bookable: schema.assetCategory.bookable }).from(schema.assetCategory).where(eq(schema.assetCategory.id, asset.categoryId)).limit(1);
  if (!canViewAsset(viewer, { entityId: asset.entityId, bookable: category?.bookable ?? false }, open?.holderPersonId ?? null)) return null;

  const actor = alias(schema.person, "actor");
  const assignedBy = alias(schema.person, "assigned_by");
  const returnedTo = alias(schema.person, "returned_to");
  const [rows, history, spells] = await Promise.all([
    listAssets(viewer, {}).then((all) => all.find((row) => row.id === assetId)),
    db()
      .select({ id: schema.assetEvent.id, type: schema.assetEvent.type, at: schema.assetEvent.at, actorName: actor.fullName, note: schema.assetEvent.note, detail: schema.assetEvent.detail })
      .from(schema.assetEvent)
      .leftJoin(actor, eq(actor.id, schema.assetEvent.actorPersonId))
      .where(eq(schema.assetEvent.assetId, assetId))
      .orderBy(desc(schema.assetEvent.id)),
    db()
      .select({ assignment: schema.assetAssignment, holderPersonName: holderPerson.fullName, holderTeamName: schema.orgUnit.name, assignedByName: assignedBy.fullName, returnedToName: returnedTo.fullName })
      .from(schema.assetAssignment)
      .leftJoin(holderPerson, eq(holderPerson.id, schema.assetAssignment.holderPersonId))
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.assetAssignment.holderTeamId))
      .leftJoin(assignedBy, eq(assignedBy.id, schema.assetAssignment.assignedByPersonId))
      .leftJoin(returnedTo, eq(returnedTo.id, schema.assetAssignment.returnedToPersonId))
      .where(eq(schema.assetAssignment.assetId, assetId))
      .orderBy(desc(schema.assetAssignment.assignedAt)),
  ]);

  // The holder of a thing sees the thing, even when the register as a whole is not theirs to read.
  const money = canReadAssetMoney(viewer, asset.entityId);
  const row: AssetListRow = rows ?? {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    serial: asset.serial,
    status: asset.status,
    condition: asset.condition,
    location: asset.location,
    entityId: asset.entityId,
    entityName: null,
    categoryId: asset.categoryId,
    categoryName: null,
    categoryKind: null,
    holderType: open?.holderType ?? null,
    holderPersonId: open?.holderPersonId ?? null,
    holderName: null,
    assignmentId: open?.id ?? null,
    handoverConfirmedAt: open?.handoverConfirmedAt ?? null,
    dueBack: open?.dueBack ?? null,
    purchasePrice: money ? asset.purchasePrice : null,
    purchaseDate: money ? asset.purchaseDate : null,
    warrantyUntil: asset.warrantyUntil,
    supplier: money ? asset.supplier : null,
  };

  return {
    asset: row,
    history,
    canSeeMoney: money,
    spells: spells.map(({ assignment, holderPersonName, holderTeamName, assignedByName, returnedToName }) => ({
      ...assignment,
      holderName: assignment.holderType === "person" ? holderPersonName : assignment.holderType === "team" ? holderTeamName : null,
      assignedByName,
      returnedToName,
    })),
  };
}

export type HeldAsset = { assignmentId: string; assetId: string; code: string; name: string; categoryName: string | null; assignedAt: Date; dueBack: string | null; conditionOut: AssetCondition; accessories: string[]; handoverConfirmedAt: Date | null };

/** What one person is holding right now. The person's own list, and their record keeper's. */
export async function listAssetsOfPerson(personId: string, executor: Executor = db()): Promise<HeldAsset[]> {
  const rows = await executor
    .select({ assignment: schema.assetAssignment, asset: schema.asset, categoryName: schema.assetCategory.name })
    .from(schema.assetAssignment)
    .innerJoin(schema.asset, eq(schema.asset.id, schema.assetAssignment.assetId))
    .leftJoin(schema.assetCategory, eq(schema.assetCategory.id, schema.asset.categoryId))
    .where(and(eq(schema.assetAssignment.holderPersonId, personId), isNull(schema.assetAssignment.returnedAt)))
    .orderBy(asc(schema.asset.code));
  return rows.map(({ assignment, asset, categoryName }) => ({
    assignmentId: assignment.id,
    assetId: asset.id,
    code: asset.code,
    name: asset.name,
    categoryName,
    assignedAt: assignment.assignedAt,
    dueBack: assignment.dueBack,
    conditionOut: assignment.conditionOut,
    accessories: assignment.accessories,
    handoverConfirmedAt: assignment.handoverConfirmedAt,
  }));
}

export async function countAssetsOfPerson(personId: string, executor: Executor = db()): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(schema.assetAssignment)
    .where(and(eq(schema.assetAssignment.holderPersonId, personId), isNull(schema.assetAssignment.returnedAt)));
  return row?.value ?? 0;
}

/** One assignment with the asset behind it, for the screens that act on a single handover. */
export async function findAssignment(assignmentId: string, executor: Executor = db()): Promise<{ assignment: AssetAssignmentRow; asset: AssetRow } | undefined> {
  const [row] = await executor
    .select({ assignment: schema.assetAssignment, asset: schema.asset })
    .from(schema.assetAssignment)
    .innerJoin(schema.asset, eq(schema.asset.id, schema.assetAssignment.assetId))
    .where(eq(schema.assetAssignment.id, assignmentId))
    .limit(1);
  return row;
}

export async function summaryByStatus(viewer: Principal): Promise<Record<AssetStatus, number>> {
  const rows = await listAssets(viewer, {});
  const tally = { in_stock: 0, assigned: 0, in_repair: 0, lost: 0, disposed: 0 } satisfies Record<AssetStatus, number>;
  for (const row of rows) tally[row.status] += 1;
  return tally;
}

// ── What the lifecycle asks of the register ─────────────────────────────────────────────────
// Core HR calls these when somebody leaves and when a termination is called off. They live here
// rather than in `core-hr` because what happens to a camera is the register's business; core-hr
// reaches them through this barrel, which is the boundary the lint rule allows.

const RETURN_TASK_KIND = "asset_return";

/**
 * Opens one task per thing a leaver is still holding, due by their last working day (FR-AST-02,
 * tied to the Phase 1 offboarding checklist). Idempotent: called again, it opens nothing new.
 *
 * Who collects it: the leaver's line manager if they have one — in practice the person the camera
 * is physically handed to — otherwise whoever keeps the register for that entity. Never the leaver
 * themselves, whose access ends with their last day, which would leave the task unanswerable.
 */
export async function openReturnTasks(tx: Tx, personId: string, lastDay: IsoDate, actorPersonId: string | null): Promise<number> {
  const held = await listAssetsOfPerson(personId, tx);
  if (held.length === 0) return 0;
  const [subject] = await tx.select({ managerId: schema.person.managerId, entityId: schema.person.primaryEntityId, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!subject) return 0;

  const existing = await tx
    .select({ contextId: schema.task.contextId })
    .from(schema.task)
    .where(and(eq(schema.task.kind, RETURN_TASK_KIND), eq(schema.task.contextType, "asset_assignment"), inArray(schema.task.status, ["todo", "in_progress"])));
  const alreadyOpen = new Set(existing.map((row) => row.contextId));

  const keepers = subject.entityId ? await listPeopleHolding("asset:manage", { entityId: subject.entityId }, { includeWildcard: false, executor: tx }) : [];
  const assignee = subject.managerId ?? keepers[0] ?? null;

  const wanted = held.filter((item) => !alreadyOpen.has(item.assignmentId));
  if (wanted.length === 0) return 0;
  await createTasks(
    tx,
    wanted.map((item) => ({
      kind: RETURN_TASK_KIND,
      title: `${item.code} — ${item.name}`,
      assigneePersonId: assignee,
      subjectPersonId: personId,
      dueDate: lastDay,
      entityId: subject.entityId,
      linkUrl: `/assets/${item.assetId}`,
      context: { type: "asset_assignment", id: item.assignmentId },
    })),
    actorPersonId,
    { notify: true },
  );
  return wanted.length;
}

/** A termination called off: the return tasks go with it. Anything already handed back stays returned. */
export async function cancelReturnTasks(tx: Tx, personId: string): Promise<number> {
  const held = await listAssetsOfPerson(personId, tx);
  let cancelled = 0;
  for (const item of held) cancelled += await cancelOpenTasksOfContext(tx, { type: "asset_assignment", id: item.assignmentId });
  return cancelled;
}

/** What a leaver still has not handed back — the offboarding screen's "still out" list. */
export async function outstandingFor(personId: string, executor: Executor = db()): Promise<HeldAsset[]> {
  return listAssetsOfPerson(personId, executor);
}

// ── Booking shared production gear (FR-AST-03) ───────────────────────────────────────────────
// Two bookings of one thing never overlap, and the database is what says so: the exclusion
// constraint `asset_booking_no_overlap` (migration 0056). Everything below checks first only so
// that the answer reads as a sentence rather than a constraint name — the check and the write are
// in one transaction, but even so the constraint is the rule and the `23P01` handler below is not
// a fallback we hope never runs: it is the path two people booking at the same instant take.

export type AssetBookingRow = typeof schema.assetBooking.$inferSelect;

/**
 * An instant as a bound parameter of a raw SQL fragment.
 *
 * Drizzle binds a `Date` happily when it knows the column, but inside a function call —
 * `tstzrange($1, $2)` — it has no column to learn the type from, and postgres.js then tries to
 * serialise the Date as a string and throws. PGlite, which the tests run on, is forgiving about
 * it; the real driver is not, which is why this was found by opening the page rather than by a
 * test. An ISO string with an explicit cast is unambiguous to both.
 */
const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** Postgres's exclusion-violation code: somebody else got the slot between our check and our insert. */
const EXCLUSION_VIOLATION = "23P01";
const isExclusionViolation = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: string }).code === EXCLUSION_VIOLATION;

export type BookingInput = { assetId: string; personId: string; startAt: Date; endAt: Date; purpose: string | null; projectRef: string | null };

/**
 * Reserves a thing for somebody. Someone who keeps the gear books straight into `confirmed`;
 * anybody else asks, and the keeper answers — but both hold the slot at once, so asking early
 * beats confirming late.
 */
export async function bookAsset(input: BookingInput, actor: { personId: string; principal: Principal }, executor?: Tx): Promise<AssetBookingRow> {
  const run = async (tx: Tx): Promise<AssetBookingRow> => {
    const [row] = await tx
      .select({ asset: schema.asset, bookable: schema.assetCategory.bookable })
      .from(schema.asset)
      .innerJoin(schema.assetCategory, eq(schema.assetCategory.id, schema.asset.categoryId))
      .where(eq(schema.asset.id, input.assetId))
      .limit(1);
    if (!row) throw new ActionError("asset_not_found");
    if (!row.bookable) throw new ActionError("asset_not_bookable");
    if (UNASSIGNABLE_STATUSES.includes(row.asset.status)) throw new ActionError("asset_not_assignable");
    if (row.asset.status === "in_repair") throw new ActionError("asset_in_repair");

    const [holder] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.personId)).limit(1);
    if (!holder) throw new ActionError("asset_holder_unknown");
    if (holder.status === "offboarded") throw new ActionError("asset_holder_inactive");

    // Said plainly before the constraint says it in Latin.
    const clash = await tx
      .select({ id: schema.assetBooking.id })
      .from(schema.assetBooking)
      .where(
        and(
          eq(schema.assetBooking.assetId, input.assetId),
          inArray(schema.assetBooking.status, [...BOOKING_HOLDS_SLOT]),
          sql`tstzrange(${schema.assetBooking.startAt}, ${schema.assetBooking.endAt}, '[)') && tstzrange(${instant(input.startAt)}, ${instant(input.endAt)}, '[)')`,
        ),
      )
      .limit(1);
    if (clash.length > 0) throw new ActionError("asset_booking_clash");

    const status: BookingStatus = canManageAssets(actor.principal, row.asset.entityId) ? "confirmed" : "requested";
    try {
      const [booking] = await tx
        .insert(schema.assetBooking)
        .values({
          assetId: input.assetId,
          personId: input.personId,
          startAt: input.startAt,
          endAt: input.endAt,
          purpose: input.purpose,
          projectRef: input.projectRef,
          status,
          createdByPersonId: actor.personId,
          ...(status === "confirmed" ? { decidedByPersonId: actor.personId, decidedAt: now() } : {}),
        })
        .returning();
      await tx.insert(schema.assetEvent).values({ assetId: input.assetId, type: "booked", actorPersonId: actor.personId, note: input.purpose, detail: { bookingId: booking.id, status, from: input.startAt.toISOString(), to: input.endAt.toISOString() } });
      return booking;
    } catch (error) {
      // Two people pressed the button at the same instant; the database picked one.
      if (isExclusionViolation(error)) throw new ActionError("asset_booking_clash");
      throw error;
    }
  };
  return executor ? run(executor) : db().transaction(run);
}

/** The keeper's answer to a request. Confirming holds the slot it already held; refusing frees it. */
export async function decideBooking(bookingId: string, decision: "confirm" | "refuse", note: string | null, actorPersonId: string): Promise<AssetBookingRow> {
  return db().transaction(async (tx) => {
    const [booking] = await tx.select().from(schema.assetBooking).where(eq(schema.assetBooking.id, bookingId)).limit(1).for("update");
    if (!booking) throw new ActionError("asset_booking_not_found");
    if (booking.status !== "requested") throw new ActionError("asset_booking_not_pending");
    const status: BookingStatus = decision === "confirm" ? "confirmed" : "cancelled";
    if (decision === "refuse" && !note?.trim()) throw new ActionError("asset_booking_reason_required");
    const [after] = await tx
      .update(schema.assetBooking)
      .set({ status, decidedByPersonId: actorPersonId, decidedAt: now(), decisionNote: note?.trim() || null, updatedAt: now() })
      .where(eq(schema.assetBooking.id, bookingId))
      .returning();
    if (decision === "refuse") {
      await tx.insert(schema.assetEvent).values({ assetId: booking.assetId, type: "booking_cancelled", actorPersonId, note: note?.trim() || null, detail: { bookingId, refused: true } });
    }
    return after;
  });
}

/** Called off by the person whose booking it is, or by the keeper. Anything not yet back is refused. */
export async function cancelBooking(bookingId: string, note: string | null, actorPersonId: string): Promise<AssetBookingRow> {
  return db().transaction(async (tx) => {
    const [booking] = await tx.select().from(schema.assetBooking).where(eq(schema.assetBooking.id, bookingId)).limit(1).for("update");
    if (!booking) throw new ActionError("asset_booking_not_found");
    if (BOOKING_CLOSED.includes(booking.status)) throw new ActionError("asset_booking_closed");
    // Gear that is out of the building is brought back, not cancelled.
    if (booking.status === "checked_out") throw new ActionError("asset_booking_checked_out");
    const [after] = await tx
      .update(schema.assetBooking)
      .set({ status: "cancelled", decidedByPersonId: actorPersonId, decidedAt: now(), decisionNote: note?.trim() || null, updatedAt: now() })
      .where(eq(schema.assetBooking.id, bookingId))
      .returning();
    await tx.insert(schema.assetEvent).values({ assetId: booking.assetId, type: "booking_cancelled", actorPersonId, note: note?.trim() || null, detail: { bookingId } });
    return after;
  });
}

export type CheckOutInput = { bookingId: string; conditionOut: AssetCondition; note: string | null };

/** The gear leaves the shelf. The asset's condition follows what was seen at the counter. */
export async function checkOutBooking(input: CheckOutInput, actorPersonId: string): Promise<AssetBookingRow> {
  return db().transaction(async (tx) => {
    const [booking] = await tx.select().from(schema.assetBooking).where(eq(schema.assetBooking.id, input.bookingId)).limit(1).for("update");
    if (!booking) throw new ActionError("asset_booking_not_found");
    if (booking.status === "requested") throw new ActionError("asset_booking_not_confirmed");
    if (booking.status !== "confirmed") throw new ActionError("asset_booking_closed");
    const [after] = await tx
      .update(schema.assetBooking)
      .set({ status: "checked_out", checkedOutAt: now(), checkedOutByPersonId: actorPersonId, conditionOut: input.conditionOut, note: input.note, updatedAt: now() })
      .where(eq(schema.assetBooking.id, input.bookingId))
      .returning();
    // Booked gear that is out is out; the register says so rather than showing it on the shelf.
    await tx.update(schema.asset).set({ status: "assigned", condition: input.conditionOut, updatedAt: now() }).where(eq(schema.asset.id, booking.assetId));
    await tx.insert(schema.assetEvent).values({ assetId: booking.assetId, type: "checked_out", actorPersonId, note: input.note, detail: { bookingId: booking.id, conditionOut: input.conditionOut } });
    return after;
  });
}

export type CheckInInput = { bookingId: string; conditionIn: AssetCondition; note: string | null };

/**
 * The gear comes back. The booking leaves the statuses that hold a slot, so whatever is left of
 * its window is free for somebody else — an early return is a real return, not a formality.
 */
export async function checkInBooking(input: CheckInInput, actorPersonId: string): Promise<AssetBookingRow> {
  return db().transaction(async (tx) => {
    const [booking] = await tx.select().from(schema.assetBooking).where(eq(schema.assetBooking.id, input.bookingId)).limit(1).for("update");
    if (!booking) throw new ActionError("asset_booking_not_found");
    if (booking.status !== "checked_out") throw new ActionError("asset_booking_not_checked_out");
    const [after] = await tx
      .update(schema.assetBooking)
      .set({ status: "returned", checkedInAt: now(), checkedInByPersonId: actorPersonId, conditionIn: input.conditionIn, note: input.note, updatedAt: now() })
      .where(eq(schema.assetBooking.id, input.bookingId))
      .returning();
    // Back on the shelf — unless it came back broken, in which case it goes to the repair bench.
    // An asset that is also assigned to somebody long-term keeps that assignment; a booking never
    // opens or closes one, so the two never fight over `status`.
    const stillHeld = await openAssignment(tx, booking.assetId);
    const status: AssetStatus = input.conditionIn === "broken" ? "in_repair" : stillHeld ? "assigned" : "in_stock";
    await tx.update(schema.asset).set({ status, condition: input.conditionIn, updatedAt: now() }).where(eq(schema.asset.id, booking.assetId));
    await tx.insert(schema.assetEvent).values({ assetId: booking.assetId, type: "checked_in", actorPersonId, note: input.note, detail: { bookingId: booking.id, conditionIn: input.conditionIn } });
    return after;
  });
}

export type BookingView = AssetBookingRow & { assetCode: string; assetName: string; assetEntityId: string; categoryName: string | null; personName: string };

const bookingColumns = {
  booking: schema.assetBooking,
  assetCode: schema.asset.code,
  assetName: schema.asset.name,
  assetEntityId: schema.asset.entityId,
  categoryName: schema.assetCategory.name,
  personName: schema.person.fullName,
};

const bookingQuery = (executor: Executor = db()) =>
  executor
    .select(bookingColumns)
    .from(schema.assetBooking)
    .innerJoin(schema.asset, eq(schema.asset.id, schema.assetBooking.assetId))
    .leftJoin(schema.assetCategory, eq(schema.assetCategory.id, schema.asset.categoryId))
    .innerJoin(schema.person, eq(schema.person.id, schema.assetBooking.personId));

const asBookingView = (row: { booking: AssetBookingRow; assetCode: string; assetName: string; assetEntityId: string; categoryName: string | null; personName: string }): BookingView => ({
  ...row.booking,
  assetCode: row.assetCode,
  assetName: row.assetName,
  assetEntityId: row.assetEntityId,
  categoryName: row.categoryName,
  personName: row.personName,
});

export type BookingFilter = { from: Date; to: Date; categoryId?: string; entityId?: string; assetId?: string; personId?: string; includeClosed?: boolean };

/**
 * The bookings a calendar draws. Bookable gear is common property (see `canViewAsset`), so this
 * is not narrowed by entity for reading — what it *is* narrowed by is the filter the screen sets.
 */
export async function listBookings(filter: BookingFilter): Promise<BookingView[]> {
  const rows = await bookingQuery()
    .where(
      and(
        eq(schema.assetCategory.bookable, true),
        filter.includeClosed ? undefined : inArray(schema.assetBooking.status, [...BOOKING_HOLDS_SLOT]),
        sql`tstzrange(${schema.assetBooking.startAt}, ${schema.assetBooking.endAt}, '[)') && tstzrange(${instant(filter.from)}, ${instant(filter.to)}, '[)')`,
        filter.categoryId ? eq(schema.asset.categoryId, filter.categoryId) : undefined,
        filter.entityId ? eq(schema.asset.entityId, filter.entityId) : undefined,
        filter.assetId ? eq(schema.assetBooking.assetId, filter.assetId) : undefined,
        filter.personId ? eq(schema.assetBooking.personId, filter.personId) : undefined,
      ),
    )
    .orderBy(asc(schema.assetBooking.startAt));
  return rows.map(asBookingView);
}

/** One booking with the thing behind it, for the screens that act on a single reservation. */
export async function findBooking(bookingId: string, executor: Executor = db()): Promise<BookingView | undefined> {
  const [row] = await bookingQuery(executor).where(eq(schema.assetBooking.id, bookingId)).limit(1);
  return row ? asBookingView(row) : undefined;
}

/** Somebody's own bookings, soonest first: what they have coming and what is still out. */
export async function listBookingsOfPerson(personId: string, executor: Executor = db()): Promise<BookingView[]> {
  const rows = await bookingQuery(executor)
    .where(and(eq(schema.assetBooking.personId, personId), inArray(schema.assetBooking.status, [...BOOKING_HOLDS_SLOT])))
    .orderBy(asc(schema.assetBooking.startAt));
  return rows.map(asBookingView);
}

/** Requests waiting for a keeper's answer, over the entities that keeper covers. */
export async function listBookingRequests(viewer: Principal): Promise<BookingView[]> {
  const reach = assetReach(viewer);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await bookingQuery()
    .where(and(eq(schema.assetBooking.status, "requested"), reach.all ? undefined : inArray(schema.asset.entityId, reach.entityIds)))
    .orderBy(asc(schema.assetBooking.startAt));
  return rows.map(asBookingView);
}

/** The bookable things a calendar offers, in the order the register lists categories. */
export async function listBookableAssets(filter: { categoryId?: string; entityId?: string } = {}): Promise<{ id: string; code: string; name: string; categoryId: string; categoryName: string; entityId: string; status: AssetStatus }[]> {
  return db()
    .select({ id: schema.asset.id, code: schema.asset.code, name: schema.asset.name, categoryId: schema.asset.categoryId, categoryName: schema.assetCategory.name, entityId: schema.asset.entityId, status: schema.asset.status })
    .from(schema.asset)
    .innerJoin(schema.assetCategory, eq(schema.assetCategory.id, schema.asset.categoryId))
    .where(
      and(
        eq(schema.assetCategory.bookable, true),
        eq(schema.assetCategory.isActive, true),
        sql`${schema.asset.status} not in ('lost', 'disposed')`,
        filter.categoryId ? eq(schema.asset.categoryId, filter.categoryId) : undefined,
        filter.entityId ? eq(schema.asset.entityId, filter.entityId) : undefined,
      ),
    )
    .orderBy(asc(schema.assetCategory.sortOrder), asc(schema.assetCategory.name), asc(schema.asset.code));
}

// ── Licences and subscriptions (FR-AST-05) ──────────────────────────────────────────────────
// The renewal dates reach the OPS tracker the same way HR's lifecycle events do: this module
// publishes *facts*, and `ops/scheduler.ts` pulls them through this barrel. Nothing here knows
// what an obligation is, and nothing in ops knows what a licence is beyond the fact's shape.

export type LicenceRow = typeof schema.licence.$inferSelect;

export type LicenceInput = {
  name: string;
  vendor: string | null;
  entityId: string;
  seats: number | null;
  seatHolderPersonIds: string[];
  costPerCycle: number | null;
  billingCycle: BillingCycle;
  renewalDate: IsoDate | null;
  autoRenews: boolean;
  ownerPersonId: string | null;
  assetId: string | null;
  accountRef: string | null;
  notes: string | null;
  status: LicenceStatus;
};

export async function saveLicence(licenceId: string | null, input: LicenceInput, actorPersonId: string): Promise<{ before: LicenceRow | null; after: LicenceRow }> {
  if (input.costPerCycle !== null && (!Number.isSafeInteger(input.costPerCycle) || input.costPerCycle < 0)) throw new ActionError("licence_cost_invalid");
  if (input.seats !== null && (!Number.isInteger(input.seats) || input.seats < 0)) throw new ActionError("licence_seats_invalid");
  // A cycle that renews needs a date to renew on, or nothing can ever be put in the tracker.
  if (CYCLE_MONTHS[input.billingCycle] !== null && !input.renewalDate) throw new ActionError("licence_renewal_date_required");
  const values = { ...input, seatHolderPersonIds: input.seatHolderPersonIds, updatedAt: now() };
  if (!licenceId) {
    const [after] = await db().insert(schema.licence).values({ ...values, createdByPersonId: actorPersonId }).returning();
    return { before: null, after };
  }
  const [before] = await db().select().from(schema.licence).where(eq(schema.licence.id, licenceId)).limit(1);
  if (!before) throw new ActionError("licence_not_found");
  const [after] = await db().update(schema.licence).set(values).where(eq(schema.licence.id, licenceId)).returning();
  return { before, after };
}

export async function findLicence(licenceId: string, executor: Executor = db()): Promise<LicenceRow | undefined> {
  const [row] = await executor.select().from(schema.licence).where(eq(schema.licence.id, licenceId)).limit(1);
  return row;
}

export type LicenceView = LicenceRow & { entityName: string | null; ownerName: string | null; assetCode: string | null; canSeeMoney: boolean };

/** The licence list, narrowed to the entities whose register the viewer keeps. */
export async function listLicences(viewer: Principal, filter: { entityId?: string; status?: LicenceStatus } = {}): Promise<LicenceView[]> {
  const reach = assetReach(viewer);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const owner = alias(schema.person, "licence_owner");
  const rows = await db()
    .select({ licence: schema.licence, entityName: schema.entity.shortName, ownerName: owner.fullName, assetCode: schema.asset.code })
    .from(schema.licence)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.licence.entityId))
    .leftJoin(owner, eq(owner.id, schema.licence.ownerPersonId))
    .leftJoin(schema.asset, eq(schema.asset.id, schema.licence.assetId))
    .where(and(reach.all ? undefined : inArray(schema.licence.entityId, reach.entityIds), filter.entityId ? eq(schema.licence.entityId, filter.entityId) : undefined, filter.status ? eq(schema.licence.status, filter.status) : undefined))
    .orderBy(asc(schema.licence.renewalDate), asc(schema.licence.name));
  return rows.map((row) => ({ ...row.licence, entityName: row.entityName, ownerName: row.ownerName, assetCode: row.assetCode, canSeeMoney: canReadAssetMoney(viewer, row.licence.entityId) }));
}

/**
 * Every renewal that falls due between `from` and `to`, one fact per occurrence.
 *
 * This is what the OPS tracker pulls (FR-AST-05: "renewals appear in the OPS tracker"). The id is
 * stable — `<licence id>:<renewal date>` — so the tracker's unique key on (template, entity,
 * period) makes generating twice a no-op, and walking the cycle forward from the stored renewal
 * date means a licence renewed years ago still produces the *next* one rather than a backlog.
 * A cancelled or expired licence produces nothing, which is how its open obligations get called off.
 */
export type LicenceRenewalFact = { id: string; licenceId: string; entityId: string; name: string; vendor: string | null; renewalDate: IsoDate; ownerPersonId: string | null; autoRenews: boolean };

export async function listLicenceRenewalFacts(from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<LicenceRenewalFact[]> {
  const rows = await executor.select().from(schema.licence).where(eq(schema.licence.status, "active"));
  const facts: LicenceRenewalFact[] = [];
  for (const row of rows) {
    const months = CYCLE_MONTHS[row.billingCycle];
    if (!row.renewalDate || months === null) continue;
    for (const date of renewalsBetween(row.renewalDate, months, from, to)) {
      facts.push({ id: `${row.id}:${date}`, licenceId: row.id, entityId: row.entityId, name: row.name, vendor: row.vendor, renewalDate: date, ownerPersonId: row.ownerPersonId, autoRenews: row.autoRenews });
    }
  }
  return facts.sort((left, right) => left.renewalDate.localeCompare(right.renewalDate));
}

/** Licence ids that no longer renew, so the tracker can call off what it opened for them. */
export async function listInactiveLicenceIds(executor: Executor = db()): Promise<string[]> {
  const rows = await executor.select({ id: schema.licence.id }).from(schema.licence).where(ne(schema.licence.status, "active"));
  return rows.map((row) => row.id);
}

export const assetsToday = (): IsoDate => todayInVietnam();
export { canReadRegister as canOpenAssetsNav };
