// HR's view of balances: the people within the viewer's `leave:manage` reach with what they have left.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { matchesReach, permissionReach, type Principal } from "@/modules/platform/rbac/policy";
import { type Balance, getBalances } from "./ledger";

export type BalanceRow = { personId: string; fullName: string; entityName: string | null; departmentName: string | null; status: string; balances: Balance[] };

export async function listBalancesForAdmin(principal: Principal, year: number, filter: { entityId?: string | null } = {}): Promise<BalanceRow[]> {
  const reach = permissionReach(principal, "leave:manage");
  const rows = await db()
    .select({ person: schema.person, entityName: schema.entity.shortName, departmentName: schema.orgUnit.name })
    .from(schema.person)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.person.primaryEntityId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId))
    .where(and(inArray(schema.person.status, ["active", "suspended"]), filter.entityId ? eq(schema.person.primaryEntityId, filter.entityId) : undefined))
    .orderBy(asc(schema.person.searchName));
  const visible = rows.filter(({ person }) => matchesReach(reach, { personId: person.id, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId }));
  const balances = await getBalances(visible.map((row) => row.person.id), year);
  return visible.map(({ person, entityName, departmentName }) => ({ personId: person.id, fullName: person.fullName, entityName, departmentName, status: person.status, balances: balances.get(person.id) ?? [] }));
}
