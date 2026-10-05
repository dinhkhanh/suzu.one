// The two actions every import consists of, with a column marked `sensitive`: the waiting batch
// holds no plain text of it, the preview masks it, and the commit still gets the real value.
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}` }) }));
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user }));

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { type Column, text } from "./engine/table";
import { defineImport, purgeImportBatches } from "./service";

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

// ── What a batch leaves behind ──────────────────────────────────────────────────────────────

it("empties the staged rows when the batch is committed, and keeps its summary", async () => {
  const staged = await sample.stage(upload("Name,Citizen ID\nDung,079201009999\n"));
  if (!staged.ok) throw new Error(staged.message ?? staged.error);
  expect(await sample.commit({ batchId: staged.data.batchId })).toEqual({ ok: true, data: { created: 1 } });

  const [batch] = await db().select().from(schema.importBatch).where(eq(schema.importBatch.id, staged.data.batchId));
  expect(batch.rows).toEqual([]);
  // The names that sat in clear beside the encrypted cells are gone with them…
  expect(JSON.stringify(batch)).not.toContain("Dung");
  // …and what the import history shows is still there.
  expect(batch).toMatchObject({ status: "committed", fileName: "sample.csv", rowCount: 1, result: { created: 1 } });
  expect(batch.committedAt).not.toBeNull();
});

it("deletes a batch nobody committed once a day has passed, and empties a committed one that still holds its rows", async () => {
  await db().delete(schema.importBatch);
  const stage = async (csv: string) => {
    const staged = await sample.stage(upload(csv));
    if (!staged.ok) throw new Error(staged.message ?? staged.error);
    return staged.data.batchId;
  };
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const abandoned = await stage("Name,Citizen ID\nGiang,079201001111\n");
  const refused = await stage("Name,Citizen ID\nHoa,000\n");
  const waiting = await stage("Name,Citizen ID\nKhanh,079201002222\n");
  await db().update(schema.importBatch).set({ createdAt: twoDaysAgo }).where(inArray(schema.importBatch.id, [abandoned, refused]));
  // A batch committed before a commit emptied its own rows: old, done, and still holding them.
  const old = await stage("Name,Citizen ID\nLan,079201003333\n");
  await db().update(schema.importBatch).set({ status: "committed", committedAt: twoDaysAgo, createdAt: twoDaysAgo, result: { created: 1 } }).where(eq(schema.importBatch.id, old));

  expect(await purgeImportBatches()).toEqual({ importBatchesDeleted: 2, importBatchesEmptied: 1 });

  const left = await db().select().from(schema.importBatch);
  expect(left.map((batch) => batch.id).sort()).toEqual([waiting, old].sort());
  // Today's upload is untouched and can still be committed.
  expect(left.find((batch) => batch.id === waiting)?.rows).toHaveLength(1);
  expect(left.find((batch) => batch.id === old)).toMatchObject({ rows: [], status: "committed", rowCount: 1, result: { created: 1 } });
  expect(JSON.stringify(left)).not.toContain("Lan");
  expect(await sample.commit({ batchId: waiting })).toEqual({ ok: true, data: { created: 1 } });

  // A second night finds nothing more to do.
  expect(await purgeImportBatches()).toEqual({ importBatchesDeleted: 0, importBatchesEmptied: 0 });
});
