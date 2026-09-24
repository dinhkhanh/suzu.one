// Applies the real SQL migrations to an in-process Postgres (PGlite) and checks database-level guarantees.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const client = new PGlite({ extensions: { btree_gist } });
const db = drizzle(client, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("migrations", () => {
  it("creates shared departments (no entity) and entity-specific ones", async () => {
    const [entity] = await db.insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
    await db.insert(schema.orgUnit).values([
      { code: "HR", name: "Human Resources" },
      { code: "SZM-STUDIO", name: "Studio", entityId: entity.id },
    ]);
    const departments = await db.select().from(schema.orgUnit);
    expect(departments.filter((d) => d.entityId === null)).toHaveLength(1);
    expect(departments.filter((d) => d.entityId === entity.id)).toHaveLength(1);
  });

  it("rejects duplicate work emails", async () => {
    const values = { fullName: "Trần Lan", searchName: "tran lan", workEmail: "lan@suzu.group" };
    await db.insert(schema.person).values(values);
    await expect(db.insert(schema.person).values(values)).rejects.toThrow();
  });

  it("keeps one employment per person at a time, and allows a rehire after the previous period ends", async () => {
    const [entity] = await db.insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
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

  it("keeps read functions in the private `app` schema, callable by the owner only", async () => {
    const functions = await client.query<{ name: string; acl: string | null }>(
      `SELECT p.proname AS name, array_to_string(p.proacl, ',') AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'`,
    );
    expect(functions.rows.length).toBeGreaterThan(0);
    // No ACL means the default, which lets PUBLIC execute; "=X/" is an explicit grant to PUBLIC.
    expect(functions.rows.filter((row) => row.acl === null || /(^|,)=X\//.test(row.acl)).map((row) => row.name)).toEqual([]);
    const schemaAcl = await client.query<{ acl: string | null }>(`SELECT array_to_string(nspacl, ',') AS acl FROM pg_namespace WHERE nspname = 'app'`);
    expect(schemaAcl.rows[0].acl ?? "").not.toMatch(/(^|,)=U/);
  });

  it("pins the search_path of every function it defines, extensions aside (Supabase lint 0011)", async () => {
    const unpinned = await client.query<{ name: string }>(
      `SELECT n.nspname || '.' || p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'app')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`,
    );
    expect(unpinned.rows.map((row) => row.name)).toEqual([]);
  });

  // The org-unit tree (FR-PLT-16): the database, not the application, keeps `path` and the two
  // derived placement columns true — including when a unit is moved to a different parent.
  describe("the org-unit tree", () => {
    const unit = async (name: string, parentId: string | null, kind: "department" | "team" = "team") =>
      (await db.insert(schema.orgUnit).values({ name, kind, parentId }).returning())[0];

    it("writes the path from the parent, and refuses a unit inside itself", async () => {
      const marketing = await unit("Marketing", null, "department");
      const social = await unit("Social", marketing.id);
      const editing = await unit("Video editing", social.id);
      expect(editing.path).toEqual([marketing.id, social.id, editing.id]);
      // The database refuses it; drizzle wraps the message, so the reason is on the cause.
      const loop = await db.update(schema.orgUnit).set({ parentId: editing.id }).where(eq(schema.orgUnit.id, marketing.id)).catch((error: Error) => error);
      expect(String((loop as Error & { cause?: Error }).cause ?? loop)).toMatch(/inside itself/);
    });

    it("moves a subtree, and takes its people with it", async () => {
      const [creative, media] = await Promise.all([unit("Creative", null, "department"), unit("Media", null, "department")]);
      const design = await unit("Design", creative.id);
      const ui = await unit("UI", design.id);
      const [person] = await db.insert(schema.person).values({ fullName: "Đỗ Minh", searchName: "do minh", orgUnitId: ui.id }).returning();
      expect(person.orgUnitPath).toEqual([creative.id, design.id, ui.id]);
      // The derived columns: the deepest unit of each kind on the way down.
      expect([person.departmentId, person.teamId]).toEqual([creative.id, ui.id]);

      await db.update(schema.orgUnit).set({ parentId: media.id }).where(eq(schema.orgUnit.id, design.id));
      const [movedUi] = await db.select().from(schema.orgUnit).where(eq(schema.orgUnit.id, ui.id));
      expect(movedUi.path).toEqual([media.id, design.id, ui.id]);
      const [moved] = await db.select().from(schema.person).where(eq(schema.person.id, person.id));
      expect(moved.orgUnitPath).toEqual([media.id, design.id, ui.id]);
      expect(moved.departmentId).toBe(media.id);
    });

    it("clears a person's placement with their unit, and refuses a unit that does not exist", async () => {
      const [person] = await db.insert(schema.person).values({ fullName: "Vũ Hà", searchName: "vu ha" }).returning();
      expect([person.orgUnitPath, person.departmentId, person.teamId]).toEqual([[], null, null]);
      await expect(db.update(schema.person).set({ orgUnitId: "00000000-0000-4000-8000-00000000dead" }).where(eq(schema.person.id, person.id))).rejects.toThrow();
    });

    it("gives a unit at most one space of its own", async () => {
      const team = await unit("Studio", null, "department");
      const space = { name: "Studio", description: null, icon: null, ownerUnitId: team.id };
      await db.insert(schema.kbSpace).values({ ...space, key: "studio" });
      await expect(db.insert(schema.kbSpace).values({ ...space, key: "studio-2" })).rejects.toThrow();
    });
  });

  it("keeps the audit log append-only", async () => {
    await db.insert(schema.auditLog).values({ action: "test.event" });
    await expect(client.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(client.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
    await expect(client.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
    expect(await db.select().from(schema.auditLog)).toHaveLength(1);
  });
});
