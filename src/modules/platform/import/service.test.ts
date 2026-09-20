// The two actions every import consists of, with a column marked `sensitive`: the waiting batch
// holds no plain text of it, the preview masks it, and the commit still gets the real value.
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}` }) }));
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { type Column, text } from "./engine/table";
import { defineImport } from "./service";

const committed: unknown[] = [];
const columns = {
  name: { headers: ["Name"], required: true, parse: text(50) } as Column<string>,
  nationalId: { headers: ["Citizen ID"], parse: text(40), sensitive: true } as Column<string>,
};
const sample = defineImport({
  kind: "sample",
  columns,
  authorize: () => true,
  validate: async (rows) => rows.flatMap(({ row, values }) => (values.nationalId === "000" ? [{ row, column: "Citizen ID", code: "bad_id" }] : [])),
  commit: async (rows) => {
    committed.push(...rows.map((row) => row.values));
    return { created: rows.length };
  },
});

const upload = (csv: string) => {
  const form = new FormData();
  form.set("file", new File([csv], "sample.csv", { type: "text/csv" }));
  return form;
};

beforeAll(async () => {
  await migrateTestDb();
  const [person] = await db().insert(schema.person).values({ fullName: "Importer", searchName: "importer" }).returning();
  session.user = { userId: "u1", email: "importer@suzu.vn", person, principal: { personId: person.id, workforceType: "employee", grants: [] }, request: { ipAddress: null, userAgent: null } };
});

it("keeps sensitive cells encrypted while the batch waits, masks them in the preview, and commits the real values", async () => {
  const staged = await sample.stage(upload("Name,Citizen ID\nAn,079201001234\nBinh,\n"));
  if (!staged.ok) throw new Error(staged.message ?? staged.error);
  expect(staged.data).toMatchObject({ status: "ready", rowCount: 2, preview: [{ row: 2, cells: ["An", "••••••"] }, { row: 3, cells: ["Binh", ""] }] });

  const [batch] = await db().select().from(schema.importBatch).where(eq(schema.importBatch.id, staged.data.batchId));
  expect(JSON.stringify(batch)).not.toContain("079201001234");
  expect((batch.rows as { values: { nationalId: string | null } }[]).map((row) => row.values.nationalId?.slice(0, 3))).toEqual(["v1.", undefined]);

  const result = await sample.commit({ batchId: staged.data.batchId });
  expect(result).toEqual({ ok: true, data: { created: 2 } });
  expect(committed).toEqual([{ name: "An", nationalId: "079201001234" }, { name: "Binh", nationalId: null }]);
  // Nothing sensitive reached the audit log either.
  expect(JSON.stringify(await db().select({ summary: schema.auditLog.summary, before: schema.auditLog.before, after: schema.auditLog.after }).from(schema.auditLog))).not.toContain("079201001234");
});

it("validates against the real values, not the ciphertext", async () => {
  const staged = await sample.stage(upload("Name,Citizen ID\nChi,000\n"));
  expect(staged.ok && staged.data).toMatchObject({ status: "invalid", problemCount: 1 });
});
