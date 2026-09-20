// Standing delegations (FR-PLT-22): "while I am away, my approvals go to …". They are applied when
// a request's approvers are resolved — the delegate is asked instead, and the request keeps who
// they stand in for. Requests already waiting are handed over with the ad-hoc delegate action.
import "server-only";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../notifications/service";

type Executor = Tx | ReturnType<typeof db>;
export type DelegationRow = typeof schema.approvalDelegation.$inferSelect;

/** Pure: follows delegations from one approver to whoever answers for them today. Loops and long chains end where they started. */
export function followDelegations(personId: string, next: ReadonlyMap<string, string>, blocked: ReadonlySet<string> = new Set()): string {
  let cursor = personId;
  const seen = new Set([personId]);
  for (let hop = 0; hop < 5; hop++) {
    const to = next.get(cursor);
    if (!to) return cursor;
    if (seen.has(to) || blocked.has(to)) return personId;
    seen.add(to);
    cursor = to;
  }
  return personId;
}

/**
 * Who answers instead of each approver on `day`, for this request type: approver → stand-in.
 * Only active stand-ins count, and never the requester (nobody approves their own request).
 */
export async function standIns(executor: Executor, approverIds: readonly string[], context: { requestType: string; requesterId: string; day?: IsoDate }): Promise<Map<string, string>> {
  if (approverIds.length === 0) return new Map();
  const day = context.day ?? todayInVietnam();
  const rows = await executor
    .select({ from: schema.approvalDelegation.fromPersonId, to: schema.approvalDelegation.toPersonId, types: schema.approvalDelegation.requestTypes })
    .from(schema.approvalDelegation)
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalDelegation.toPersonId))
    .where(and(isNull(schema.approvalDelegation.revokedAt), lte(schema.approvalDelegation.validFrom, day), gte(schema.approvalDelegation.validTo, day), eq(schema.person.status, "active")))
    .orderBy(desc(schema.approvalDelegation.createdAt));
  const next = new Map<string, string>();
  // Newest first: a later delegation for the same days replaces an earlier one.
  for (const row of rows) if ((!row.types || row.types.includes(context.requestType)) && !next.has(row.from)) next.set(row.from, row.to);
  const result = new Map<string, string>();
  for (const approverId of approverIds) {
    const to = followDelegations(approverId, next, new Set([context.requesterId]));
    if (to !== approverId) result.set(approverId, to);
  }
  return result;
}

export type DelegationView = DelegationRow & { fromName: string; toName: string };

/** Delegations a person gave and received, newest first. */
export async function listDelegations(personId: string): Promise<{ given: DelegationView[]; received: DelegationView[] }> {
  const from = alias(schema.person, "from_person");
  const to = alias(schema.person, "to_person");
  const query = (mine: "from" | "to") =>
    db()
      .select({ row: schema.approvalDelegation, fromName: from.fullName, toName: to.fullName })
      .from(schema.approvalDelegation)
      .innerJoin(from, eq(from.id, schema.approvalDelegation.fromPersonId))
      .innerJoin(to, eq(to.id, schema.approvalDelegation.toPersonId))
      .where(eq(mine === "from" ? schema.approvalDelegation.fromPersonId : schema.approvalDelegation.toPersonId, personId))
      .orderBy(desc(schema.approvalDelegation.validFrom))
      .limit(50);
  const [given, received] = await Promise.all([query("from"), query("to")]);
  const flat = (rows: Awaited<ReturnType<typeof query>>) => rows.map(({ row, fromName, toName }) => ({ ...row, fromName, toName }));
  return { given: flat(given), received: flat(received).filter((row) => !row.revokedAt) };
}

export type DelegationInput = { toPersonId: string; validFrom: IsoDate; validTo: IsoDate; requestTypes: string[] | null; reason: string | null };

export async function createDelegation(fromPersonId: string, input: DelegationInput): Promise<DelegationRow> {
  if (input.toPersonId === fromPersonId) throw new ActionError("delegation_self");
  if (input.validTo < input.validFrom) throw new ActionError("delegation_dates");
  if (input.validTo < todayInVietnam()) throw new ActionError("delegation_past");
  return db().transaction(async (tx) => {
    const [to] = await tx.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(and(eq(schema.person.id, input.toPersonId), eq(schema.person.status, "active"))).limit(1);
    if (!to) throw new ActionError("delegation_person_unknown");
    const [from] = await tx.select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, fromPersonId)).limit(1);
    const [row] = await tx
      .insert(schema.approvalDelegation)
      .values({ fromPersonId, toPersonId: input.toPersonId, validFrom: input.validFrom, validTo: input.validTo, requestTypes: input.requestTypes?.length ? input.requestTypes : null, reason: input.reason })
      .returning();
    await notify({ recipients: [input.toPersonId], kind: "approvals.delegated_to_you", params: { delegator: from?.fullName ?? "", from: input.validFrom, to: input.validTo }, link: "/approvals/delegation" }, tx);
    return row;
  });
}

/** Ends a delegation now. Only the person who gave it. */
export async function revokeDelegation(fromPersonId: string, id: string): Promise<DelegationRow> {
  const [row] = await db()
    .update(schema.approvalDelegation)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.approvalDelegation.id, id), eq(schema.approvalDelegation.fromPersonId, fromPersonId), isNull(schema.approvalDelegation.revokedAt)))
    .returning();
  if (!row) throw new ActionError("delegation_not_found");
  return row;
}
