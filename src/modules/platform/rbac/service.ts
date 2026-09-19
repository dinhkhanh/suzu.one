import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Does this person hold any role grant, current or future? */
export async function holdsRoleGrants(personId: string): Promise<boolean> {
  const [row] = await db().select({ id: schema.roleAssignment.id }).from(schema.roleAssignment).where(eq(schema.roleAssignment.personId, personId)).limit(1);
  return !!row;
}
