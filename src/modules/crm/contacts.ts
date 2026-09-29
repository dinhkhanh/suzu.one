// Contacts (FR-CRM-02, 07): the people at a client. Personal data of people outside the company
// (PDPL): the details are read only by the account's team and the sellers over it
// (`canWorkAccount`); everyone else who may see the account reads a name, a title and a decision
// role — enough to record who decided — and nothing else. Never cached, never sent to the AI model.
//
// Erasure on request blanks every detail and keeps the name, because signed records (a biên bản
// nghiệm thu, a client decision) quote it as text and must stay what was signed.
import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { likelyDuplicateContacts } from "./engine/account";
import type { DecisionRole } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type ContactRow = typeof schema.crmContact.$inferSelect;

/** What anyone who may see the account reads of a contact. */
export type ContactName = Pick<ContactRow, "id" | "clientId" | "fullName" | "title" | "decisionRole" | "isPrimary" | "status" | "brandIds">;
/** The whole record, for the account team. */
export type ContactView = ContactName & { details: Pick<ContactRow, "email" | "phone" | "zalo" | "preferredChannel" | "birthday" | "notes" | "source" | "lawfulBasis" | "erasedAt" | "createdAt"> | null };

export function shapeContact(row: ContactRow, seesDetails: boolean): ContactView {
  const { id, clientId, fullName, title, decisionRole, isPrimary, status, brandIds, email, phone, zalo, preferredChannel, birthday, notes, source, lawfulBasis, erasedAt, createdAt } = row;
  return { id, clientId, fullName, title, decisionRole, isPrimary, status, brandIds, details: seesDetails ? { email, phone, zalo, preferredChannel, birthday, notes, source, lawfulBasis, erasedAt, createdAt } : null };
}

/** An account's contacts, primary first, then active ones by name; people who left last. */
export async function listContacts(clientId: string, seesDetails: boolean, executor: Executor = db()): Promise<ContactView[]> {
  const rows = await executor
    .select()
    .from(schema.crmContact)
    .where(eq(schema.crmContact.clientId, clientId))
    .orderBy(sql`${schema.crmContact.status} = 'left'`, sql`${schema.crmContact.isPrimary} desc`, asc(schema.crmContact.searchName));
  return rows.map((row) => shapeContact(row, seesDetails));
}

/**
 * Who on the client's side a PJM form may name (FR-CRM-46) — the client decision's "decided by",
 * the acceptance's signer, the brief's contacts: the active contacts of the client's account (for a
 * brand, its parent's contacts that serve it). Names and titles only, never how to reach them; the
 * form still stores the name as text, so an erased contact never breaks a signed record.
 */
export async function contactChoicesFor(clientId: string | null | undefined): Promise<{ name: string; title: string | null }[]> {
  if (!clientId) return [];
  const account = sql`coalesce(${schema.workClient.parentId}, ${schema.workClient.id})`;
  return db()
    .select({ name: schema.crmContact.fullName, title: schema.crmContact.title })
    .from(schema.workClient)
    .innerJoin(schema.crmContact, sql`${schema.crmContact.clientId} = ${account}`)
    .where(
      and(
        eq(schema.workClient.id, clientId),
        eq(schema.crmContact.status, "active"),
        isNull(schema.crmContact.erasedAt),
        sql`(${schema.workClient.parentId} is null or cardinality(${schema.crmContact.brandIds}) = 0 or ${schema.workClient.id} = any(${schema.crmContact.brandIds}))`,
      ),
    )
    .orderBy(sql`${schema.crmContact.isPrimary} desc`, asc(schema.crmContact.searchName), asc(schema.crmContact.id));
}

export async function findContact(contactId: string, executor: Executor = db()): Promise<ContactRow | undefined> {
  const [row] = await executor.select().from(schema.crmContact).where(eq(schema.crmContact.id, contactId)).limit(1);
  return row;
}

export type ContactInput = {
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  zalo: string | null;
  decisionRole: DecisionRole | null;
  isPrimary: boolean;
  preferredChannel: string | null;
  birthday: string | null;
  notes: string | null;
  source: string;
  lawfulBasis: string;
  status: "active" | "left";
  brandIds: string[];
};

