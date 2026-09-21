// Kudos (FR-COM-03, v1): a thank-you from one colleague to another, tied to a company value.
// The values are rows (`company_value`), not constants. No points, no leaderboard yet.
import "server-only";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { Principal } from "../platform/rbac/policy";
import { canGiveKudos, canRemoveKudos, type KudosRecipient } from "./policy";

const { companyValue, kudos, person } = schema;
export type KudosRow = typeof schema.kudos.$inferSelect;
export type CompanyValueRow = typeof schema.companyValue.$inferSelect;

export async function listCompanyValues(options: { includeInactive?: boolean } = {}): Promise<CompanyValueRow[]> {
  return db().select().from(companyValue).where(options.includeInactive ? undefined : eq(companyValue.isActive, true)).orderBy(asc(companyValue.sortOrder), asc(companyValue.key));
}

/** Colleagues one can thank: active staff, no collaborators, not oneself. Names only. */
export async function listKudosRecipients(selfPersonId: string): Promise<{ id: string; fullName: string }[]> {
  return db().select({ id: person.id, fullName: person.fullName }).from(person).where(and(eq(person.status, "active"), ne(person.workforceType, "collaborator"), ne(person.id, selfPersonId))).orderBy(asc(person.searchName));
}

export async function findRecipient(personId: string): Promise<KudosRecipient | null> {
  const [row] = await db().select().from(person).where(eq(person.id, personId)).limit(1);
  return row ? { personId: row.id, status: row.status, workforceType: row.workforceType, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId } : null;
}

export async function giveKudos(from: { personId: string; fullName: string; principal: Principal }, input: { toPersonId: string; valueKey: string; message: string }): Promise<KudosRow> {
  const to = await findRecipient(input.toPersonId);
  if (!to || !canGiveKudos(from.principal, to)) throw new ActionError("comms_kudos_recipient");
  const [value] = await db().select().from(companyValue).where(and(eq(companyValue.key, input.valueKey), eq(companyValue.isActive, true))).limit(1);
  if (!value) throw new ActionError("comms_value_unknown");
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(kudos).values({ fromPersonId: from.personId, toPersonId: input.toPersonId, valueKey: value.key, message: input.message }).returning();
    await notify({ recipients: [input.toPersonId], kind: "comms.kudos_received", params: { name: from.fullName, value: value.nameVi }, link: "/kudos" }, tx);
    return row;
  });
}

export async function findKudos(id: string): Promise<{ row: KudosRow; to: KudosRecipient } | null> {
  const [row] = await db().select().from(kudos).where(and(eq(kudos.id, id), isNull(kudos.deletedAt))).limit(1);
  const to = row ? await findRecipient(row.toPersonId) : null;
  return row && to ? { row, to } : null;
}

export const mayRemoveKudos = (principal: Principal, found: { row: KudosRow; to: KudosRecipient }): boolean => canRemoveKudos(principal, found.row, found.to);

export async function removeKudos(id: string, actorPersonId: string): Promise<KudosRow> {
  const [row] = await db().update(kudos).set({ deletedAt: new Date(), deletedByPersonId: actorPersonId }).where(and(eq(kudos.id, id), isNull(kudos.deletedAt))).returning();
  if (!row) throw new ActionError("comms_kudos_not_found");
  return row;
}

export type KudosCard = { id: string; fromPersonId: string; fromName: string; toPersonId: string; toName: string; toEntityId: string | null; toUnitPath: readonly string[]; valueKey: string; valueNameVi: string | null; valueNameEn: string | null; message: string; createdAt: Date };

/** The wall, newest first. Staff-wide (`public_internal`); the caller keeps collaborators out. */
export async function listKudos(options: { toPersonId?: string; fromPersonId?: string; limit?: number } = {}): Promise<KudosCard[]> {
  const giver = alias(person, "giver");
  const receiver = alias(person, "receiver");
  return db()
    .select({ id: kudos.id, fromPersonId: kudos.fromPersonId, fromName: giver.fullName, toPersonId: kudos.toPersonId, toName: receiver.fullName, toEntityId: receiver.primaryEntityId, toUnitPath: receiver.orgUnitPath, valueKey: kudos.valueKey, valueNameVi: companyValue.nameVi, valueNameEn: companyValue.nameEn, message: kudos.message, createdAt: kudos.createdAt })
    .from(kudos)
    .innerJoin(giver, eq(giver.id, kudos.fromPersonId))
    .innerJoin(receiver, eq(receiver.id, kudos.toPersonId))
    .leftJoin(companyValue, eq(companyValue.key, kudos.valueKey))
    .where(and(isNull(kudos.deletedAt), options.toPersonId ? eq(kudos.toPersonId, options.toPersonId) : undefined, options.fromPersonId ? eq(kudos.fromPersonId, options.fromPersonId) : undefined))
    .orderBy(desc(kudos.createdAt))
    .limit(Math.max(1, Math.min(options.limit ?? 50, 200)));
}
