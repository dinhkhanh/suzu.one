// Digital assets (FR-AST-07, 08): the pages, channels, ad accounts, websites and business accounts
// the company owns or runs for a client, who answers for each, and who may get into it.
//
// Three things here are not like the equipment register:
//   · Several people use one asset at the same time, so access is a row per person
//     (`digital_asset_access`) with a level, not one open assignment. One open row per person per
//     asset is a partial unique index; the check in code is for a decent message.
//   · Nothing is a credential. The register says what the account is registered under and where
//     its password is kept — and when somebody who knew a shared password loses their access, it
//     says the password has to change, until somebody records that it has.
//   · The directory of `staff` assets is reference data read by every task form that names where
//     its output goes, so it sits in the shared cache under one key. Restricted assets, and
//     everything about who holds access, are read from Postgres.
import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createTranslator } from "next-intl";
import { cache } from "react";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { cancelOpenTasksOfContext, createTasks } from "@/modules/platform/tasks-engine/service";
import vi from "../../../messages/vi.json";
import { ACCESS_OPEN, type AccessLevel, type AccessMethod, type AccessStatus, type DigitalKind, type DigitalOwnership, type DigitalPlatform, type DigitalStatus, type DigitalVisibility } from "./enums";
import { assetReach, canReadDigitalSecrets, canRunDigitalAsset, canViewDigitalAsset } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type DigitalAssetRow = typeof schema.digitalAsset.$inferSelect;
export type DigitalAccessRow = typeof schema.digitalAssetAccess.$inferSelect;

const now = () => new Date();
const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;

/** What an offboarding task is called: written once, in the company's working language, as task titles are. */
const taskTitle = createTranslator({ locale: "vi", messages: vi, namespace: "assets.offboarding" });

export const digitalAssetLink = (assetId: string) => `/assets/digital/${assetId}`;

// ── The directory ───────────────────────────────────────────────────────────────────────────

/** What everybody may know about a `staff` asset: enough to name it as where a piece of work goes. */
export type DigitalDirectoryEntry = {
  id: string;
  kind: DigitalKind;
  platform: DigitalPlatform;
  name: string;
  handle: string | null;
  url: string | null;
  entityId: string;
  clientId: string | null;
  ownerPersonId: string | null;
  status: DigitalStatus;
};

const DIRECTORY_KEY = "assets:digital-directory";

const loadDirectory = (from: Executor): Promise<DigitalDirectoryEntry[]> =>
  from
    .select({
      id: schema.digitalAsset.id,
      kind: schema.digitalAsset.kind,
      platform: schema.digitalAsset.platform,
      name: schema.digitalAsset.name,
      handle: schema.digitalAsset.handle,
      url: schema.digitalAsset.url,
      entityId: schema.digitalAsset.entityId,
      clientId: schema.digitalAsset.clientId,
      ownerPersonId: schema.digitalAsset.ownerPersonId,
      status: schema.digitalAsset.status,
    })
    .from(schema.digitalAsset)
    .where(eq(schema.digitalAsset.visibility, "staff"))
    // A total order, so the stored array is the same whoever fills the cache.
    .orderBy(asc(schema.digitalAsset.platform), asc(schema.digitalAsset.name), asc(schema.digitalAsset.id));

// Once per request, however many pickers and chip rows ask (React's cache), then the shared cache.
const cachedDirectory = cache((): Promise<DigitalDirectoryEntry[]> => cached(DIRECTORY_KEY, TTL.reference, () => loadDirectory(db())));

/**
 * Every `staff` asset, retired ones included (a finished task still names the page it was for).
 * Inside a transaction pass it, and the rows come from that transaction, not the cache.
 */
const staffDirectory = (executor?: Executor): Promise<DigitalDirectoryEntry[]> => (executor ? loadDirectory(executor) : cachedDirectory());

/** The directory a picker offers: `staff` assets, without the retired ones unless asked. */
export async function listDigitalDirectory(options: { includeRetired?: boolean; executor?: Executor } = {}): Promise<DigitalDirectoryEntry[]> {
  const rows = await staffDirectory(options.executor);
  return options.includeRetired ? rows : rows.filter((row) => row.status !== "retired");
}

/** Every writer of `digital_asset` calls this once its change has committed. */
export const invalidateDigitalDirectory = (): Promise<void> => invalidate(DIRECTORY_KEY);

// ── Registering and editing ─────────────────────────────────────────────────────────────────

export type DigitalAssetInput = {
  kind: DigitalKind;
  platform: DigitalPlatform;
  name: string;
  handle: string | null;
  url: string | null;
  entityId: string;
  ownership: DigitalOwnership;
  clientId: string | null;
  ownerPersonId: string | null;
  visibility: DigitalVisibility;
  status: DigitalStatus;
  loginIdentity: string | null;
  recoveryContact: string | null;
  credentialLocation: string | null;
  notes: string | null;
};

