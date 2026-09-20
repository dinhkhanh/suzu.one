// Key rotation, step 3 of docs/KEY_ROTATION.md: moves every encrypted value of this module onto
// the active key. Only the small wrapped data keys change; no value is decrypted. Run by hand:
// GET /api/cron/field-keys-rewrap. A new encrypted column must be added to the list below.
import "server-only";
import { eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { SENSITIVE_TEXT_FIELDS } from "./enums";
import { changeRequestContext, contractTermsContext, dependentContext, sensitiveContext } from "./field-contexts";

export async function rewrapEncryptedFields(): Promise<{ rewrapped: number; alreadyCurrent: number }> {
  const cipher = fieldCipher();
  const tally = { rewrapped: 0, alreadyCurrent: 0 };
  // Returns the re-wrapped value, or undefined when there is nothing to do.
  const move = (stored: string | null, context: string) => {
    if (!stored) return undefined;
    if (!cipher.needsRewrap(stored)) {
      tally.alreadyCurrent++;
      return undefined;
    }
    tally.rewrapped++;
    return cipher.rewrap(stored, context);
  };
  const defined = (changes: Record<string, string | undefined>) => Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

  for (const row of await db().select().from(schema.personSensitive)) {
    const changes = defined(Object.fromEntries([...SENSITIVE_TEXT_FIELDS, "bankAccounts" as const].map((field) => [field, move(row[field], sensitiveContext(field, row.personId))])));
    if (Object.keys(changes).length) await db().update(schema.personSensitive).set(changes).where(eq(schema.personSensitive.personId, row.personId));
  }
  for (const row of await db().select({ id: schema.contract.id, salaryTerms: schema.contract.salaryTerms }).from(schema.contract)) {
    const salaryTerms = move(row.salaryTerms, contractTermsContext(row.id));
    if (salaryTerms) await db().update(schema.contract).set({ salaryTerms }).where(eq(schema.contract.id, row.id));
  }
  for (const row of await db().select().from(schema.dependent)) {
    const changes = defined({ idNumber: move(row.idNumber, dependentContext("idNumber", row.id)), taxCode: move(row.taxCode, dependentContext("taxCode", row.id)) });
    if (Object.keys(changes).length) await db().update(schema.dependent).set(changes).where(eq(schema.dependent.id, row.id));
  }
  // Change requests keep their proposed restricted values encrypted for good (they are history).
  for (const row of await db().select({ id: schema.approvalRequest.id, payloadEnc: schema.approvalRequest.payloadEnc }).from(schema.approvalRequest).where(eq(schema.approvalRequest.type, "profile_change"))) {
    const payloadEnc = move(row.payloadEnc, changeRequestContext(row.id));
    if (payloadEnc) await db().update(schema.approvalRequest).set({ payloadEnc }).where(eq(schema.approvalRequest.id, row.id));
  }
  return tally;
}
