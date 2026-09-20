import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { listAuditEntries, recordAudit } from "./service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  await migrateTestDb();
  await recordAudit({ action: "person.hire", actor: { email: "mai@suzu.group" }, resource: { type: "person", id: "p1", entityId: A } });
  await recordAudit({ action: "person.hire", actor: { email: "bao@suzu.group" }, resource: { type: "person", id: "p2", entityId: B } });
  await recordAudit({ action: "person.update.denied", actor: { email: "huy_100%@suzu.group" } });
  await recordAudit({ action: "role.grant", actor: { email: "owner@suzu.vn" }, resource: { type: "role_assignment", id: "r1" } });
});

const actions = async (...args: Parameters<typeof listAuditEntries>) => (await listAuditEntries(...args)).rows.map((row) => `${row.action}:${row.resourceId ?? ""}`);

it("shows a group-wide reader everything, newest first", async () => {
  expect(await actions({ all: true }, {})).toEqual(["role.grant:r1", "person.update.denied:", "person.hire:p2", "person.hire:p1"]);
});

it("shows an entity-scoped reader that entity only, never group-level entries", async () => {
  expect(await actions({ all: false, entityIds: [A] }, {})).toEqual(["person.hire:p1"]);
  expect(await actions({ all: false, entityIds: [A] }, { entityId: B })).toEqual([]);
  expect(await actions({ all: false, entityIds: [] }, {})).toEqual([]);
});

it("filters by action, actor, resource and day, treating % and _ literally", async () => {
  expect(await actions({ all: true }, { action: ".denied" })).toEqual(["person.update.denied:"]);
  expect(await actions({ all: true }, { actor: "100%" })).toEqual(["person.update.denied:"]);
  expect(await actions({ all: true }, { actor: "%" })).toEqual(["person.update.denied:"]);
  expect(await actions({ all: true }, { resourceType: "person", resourceId: "p2" })).toEqual(["person.hire:p2"]);
  expect(await actions({ all: true }, { to: "2000-01-01" })).toEqual([]);
  expect((await listAuditEntries({ all: true }, { from: "2000-01-01" })).total).toBe(4);
});

it("cannot be rewritten", async () => {
  await expect(db().delete(schema.auditLog)).rejects.toThrow();
});