export async function findDigitalAsset(assetId: string, executor: Executor = db()): Promise<DigitalAssetRow | undefined> {
  const [row] = await executor.select().from(schema.digitalAsset).where(eq(schema.digitalAsset.id, assetId)).limit(1);
  return row;
}

async function lockDigitalAsset(tx: Tx, assetId: string): Promise<DigitalAssetRow> {
  const [row] = await tx.select().from(schema.digitalAsset).where(eq(schema.digitalAsset.id, assetId)).limit(1).for("update");
  if (!row) throw new ActionError("digital_asset_not_found");
  return row;
}

async function personNamed(executor: Executor, personId: string): Promise<{ id: string; fullName: string; status: string }> {
  const [row] = await executor.select({ id: schema.person.id, fullName: schema.person.fullName, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row) throw new ActionError("digital_person_unknown");
  return row;
}

/**
 * Puts a digital asset on the books, or changes one. Retiring it ends every open grant and request:
 * a page that no longer exists has nobody to let in. A new owner is told, and whatever handover the
 * old owner's departure had asked for is settled.
 */
export async function saveDigitalAsset(assetId: string | null, input: DigitalAssetInput, actorPersonId: string): Promise<{ before: DigitalAssetRow | null; after: DigitalAssetRow }> {
  if (input.url && !/^https:\/\//i.test(input.url)) throw new ActionError("digital_asset_url_invalid");
  if (input.ownership === "client" && !input.clientId) throw new ActionError("digital_asset_client_required");
  const result = await db().transaction(async (tx) => {
    const before = assetId ? await lockDigitalAsset(tx, assetId) : null;
    const [entity] = await tx.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
    if (!entity) throw new ActionError("asset_entity_not_found");
    if (input.clientId) {
      const [client] = await tx.select({ id: schema.workClient.id }).from(schema.workClient).where(eq(schema.workClient.id, input.clientId)).limit(1);
      if (!client) throw new ActionError("digital_asset_client_unknown");
    }
    const ownerChanged = input.ownerPersonId !== (before?.ownerPersonId ?? null);
    // Someone who has left cannot be made to answer for anything; one who already does stays named until replaced.
    if (input.ownerPersonId && ownerChanged && (await personNamed(tx, input.ownerPersonId)).status === "offboarded") throw new ActionError("digital_person_inactive");

    const values = { ...input, updatedAt: now() };
    const [after] = before
      ? await tx.update(schema.digitalAsset).set(values).where(eq(schema.digitalAsset.id, before.id)).returning()
      : await tx
          .insert(schema.digitalAsset)
          .values({ ...values, createdByPersonId: actorPersonId })
          .returning();

    if (before && ownerChanged) await cancelOpenTasksOfContext(tx, { type: OWNER_CONTEXT, id: before.id });
    if (after.ownerPersonId && ownerChanged && after.ownerPersonId !== actorPersonId) {
      await notify({ recipients: [after.ownerPersonId], kind: "approvals.digital_asset_entrusted", params: { asset: after.name }, link: digitalAssetLink(after.id) }, tx);
    }
    if (before && before.status !== "retired" && after.status === "retired") {
      const ended = await tx
        .update(schema.digitalAssetAccess)
        .set({ status: sql`case when ${schema.digitalAssetAccess.status} = 'active' then 'revoked' else 'declined' end`, endedAt: now(), endedByPersonId: actorPersonId, endNote: taskTitle("retiredNote"), updatedAt: now() })
        .where(and(eq(schema.digitalAssetAccess.digitalAssetId, before.id), inArray(schema.digitalAssetAccess.status, [...ACCESS_OPEN])))
        .returning({ id: schema.digitalAssetAccess.id });
      // Whatever an offboarding had asked about any of them is settled — in one statement, not one per grant.
      if (ended.length) {
        await tx
          .update(schema.task)
          .set({ status: "cancelled", updatedAt: now() })
          .where(
            and(
              eq(schema.task.contextType, ACCESS_CONTEXT),
              inArray(
                schema.task.contextId,
                ended.map((row) => row.id),
              ),
              inArray(schema.task.status, [...OPEN_TASK]),
            ),
          );
      }
    }
    return { before, after };
  });
  await invalidateDigitalDirectory();
  return result;
}

/** The password was changed after somebody who knew it lost their access: the flag comes down. */
export async function markCredentialsRotated(assetId: string): Promise<{ before: DigitalAssetRow; after: DigitalAssetRow }> {
  return db().transaction(async (tx) => {
    const before = await lockDigitalAsset(tx, assetId);
    const [after] = await tx.update(schema.digitalAsset).set({ rotationDueSince: null, credentialsRotatedAt: now(), updatedAt: now() }).where(eq(schema.digitalAsset.id, assetId)).returning();
    return { before, after };
  });
}

// ── Access ──────────────────────────────────────────────────────────────────────────────────

export async function findDigitalAccess(accessId: string, executor: Executor = db()): Promise<{ access: DigitalAccessRow; asset: DigitalAssetRow } | undefined> {
  const [row] = await executor
    .select({ access: schema.digitalAssetAccess, asset: schema.digitalAsset })
    .from(schema.digitalAssetAccess)
    .innerJoin(schema.digitalAsset, eq(schema.digitalAsset.id, schema.digitalAssetAccess.digitalAssetId))
    .where(eq(schema.digitalAssetAccess.id, accessId))
    .limit(1);
  return row;
}

/** Whether the person holds an open grant or request on the asset — part of who may see it at all. */
export async function openAccessOf(assetId: string, personId: string, executor: Executor = db()): Promise<DigitalAccessRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.digitalAssetAccess)
    .where(and(eq(schema.digitalAssetAccess.digitalAssetId, assetId), eq(schema.digitalAssetAccess.personId, personId), inArray(schema.digitalAssetAccess.status, [...ACCESS_OPEN])))
    .limit(1);
  return row;
}

