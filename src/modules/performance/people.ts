// The reporting lines, read once per request: who sits where and who is above whom. Performance
// data is personal tier and follows the management chain (policy.ts), so every read needs it. The
// whole directory is a few columns of at most a thousand rows (NFR-PRF-05) — walking it in memory
// is simpler, and testable, where a recursive query per person would not be.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { chainAbove, type PersonContext } from "./policy";

type Executor = Tx | ReturnType<typeof db>;

// The two derived placement columns ride along: goals still hang on a department or a team.
export type DirectoryPerson = PersonContext & { fullName: string; workforceType: string; status: string; departmentId: string | null; teamId: string | null };
export type Directory = ReadonlyMap<string, DirectoryPerson>;

export async function loadDirectory(executor: Executor = db()): Promise<Directory> {
  const rows = await executor
    .select({ id: schema.person.id, fullName: schema.person.fullName, managerId: schema.person.managerId, entityId: schema.person.primaryEntityId, unitPath: schema.person.orgUnitPath, departmentId: schema.person.departmentId, teamId: schema.person.teamId, workforceType: schema.person.workforceType, status: schema.person.status })
    .from(schema.person);
  const managerOf = new Map(rows.map((row) => [row.id, row.managerId]));
  return new Map(rows.map((row) => [row.id, { personId: row.id, fullName: row.fullName, managerId: row.managerId, entityId: row.entityId, unitPath: row.unitPath, departmentId: row.departmentId, teamId: row.teamId, workforceType: row.workforceType, status: row.status, chainAbove: chainAbove(managerOf, row.id) }]));
}

/** Everyone below `managerId`, at any depth. */
export const reportsBelow = (directory: Directory, managerId: string): DirectoryPerson[] => [...directory.values()].filter((person) => person.chainAbove.includes(managerId));

/** Does anyone report to this person? Decides whether the team tab is worth showing — navigation only. */
export async function hasReports(personId: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor.select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.managerId, personId)).limit(1);
  return !!row;
}
