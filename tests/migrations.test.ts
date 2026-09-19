// Applies the real SQL migrations to an in-process Postgres (PGlite) and checks database-level guarantees.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const client = new PGlite();
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