export type GrantInput = { assetId: string; personId: string; level: AccessLevel; method: AccessMethod; expiresOn: IsoDate | null; note: string | null };

/**
 * Lets a person in, at a level. If they had asked, this is the answer to their request; if they
 * already hold access, it changes the level — and when that moves them off the shared login, the
 * password they still know has to change.
 */
export async function grantDigitalAccess(input: GrantInput, actorPersonId: string): Promise<{ access: DigitalAccessRow; asset: DigitalAssetRow; outcome: "granted" | "approved" | "changed" }> {
  return db().transaction(async (tx) => {
    const asset = await lockDigitalAsset(tx, input.assetId);
    if (asset.status === "retired") throw new ActionError("digital_asset_retired");
    if ((await personNamed(tx, input.personId)).status === "offboarded") throw new ActionError("digital_person_inactive");
    const open = await openAccessOf(input.assetId, input.personId, tx);
    const granted = { level: input.level, method: input.method, expiresOn: input.expiresOn, status: "active" as AccessStatus, decidedByPersonId: actorPersonId, decidedAt: now(), updatedAt: now() };

    if (open?.status === "active") {
      const [access] = await tx
        .update(schema.digitalAssetAccess)
        .set({ ...granted, note: input.note ?? open.note })
        .where(eq(schema.digitalAssetAccess.id, open.id))
        .returning();
      if (open.method === "shared_login" && input.method !== "shared_login") await flagRotation(tx, asset);
      return { access, asset, outcome: "changed" as const };
    }
    try {
      const [access] = open
        ? await tx
            .update(schema.digitalAssetAccess)
            .set({ ...granted, grantedAt: now() })
            .where(eq(schema.digitalAssetAccess.id, open.id))
            .returning()
        : await tx
            .insert(schema.digitalAssetAccess)
            .values({ digitalAssetId: input.assetId, personId: input.personId, ...granted, note: input.note, grantedAt: now() })
            .returning();
      if (input.personId !== actorPersonId) {
        await notify(
          {
            recipients: [input.personId],
            kind: open ? "approvals.digital_access_decided" : "approvals.digital_access_granted",
            params: open ? { asset: asset.name, outcome: "approved" } : { asset: asset.name },
            link: digitalAssetLink(asset.id),
          },
          tx,
        );
      }
      return { access, asset, outcome: open ? ("approved" as const) : ("granted" as const) };
    } catch (error) {
      // Two keepers granted the same person at the same instant; the database kept one.
      if (isUniqueViolation(error)) throw new ActionError("digital_access_already_open");
      throw error;
    }
  });
}

/** Whoever answers a request: the owner; with no owner, the keepers of that entity's register. */
async function deciders(tx: Executor, asset: DigitalAssetRow): Promise<string[]> {
  if (asset.ownerPersonId) return [asset.ownerPersonId];
  return listPeopleHolding("asset:manage", { entityId: asset.entityId }, { includeWildcard: false, executor: tx });
}

/** Somebody asks to be let in. The request holds the pair: asking twice is refused, not queued. */
export async function requestDigitalAccess(input: { assetId: string; level: AccessLevel; note: string | null }, actorPersonId: string): Promise<{ access: DigitalAccessRow; asset: DigitalAssetRow }> {
  return db().transaction(async (tx) => {
    const asset = await lockDigitalAsset(tx, input.assetId);
    if (asset.status === "retired") throw new ActionError("digital_asset_retired");
    if (await openAccessOf(input.assetId, actorPersonId, tx)) throw new ActionError("digital_access_already_open");
    const requester = await personNamed(tx, actorPersonId);
    try {
      const [access] = await tx.insert(schema.digitalAssetAccess).values({ digitalAssetId: input.assetId, personId: actorPersonId, level: input.level, status: "requested", note: input.note, requestedAt: now() }).returning();
      const recipients = (await deciders(tx, asset)).filter((personId) => personId !== actorPersonId);
      await notify({ recipients, kind: "approvals.digital_access_requested", params: { requester: requester.fullName, asset: asset.name }, link: digitalAssetLink(asset.id) }, tx);
      return { access, asset };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ActionError("digital_access_already_open");
      throw error;
    }
  });
}