async function checkBrands(executor: Executor, clientId: string, brandIds: readonly string[]): Promise<void> {
  if (brandIds.length === 0) return;
  const rows = await executor.select({ id: schema.workClient.id }).from(schema.workClient).where(and(inArray(schema.workClient.id, [...brandIds]), eq(schema.workClient.parentId, clientId)));
  if (rows.length !== new Set(brandIds).size) throw new ActionError("contact_brand_invalid");
}

/**
 * A new contact, or a change to one. A new contact that probably duplicates another of the same
 * account is refused with the candidates until the person confirms. One primary contact per
 * account: making one primary makes the others not.
 */
export async function saveContact(clientId: string, contactId: string | null, input: ContactInput, actorPersonId: string, options: { confirmDuplicate?: boolean } = {}): Promise<{ before: ContactRow | null; after: ContactRow }> {
  return db().transaction(async (tx) => {
    await checkBrands(tx, clientId, input.brandIds);
    const before = contactId ? ((await findContact(contactId, tx)) ?? null) : null;
    if (contactId && (!before || before.clientId !== clientId)) throw new ActionError("contact_not_found");
    if (before?.erasedAt) throw new ActionError("contact_erased");
    if (!contactId && !options.confirmDuplicate) {
      const existing = await tx.select({ id: schema.crmContact.id, fullName: schema.crmContact.fullName, email: schema.crmContact.email, phone: schema.crmContact.phone }).from(schema.crmContact).where(and(eq(schema.crmContact.clientId, clientId), isNull(schema.crmContact.erasedAt)));
      const duplicates = likelyDuplicateContacts(input, existing);
      if (duplicates.length) throw new ActionError("contact_duplicate", { duplicates: existing.filter((row) => duplicates.includes(row.id)).map((row) => ({ id: row.id, fullName: row.fullName })) });
    }
    const values = { ...input, email: input.email?.trim().toLowerCase() || null, searchName: toSearchKey(input.fullName) };
    if (input.isPrimary) await tx.update(schema.crmContact).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(schema.crmContact.clientId, clientId), eq(schema.crmContact.isPrimary, true), contactId ? ne(schema.crmContact.id, contactId) : undefined));
    if (!contactId) {
      const [after] = await tx.insert(schema.crmContact).values({ ...values, clientId, createdByPersonId: actorPersonId }).returning();
      return { before: null, after };
    }
    const [after] = await tx.update(schema.crmContact).set({ ...values, updatedAt: new Date() }).where(eq(schema.crmContact.id, contactId)).returning();
    return { before, after };
  });
}

/**
 * Erasure on the contact's request (PDPL): every detail blanked, the name kept for the signed
 * records that quote it, the contact marked left and taken off deals. Cannot be undone.
 */
export async function eraseContact(contactId: string): Promise<{ before: ContactRow; after: ContactRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmContact).where(eq(schema.crmContact.id, contactId)).limit(1).for("update");
    if (!before) throw new ActionError("contact_not_found");
    if (before.erasedAt) throw new ActionError("contact_erased");
    const [after] = await tx
      .update(schema.crmContact)
      .set({ email: null, phone: null, zalo: null, birthday: null, notes: null, title: null, preferredChannel: null, brandIds: [], isPrimary: false, status: "left", erasedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.crmContact.id, contactId))
      .returning();
    await tx.delete(schema.crmDealContact).where(eq(schema.crmDealContact.contactId, contactId));
    // Activities keep their subject (what was done) but lose the link to the person.
    await tx.update(schema.crmActivity).set({ contactId: null, updatedAt: new Date() }).where(eq(schema.crmActivity.contactId, contactId));
    return { before, after };
  });
}

/** Contacts across accounts matching a name, email or phone — for the people who may read them. */
export async function searchContacts(clientIds: readonly string[], q: string, limit = 50): Promise<ContactRow[]> {
  if (clientIds.length === 0 || !q.trim()) return [];
  const key = `%${toSearchKey(q)}%`;
  const raw = `%${q.trim().toLowerCase()}%`;
  return db()
    .select()
    .from(schema.crmContact)
    .where(and(inArray(schema.crmContact.clientId, [...clientIds]), isNull(schema.crmContact.erasedAt), sql`(${schema.crmContact.searchName} like ${key} or lower(coalesce(${schema.crmContact.email}, '')) like ${raw} or coalesce(${schema.crmContact.phone}, '') like ${raw})`))
    .orderBy(asc(schema.crmContact.searchName))
    .limit(limit);
}
