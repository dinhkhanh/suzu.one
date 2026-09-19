import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { normalizeEmail, type PersonAccessState } from "../auth/sign-in-policy";

export type PersonRow = typeof schema.person.$inferSelect;

export async function findPersonByEmail(email: string): Promise<PersonRow | undefined> {
  const [row] = await db().select().from(schema.person).where(eq(schema.person.workEmail, normalizeEmail(email))).limit(1);
  return row;
}

export function accessStateOf(person: PersonRow | undefined): PersonAccessState {
  return person?.status ?? "none";
}

/** First sign-in of an address listed in BOOTSTRAP_OWNER_EMAILS: create the person and the group-wide Owner grant. */
export async function createBootstrapOwner(input: { email: string; name: string }): Promise<PersonRow> {
  return db().transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.person)
      .values({
        fullName: input.name,
        searchName: toSearchKey(input.name),
        workEmail: normalizeEmail(input.email),
        workforceType: "employee",
        status: "active",
      })
      .returning();
    await tx.insert(schema.roleAssignment).values({ personId: created.id, role: "owner", scopeType: "group" });
    return created;
  });
}