export type DecideAccessInput = { accessId: string; decision: "approve" | "decline"; level: AccessLevel | null; method: AccessMethod | null; expiresOn: IsoDate | null; note: string | null };

/** The owner's answer to a request. Approving may set a different level than the one asked for. */
export async function decideDigitalAccess(input: DecideAccessInput, actorPersonId: string): Promise<{ before: DigitalAccessRow; after: DigitalAccessRow; asset: DigitalAssetRow }> {
  return db().transaction(async (tx) => {
    const found = await findDigitalAccess(input.accessId, tx);
    if (!found) throw new ActionError("digital_access_not_found");
    const asset = await lockDigitalAsset(tx, found.asset.id);
    const [before] = await tx.select().from(schema.digitalAssetAccess).where(eq(schema.digitalAssetAccess.id, input.accessId)).limit(1).for("update");
    if (before.status !== "requested") throw new ActionError("digital_access_not_pending");
    if (input.decision === "decline" && !input.note?.trim()) throw new ActionError("digital_access_reason_required");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: now(), updatedAt: now() };
    const [after] =
      input.decision === "approve"
        ? await tx
            .update(schema.digitalAssetAccess)
            .set({ ...decided, status: "active", level: input.level ?? before.level, method: input.method ?? before.method, expiresOn: input.expiresOn, grantedAt: now() })
            .where(eq(schema.digitalAssetAccess.id, before.id))
            .returning()
        : await tx
            .update(schema.digitalAssetAccess)
            .set({ ...decided, status: "declined", endedAt: now(), endedByPersonId: actorPersonId, endNote: input.note?.trim() ?? null })
            .where(eq(schema.digitalAssetAccess.id, before.id))
            .returning();
    if (before.personId !== actorPersonId) {
      await notify({ recipients: [before.personId], kind: "approvals.digital_access_decided", params: { asset: asset.name, outcome: input.decision === "approve" ? "approved" : "rejected" }, link: digitalAssetLink(asset.id) }, tx);
    }
    return { before, after, asset };
  });
}

/** Somebody who knew the shared password is out: it has to change. The first such date is kept. */
async function flagRotation(tx: Executor, asset: DigitalAssetRow): Promise<void> {
  if (asset.rotationDueSince) return;
  await tx.update(schema.digitalAsset).set({ rotationDueSince: now(), updatedAt: now() }).where(eq(schema.digitalAsset.id, asset.id));
}

/**
 * Takes access away, or withdraws a request that was never answered. Whatever an offboarding had
 * asked of anyone about this grant is settled with it.
 */
