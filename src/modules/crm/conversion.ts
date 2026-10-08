// Converting a lead (FR-CRM-10): in one step, the account (found, or made — the duplicate guard
// applies), the contact (found, or made from what the lead recorded), and the deal, with the lead's
// follow-ups carried over to it. The referrer hears that their enquiry became a deal.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { createAccount, findAccount, type NewAccountInput } from "./accounts";
import { createDeal, type DealInput, type DealRow } from "./deals";
import { findLead, markConvertedIn } from "./leads";

export type ConversionInput = {
  account: { clientId: string } | { create: NewAccountInput };
  /** An existing contact of the account, a new one from the lead's details (with its PDPL basis), or none. */
  contact: { contactId: string } | { create: { source: string; lawfulBasis: string } } | null;
  deal: DealInput & { stageId: string | null; ownerPersonId: string };
};

export async function convertLead(leadId: string, input: ConversionInput, actorPersonId: string): Promise<{ deal: DealRow; clientId: string; contactId: string | null }> {
  const lead = await findLead(leadId);
  if (!lead) throw new ActionError("lead_not_found");
  if (lead.status === "converted" || lead.status === "disqualified") throw new ActionError("lead_closed");
  const clientId = "clientId" in input.account ? input.account.clientId : (await createAccount(input.account.create)).client.id;
  const account = await findAccount(clientId);
  if (!account) throw new ActionError("account_not_found");

  return db().transaction(async (tx) => {
    let contactId: string | null = null;
    if (input.contact && "contactId" in input.contact) {
      const [contact] = await tx.select({ clientId: schema.crmContact.clientId }).from(schema.crmContact).where(eq(schema.crmContact.id, input.contact.contactId)).limit(1);
      if (!contact || contact.clientId !== account.client.id) throw new ActionError("contact_not_found");
      contactId = input.contact.contactId;
    } else if (input.contact && lead.contactName) {
      const [contact] = await tx
        .insert(schema.crmContact)
        .values({
          clientId: account.client.id,
          fullName: lead.contactName,
          searchName: toSearchKey(lead.contactName),
          title: lead.contactTitle,
          email: lead.email,
          phone: lead.phone,
          source: input.contact.create.source,
          lawfulBasis: input.contact.create.lawfulBasis,
          createdByPersonId: actorPersonId,
        })
        .returning();
      contactId = contact.id;
    }
    const deal = await createDeal({ ...input.deal, clientId: account.client.id, leadId, source: input.deal.source ?? (lead.source as DealInput["source"]), contacts: contactId ? [{ contactId, role: null }] : [] }, actorPersonId, tx);
    await markConvertedIn(tx, leadId, deal.id, account.client.id);
    // What was planned with the enquiry carries on with the deal.
    await tx.update(schema.crmActivity).set({ dealId: deal.id, clientId: account.client.id, updatedAt: new Date() }).where(eq(schema.crmActivity.leadId, leadId));
    return { deal, clientId: account.client.id, contactId };
  });
}
