// Applies the real SQL migrations to an in-process Postgres (PGlite) and checks database-level guarantees.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const client = new PGlite({ extensions: { btree_gist } });
const db = drizzle(client, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("migrations", () => {
  it("creates shared departments (no entity) and entity-specific ones", async () => {
    const [entity] = await db.insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
    await db.insert(schema.department).values([
      { code: "HR", name: "Human Resources" },
      { code: "SZM-STUDIO", name: "Studio", entityId: entity.id },
    ]);
    const departments = await db.select().from(schema.department);
    expect(departments.filter((d) => d.entityId === null)).toHaveLength(1);
    expect(departments.filter((d) => d.entityId === entity.id)).toHaveLength(1);
  });

  it("rejects duplicate work emails", async () => {
    const values = { fullName: "Trần Lan", searchName: "tran lan", workEmail: "lan@suzu.group" };
    await db.insert(schema.person).values(values);
    await expect(db.insert(schema.person).values(values)).rejects.toThrow();
  });

  it("keeps one employment per person at a time, and allows a rehire after the previous period ends", async () => {
    const [entity] = await db.insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
    const [person] = await db.insert(schema.person).values({ fullName: "Lê Minh", searchName: "le minh" }).returning();
    const base = { personId: person.id, entityId: entity.id, seniorityDate: "2024-01-01" };
    await db.insert(schema.employment).values({ ...base, employeeCode: "SZC-0001", startDate: "2024-01-01", endDate: "2024-12-31" });
    await expect(
      db.insert(schema.employment).values({ ...base, employeeCode: "SZC-0002", startDate: "2024-12-31" }),
    ).rejects.toThrow();
    await db.insert(schema.employment).values({ ...base, employeeCode: "SZC-0002", startDate: "2025-01-01" });
    // The open-ended period blocks anything after it.
    await expect(
      db.insert(schema.employment).values({ ...base, employeeCode: "SZC-0003", startDate: "2026-01-01" }),
    ).rejects.toThrow();
  });

  it("numbers employees per entity: a code is unique within an entity, reusable across entities", async () => {
    const entities = await db
      .insert(schema.entity)
      .values([
        { code: "E1", legalName: "One", shortName: "One" },
        { code: "E2", legalName: "Two", shortName: "Two" },
      ])
      .returning();
    const people = await db
      .insert(schema.person)
      .values(["a", "b", "c"].map((name) => ({ fullName: name, searchName: name })))
      .returning();
    const row = (personIndex: number, entityIndex: number) => ({
      personId: people[personIndex].id,
      entityId: entities[entityIndex].id,
      employeeCode: "0001",
      startDate: "2025-01-01",
      seniorityDate: "2025-01-01",
    });
    await db.insert(schema.employment).values([row(0, 0), row(1, 1)]);
    await expect(db.insert(schema.employment).values(row(2, 0))).rejects.toThrow();
  });

  it("rejects overlapping primary assignments, but lets secondary ones run alongside", async () => {
    const [employment] = await db.select().from(schema.employment).limit(1);
    const base = { employmentId: employment.id, workforceType: "employee" as const };
    await db.insert(schema.assignment).values({ ...base, validFrom: "2024-01-01", validTo: "2024-06-30" });
    await db.insert(schema.assignment).values({ ...base, validFrom: "2024-07-01" });
    await expect(db.insert(schema.assignment).values({ ...base, validFrom: "2024-06-30", validTo: "2024-06-30" })).rejects.toThrow();
    await expect(db.insert(schema.assignment).values({ ...base, validFrom: "2025-01-01" })).rejects.toThrow();
    await db.insert(schema.assignment).values({ ...base, kind: "secondary", validFrom: "2024-03-01" });
  });

  it("lets several people have no work email", async () => {
    await db.insert(schema.person).values([
      { fullName: "CTV Một", searchName: "ctv mot" },
      { fullName: "CTV Hai", searchName: "ctv hai" },
    ]);
  });

  it("has row-level security enabled on every table, so Supabase's public API roles see nothing", async () => {
    const unprotected = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    expect(unprotected.rows.map((row) => row.relname)).toEqual([]);
  });

  it("keeps the audit log append-only", async () => {
    await db.insert(schema.auditLog).values({ action: "test.event" });
    await expect(client.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(client.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
    await expect(client.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
    expect(await db.select().from(schema.auditLog)).toHaveLength(1);
  });
});