export async function endDigitalAccess(accessId: string, note: string | null, actorPersonId: string, executor?: Tx): Promise<{ before: DigitalAccessRow; after: DigitalAccessRow; asset: DigitalAssetRow }> {
  const run = async (tx: Tx) => {
    const found = await findDigitalAccess(accessId, tx);
    if (!found) throw new ActionError("digital_access_not_found");
    const asset = await lockDigitalAsset(tx, found.asset.id);
    const [before] = await tx.select().from(schema.digitalAssetAccess).where(eq(schema.digitalAssetAccess.id, accessId)).limit(1).for("update");
    if (!ACCESS_OPEN.includes(before.status)) throw new ActionError("digital_access_closed");
    const wasActive = before.status === "active";
    const [after] = await tx
      .update(schema.digitalAssetAccess)
      .set({ status: wasActive ? "revoked" : "declined", endedAt: now(), endedByPersonId: actorPersonId, endNote: note?.trim() || null, updatedAt: now() })
      .where(eq(schema.digitalAssetAccess.id, accessId))
      .returning();
    if (wasActive && before.method === "shared_login") await flagRotation(tx, asset);
    await cancelOpenTasksOfContext(tx, { type: ACCESS_CONTEXT, id: accessId });
    if (wasActive && before.personId !== actorPersonId) {
      await notify({ recipients: [before.personId], kind: "approvals.digital_access_revoked", params: { asset: asset.name }, link: digitalAssetLink(asset.id) }, tx);
    }
    return { before, after, asset };
  };
  return executor ? run(executor) : db().transaction(run);
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

const ownerPerson = alias(schema.person, "digital_owner");
const myAccess = alias(schema.digitalAssetAccess, "my_access");

export type DigitalAssetListRow = {
  id: string;
  kind: DigitalKind;
  platform: DigitalPlatform;
  name: string;
  handle: string | null;
  url: string | null;
  entityId: string;
  entityName: string | null;
  ownership: DigitalOwnership;
  clientId: string | null;
  clientName: string | null;
  ownerPersonId: string | null;
  ownerName: string | null;
  visibility: DigitalVisibility;
  status: DigitalStatus;
  /** People who hold access now. */
  people: number;
  /** The viewer's own open grant or request, if any. */
  mine: { status: AccessStatus; level: AccessLevel } | null;
  /** Whether the viewer runs the asset; the two figures below are theirs alone. */
  runs: boolean;
  waiting: number;
  rotationDue: boolean;
};

export type DigitalFilter = { platform?: DigitalPlatform; kind?: DigitalKind; entityId?: string; status?: DigitalStatus; search?: string; /** Only what the viewer holds access to or answers for. */ mine?: boolean };

/**
 * Which assets exist for this reader, as a WHERE clause: every `staff` one, everything in the
 * entities whose register they keep, what they answer for, and what they hold access to. Needs the
 * `my_access` join.
 */
function visibleCondition(viewer: Principal) {
  const reach = assetReach(viewer);
  if (reach.all) return undefined;
  const me = viewer.personId;
  return sql`(${schema.digitalAsset.visibility} = 'staff'${reach.entityIds.length ? sql` or ${inArray(schema.digitalAsset.entityId, reach.entityIds)}` : sql``}${me ? sql` or ${schema.digitalAsset.ownerPersonId} = ${me} or ${myAccess.id} is not null` : sql``})`;
}

/** Whether the viewer runs the row, in SQL — the same rule as `canRunDigitalAsset`. */
function runsCondition(viewer: Principal) {
  const reach = assetReach(viewer);
  if (reach.all) return sql`true`;
  const me = viewer.personId;
  return sql`(${reach.entityIds.length ? inArray(schema.digitalAsset.entityId, reach.entityIds) : sql`false`}${me ? sql` or ${schema.digitalAsset.ownerPersonId} = ${me}` : sql``})`;
}

const myAccessJoin = (viewer: Principal) => and(eq(myAccess.digitalAssetId, schema.digitalAsset.id), eq(myAccess.personId, viewer.personId ?? sql`null`), inArray(myAccess.status, [...ACCESS_OPEN]));

/** The directory page: every asset this reader may see, with who answers for it and how many people are in. */
export async function listDigitalAssets(viewer: Principal, filter: DigitalFilter = {}): Promise<DigitalAssetListRow[]> {
  if (!viewer.personId && !assetReach(viewer).all) return [];
  const search = filter.search?.trim();
  const rows = await db()
    .select({
      asset: schema.digitalAsset,
      entityName: schema.entity.shortName,
      clientName: schema.workClient.name,
      ownerName: ownerPerson.fullName,
      mineStatus: myAccess.status,
      mineLevel: myAccess.level,
      people: sql<number>`(select count(*)::int from digital_asset_access x where x.digital_asset_id = ${schema.digitalAsset.id} and x.status = 'active')`,
      waiting: sql<number>`(select count(*)::int from digital_asset_access x where x.digital_asset_id = ${schema.digitalAsset.id} and x.status = 'requested')`,
    })
    .from(schema.digitalAsset)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.digitalAsset.entityId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.digitalAsset.clientId))
    .leftJoin(ownerPerson, eq(ownerPerson.id, schema.digitalAsset.ownerPersonId))
    .leftJoin(myAccess, myAccessJoin(viewer))
    .where(
      and(
        visibleCondition(viewer),
        filter.platform ? eq(schema.digitalAsset.platform, filter.platform) : undefined,
        filter.kind ? eq(schema.digitalAsset.kind, filter.kind) : undefined,
        filter.entityId ? eq(schema.digitalAsset.entityId, filter.entityId) : undefined,
        // Retired assets leave the list unless they are asked for by name.
        filter.status ? eq(schema.digitalAsset.status, filter.status) : sql`${schema.digitalAsset.status} <> 'retired'`,
        filter.mine && viewer.personId ? sql`(${schema.digitalAsset.ownerPersonId} = ${viewer.personId} or ${myAccess.id} is not null)` : undefined,
        search ? sql`(${schema.digitalAsset.name} ilike ${"%" + search + "%"} or coalesce(${schema.digitalAsset.handle}, '') ilike ${"%" + search + "%"})` : undefined,
      ),
    )
    .orderBy(asc(schema.digitalAsset.platform), asc(schema.digitalAsset.name), asc(schema.digitalAsset.id))
    .limit(500);

  return rows.map(({ asset, entityName, clientName, ownerName, mineStatus, mineLevel, people, waiting }) => {
    const runs = canRunDigitalAsset(viewer, asset);
    return {
      id: asset.id,
      kind: asset.kind,
      platform: asset.platform,
      name: asset.name,
      handle: asset.handle,
      url: asset.url,
      entityId: asset.entityId,
      entityName,
      ownership: asset.ownership,
      clientId: asset.clientId,
      clientName,
      ownerPersonId: asset.ownerPersonId,
      ownerName,
      visibility: asset.visibility,
      status: asset.status,
      people: Number(people),
      mine: mineStatus && mineLevel ? { status: mineStatus, level: mineLevel } : null,
      runs,
      waiting: runs ? Number(waiting) : 0,
      rotationDue: runs && !!asset.rotationDueSince,
    };
  });
}

