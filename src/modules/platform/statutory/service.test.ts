import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { decideParameter, getParameter, proposeParameter } from "./service";

let hr: string;
let owner: string;

beforeAll(async () => {
  await migrateTestDb();
  const people = await db()
    .insert(schema.person)
    .values([
      { fullName: "HR", searchName: "hr", workEmail: "hr@suzu.vn", status: "active" },
      { fullName: "Owner", searchName: "owner", workEmail: "owner@suzu.vn", status: "active" },
    ])
    .returning();
  [hr, owner] = people.map((person) => person.id);
  await db().insert(schema.roleAssignment).values({ personId: owner, role: "owner", scopeType: "group" });
});

const propose = (amount: unknown, validFrom: string) => proposeParameter({ key: "insurance.reference_level", value: { amount }, validFrom, legalReference: "test", note: null }, hr);

it("changes nothing until the owner approves, then applies from the stated day only", async () => {
  const first = await propose(2_340_000, "2024-07-01");
  await expect(getParameter("insurance.reference_level", "2025-01-01")).rejects.toThrow("No approved statutory parameter");
  await decideParameter(first.id, "approve", owner);

  const second = await propose(2_530_000, "2026-07-01");
  expect(await getParameter("insurance.reference_level", "2026-08-01")).toEqual({ amount: 2_340_000 });
  await decideParameter(second.id, "approve", owner);

  expect(await getParameter("insurance.reference_level", "2026-06-30")).toEqual({ amount: 2_340_000 });
  expect(await getParameter("insurance.reference_level", "2026-07-01")).toEqual({ amount: 2_530_000 });
  // The owner heard about both proposals.
  expect(await db().$count(schema.notification)).toBe(2);
});

it("refuses wrong shapes, unknown keys, rewrites of history and second decisions", async () => {
  await expect(propose(2_530_000.5, "2027-01-01")).rejects.toThrow("parameter_value_invalid");
  await expect(proposeParameter({ key: "made.up", value: {}, validFrom: "2027-01-01", legalReference: null, note: null }, hr)).rejects.toThrow("parameter_unknown");

  const early = await propose(1, "2025-01-01");
  await expect(decideParameter(early.id, "approve", owner)).rejects.toThrow("parameter_before_current_version");
  const { after } = await decideParameter(early.id, "reject", owner);
  expect(after.status).toBe("rejected");
  await expect(decideParameter(early.id, "approve", owner)).rejects.toThrow("proposal_not_found");
});

it("cannot hold two approved versions for the same day, even if written directly", async () => {
  await expect(db().insert(schema.statutoryParameter).values({ key: "insurance.reference_level", value: { amount: 9 }, validFrom: "2026-12-01", status: "approved" })).rejects.toThrow();
});