export type DigitalSummary = { total: number; mine: number; waiting: number; rotationDue: number };

/** The page's figures, counted over everything in reach rather than the rows on screen. */
export async function summariseDigitalAssets(viewer: Principal): Promise<DigitalSummary> {
  if (!viewer.personId && !assetReach(viewer).all) return { total: 0, mine: 0, waiting: 0, rotationDue: 0 };
  const runs = runsCondition(viewer);
  const [row] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      mine: sql<number>`count(*) filter (where ${myAccess.status} = 'active')::int`,
      waiting: sql<number>`coalesce(sum((select count(*) from digital_asset_access x where x.digital_asset_id = ${schema.digitalAsset.id} and x.status = 'requested')) filter (where ${runs}), 0)::int`,
      rotationDue: sql<number>`count(*) filter (where ${schema.digitalAsset.rotationDueSince} is not null and ${runs})::int`,
    })
    .from(schema.digitalAsset)
    .leftJoin(myAccess, myAccessJoin(viewer))
    .where(and(visibleCondition(viewer), sql`${schema.digitalAsset.status} <> 'retired'`));
  return { total: Number(row?.total ?? 0), mine: Number(row?.mine ?? 0), waiting: Number(row?.waiting ?? 0), rotationDue: Number(row?.rotationDue ?? 0) };
}

export type DigitalAccessView = {
  id: string;
  personId: string;
  personName: string;
  level: AccessLevel;
  /** null = not the reader's business: how somebody gets in says who knows the password. */
  method: AccessMethod | null;
  status: AccessStatus;
  note: string | null;
  requestedAt: Date | null;
  grantedAt: Date | null;
  expiresOn: string | null;
  decidedByName: string | null;
  endedAt: Date | null;
  endedByPersonId: string | null;
  endedByName: string | null;
  endNote: string | null;
};

export type DigitalAssetView = {
  asset: DigitalAssetListRow;
  /** null unless the reader runs the asset. */
  secrets: { loginIdentity: string | null; recoveryContact: string | null; credentialLocation: string | null; notes: string | null; rotationDueSince: Date | null; credentialsRotatedAt: Date | null } | null;
  clientId: string | null;
  /** Who is in now. */
  access: DigitalAccessView[];
  /** Requests waiting for an answer: all of them for whoever runs the asset, only their own for anybody else. */
  requests: DigitalAccessView[];
  /** Grants that ended, newest first — for whoever runs the asset. */
  history: DigitalAccessView[];
  canRun: boolean;
};

/** One asset with its people. null = not found, or none of the reader's business — the same answer. */
export async function getDigitalAssetView(viewer: Principal, assetId: string): Promise<DigitalAssetView | null> {
  const [found] = await db()
    .select({ asset: schema.digitalAsset, entityName: schema.entity.shortName, clientName: schema.workClient.name, ownerName: ownerPerson.fullName })
    .from(schema.digitalAsset)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.digitalAsset.entityId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.digitalAsset.clientId))
    .leftJoin(ownerPerson, eq(ownerPerson.id, schema.digitalAsset.ownerPersonId))
    .where(eq(schema.digitalAsset.id, assetId))
    .limit(1);
  if (!found) return null;
  const { asset } = found;

  const holder = alias(schema.person, "access_holder");
  const decider = alias(schema.person, "access_decider");
  const ender = alias(schema.person, "access_ender");
  const rows = await db()
    .select({ access: schema.digitalAssetAccess, personName: holder.fullName, decidedByName: decider.fullName, endedByName: ender.fullName })
    .from(schema.digitalAssetAccess)
    .innerJoin(holder, eq(holder.id, schema.digitalAssetAccess.personId))
    .leftJoin(decider, eq(decider.id, schema.digitalAssetAccess.decidedByPersonId))
    .leftJoin(ender, eq(ender.id, schema.digitalAssetAccess.endedByPersonId))
    .where(eq(schema.digitalAssetAccess.digitalAssetId, assetId))
    .orderBy(asc(holder.fullName), desc(schema.digitalAssetAccess.createdAt))
    .limit(500);

  const me = viewer.personId;
  const mine = rows.find((row) => row.access.personId === me && ACCESS_OPEN.includes(row.access.status))?.access ?? null;
  if (!canViewDigitalAsset(viewer, asset, !!mine)) return null;
  const canRun = canRunDigitalAsset(viewer, asset);

  const view = ({ access, personName, decidedByName, endedByName }: (typeof rows)[number]): DigitalAccessView => ({
    id: access.id,
    personId: access.personId,
    personName,
    level: access.level,
    method: canRun || access.personId === me ? access.method : null,
    status: access.status,
    note: canRun || access.personId === me ? access.note : null,
    requestedAt: access.requestedAt,
    grantedAt: access.grantedAt,
    expiresOn: access.expiresOn,
    decidedByName,
    endedAt: access.endedAt,
    endedByPersonId: access.endedByPersonId,
    endedByName,
    endNote: canRun || access.personId === me ? access.endNote : null,
  });
  const active = rows.filter((row) => row.access.status === "active");
  const requested = rows.filter((row) => row.access.status === "requested");

  return {
    asset: {
      id: asset.id,
      kind: asset.kind,
      platform: asset.platform,
      name: asset.name,
      handle: asset.handle,
      url: asset.url,
      entityId: asset.entityId,
      entityName: found.entityName,
      ownership: asset.ownership,
      clientId: asset.clientId,
      clientName: found.clientName,
      ownerPersonId: asset.ownerPersonId,
      ownerName: found.ownerName,
      visibility: asset.visibility,
      status: asset.status,
      people: active.length,
      mine: mine ? { status: mine.status, level: mine.level } : null,
      runs: canRun,
      waiting: canRun ? requested.length : 0,
      rotationDue: canRun && !!asset.rotationDueSince,
    },
    secrets: canReadDigitalSecrets(viewer, asset)
      ? {
          loginIdentity: asset.loginIdentity,
          recoveryContact: asset.recoveryContact,
          credentialLocation: asset.credentialLocation,
          notes: asset.notes,
          rotationDueSince: asset.rotationDueSince,
          credentialsRotatedAt: asset.credentialsRotatedAt,
        }
      : null,
    clientId: asset.clientId,
    access: active.map(view),
    requests: requested.filter((row) => canRun || row.access.personId === me).map(view),
    history: canRun
      ? rows
          .filter((row) => !ACCESS_OPEN.includes(row.access.status))
          .sort((left, right) => (right.access.endedAt?.getTime() ?? 0) - (left.access.endedAt?.getTime() ?? 0))
          .slice(0, 50)
          .map(view)
      : [],
    canRun,
  };
}

export type PersonDigitalAccess = {
  accessId: string;
  assetId: string;
  name: string;
  platform: DigitalPlatform;
  kind: DigitalKind;
  handle: string | null;
  url: string | null;
  level: AccessLevel;
  method: AccessMethod;
  status: AccessStatus;
  grantedAt: Date | null;
  requestedAt: Date | null;
  expiresOn: string | null;
};

/**
 * What one person can get into, and what they have asked for. Their own list, and their record
 * keeper's — restricted assets included, because taking a leaver's access away starts from here.
 */
export async function listDigitalAccessOfPerson(personId: string, executor: Executor = db()): Promise<PersonDigitalAccess[]> {
  const rows = await executor
    .select({ access: schema.digitalAssetAccess, asset: schema.digitalAsset })
    .from(schema.digitalAssetAccess)
    .innerJoin(schema.digitalAsset, eq(schema.digitalAsset.id, schema.digitalAssetAccess.digitalAssetId))
    .where(and(eq(schema.digitalAssetAccess.personId, personId), inArray(schema.digitalAssetAccess.status, [...ACCESS_OPEN])))
    .orderBy(asc(schema.digitalAsset.platform), asc(schema.digitalAsset.name));
  return rows.map(({ access, asset }) => ({
    accessId: access.id,
    assetId: asset.id,
    name: asset.name,
    platform: asset.platform,
    kind: asset.kind,
    handle: asset.handle,
    url: asset.url,
    level: access.level,
    method: access.method,
    status: access.status,
    grantedAt: access.grantedAt,
    requestedAt: access.requestedAt,
    expiresOn: access.expiresOn,
  }));
}

/** The assets a person answers for, that are still running. */
export async function listDigitalAssetsOwnedBy(personId: string, executor: Executor = db()): Promise<{ id: string; name: string; platform: DigitalPlatform; kind: DigitalKind }[]> {
  return executor
    .select({ id: schema.digitalAsset.id, name: schema.digitalAsset.name, platform: schema.digitalAsset.platform, kind: schema.digitalAsset.kind })
    .from(schema.digitalAsset)
    .where(and(eq(schema.digitalAsset.ownerPersonId, personId), sql`${schema.digitalAsset.status} <> 'retired'`))
    .orderBy(asc(schema.digitalAsset.platform), asc(schema.digitalAsset.name));
}

/**
 * Which of these people hold active access to which of these assets — one query for a whole task
 * page ("the assignee cannot get into the page this post is for"). Keys are `<assetId>:<personId>`.
 */
export async function activeAccessPairs(assetIds: readonly string[], personIds: readonly string[], executor: Executor = db()): Promise<Set<string>> {
  const assets = [...new Set(assetIds)];
  const people = [...new Set(personIds)];
  if (assets.length === 0 || people.length === 0) return new Set();
  const rows = await executor
    .select({ assetId: schema.digitalAssetAccess.digitalAssetId, personId: schema.digitalAssetAccess.personId })
    .from(schema.digitalAssetAccess)
    .where(and(inArray(schema.digitalAssetAccess.digitalAssetId, assets), inArray(schema.digitalAssetAccess.personId, people), eq(schema.digitalAssetAccess.status, "active")));
  return new Set(rows.map((row) => `${row.assetId}:${row.personId}`));
}

// ── What the lifecycle asks of the register ─────────────────────────────────────────────────

const ACCESS_CONTEXT = "digital_asset_access";
const OWNER_CONTEXT = "digital_asset_owner";
const REVOKE_TASK_KIND = "digital_access_revoke";
const HANDOVER_TASK_KIND = "digital_asset_handover";
const OPEN_TASK = ["todo", "in_progress"] as const;

export type LeaverContext = { personId: string; lastDay: IsoDate; managerId: string | null; entityId: string | null; /** Whoever keeps the register of the leaver's entity. */ keepers: readonly string[] };

/**
 * When somebody leaves: one task per grant they hold ("take the access away"), given to the person
 * who answers for that asset, and one per asset they answer for themselves ("name a new owner"),
 * given to their manager — never to the leaver, whose own access ends with their last day.
 * Idempotent: called again, it opens nothing new.
 */
export async function openDigitalOffboardingTasks(tx: Tx, leaver: LeaverContext, actorPersonId: string | null): Promise<number> {
  const [grants, owned] = await Promise.all([
    tx
      .select({ id: schema.digitalAssetAccess.id, assetId: schema.digitalAsset.id, name: schema.digitalAsset.name, ownerPersonId: schema.digitalAsset.ownerPersonId, entityId: schema.digitalAsset.entityId })
      .from(schema.digitalAssetAccess)
      .innerJoin(schema.digitalAsset, eq(schema.digitalAsset.id, schema.digitalAssetAccess.digitalAssetId))
      .where(and(eq(schema.digitalAssetAccess.personId, leaver.personId), eq(schema.digitalAssetAccess.status, "active"))),
    tx
      .select({ id: schema.digitalAsset.id, name: schema.digitalAsset.name, entityId: schema.digitalAsset.entityId })
      .from(schema.digitalAsset)
      .where(and(eq(schema.digitalAsset.ownerPersonId, leaver.personId), sql`${schema.digitalAsset.status} <> 'retired'`)),
  ]);
  if (grants.length === 0 && owned.length === 0) return 0;

  const existing = await tx
    .select({ contextType: schema.task.contextType, contextId: schema.task.contextId })
    .from(schema.task)
    .where(and(inArray(schema.task.contextType, [ACCESS_CONTEXT, OWNER_CONTEXT]), inArray(schema.task.contextId, [...grants.map((row) => row.id), ...owned.map((row) => row.id)]), inArray(schema.task.status, [...OPEN_TASK])));
  const alreadyOpen = new Set(existing.map((row) => `${row.contextType}:${row.contextId}`));
  const fallback = leaver.managerId ?? leaver.keepers[0] ?? null;

  const tasks = [
    ...grants
      .filter((row) => !alreadyOpen.has(`${ACCESS_CONTEXT}:${row.id}`))
      .map((row) => ({
        kind: REVOKE_TASK_KIND,
        title: taskTitle("revokeAccess", { asset: row.name }),
        // Whoever answers for the asset takes the access away — unless that is the leaver.
        assigneePersonId: row.ownerPersonId && row.ownerPersonId !== leaver.personId ? row.ownerPersonId : fallback,
        subjectPersonId: leaver.personId,
        dueDate: leaver.lastDay,
        entityId: row.entityId,
        linkUrl: digitalAssetLink(row.assetId),
        context: { type: ACCESS_CONTEXT, id: row.id },
      })),
    ...owned
      .filter((row) => !alreadyOpen.has(`${OWNER_CONTEXT}:${row.id}`))
      .map((row) => ({
        kind: HANDOVER_TASK_KIND,
        title: taskTitle("handOverAsset", { asset: row.name }),
        assigneePersonId: fallback,
        subjectPersonId: leaver.personId,
        dueDate: leaver.lastDay,
        entityId: row.entityId,
        linkUrl: digitalAssetLink(row.id),
        context: { type: OWNER_CONTEXT, id: row.id },
      })),
  ];
  if (tasks.length === 0) return 0;
  await createTasks(tx, tasks, actorPersonId, { notify: true });
  return tasks.length;
}

/** A termination called off: the tasks go with it. Access already taken away stays taken away. */
export async function cancelDigitalOffboardingTasks(tx: Tx, personId: string): Promise<number> {
  const result = await tx
    .update(schema.task)
    .set({ status: "cancelled", updatedAt: now() })
    .where(and(inArray(schema.task.kind, [REVOKE_TASK_KIND, HANDOVER_TASK_KIND]), eq(schema.task.subjectPersonId, personId), inArray(schema.task.status, [...OPEN_TASK])))
    .returning({ id: schema.task.id });
  return result.length;
}
