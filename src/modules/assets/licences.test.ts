// Licences and subscriptions against a real Postgres (PGlite), and above all the *facts* the OPS
// tracker pulls from them: one per renewal that falls due, with a stable id so generating twice
// changes nothing, and none at all once the subscription is cancelled.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { findLicence, listInactiveLicenceIds, listLicenceRenewalFacts, listLicences, saveLicence, type LicenceInput } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "szc" | "chi" | "keeper", string>;
let keeper: Principal;
let szcKeeper: Principal;
let employee: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  for (const [key, fullName] of [
    ["chi", "Dương Thùy Chi"],
    ["keeper", "Người giữ kho"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  keeper = principal(ids.keeper, [{ role: "asset_admin", scope: { type: "group" } }]);
  szcKeeper = principal("szc-keeper", [{ role: "asset_admin", scope: { type: "entity", id: szc.id } }]);
  employee = principal("plain");
});

const input = (over: Partial<LicenceInput> = {}): LicenceInput => ({
  name: "Adobe Creative Cloud",
  vendor: "Adobe",
  entityId: ids.szm,
  seats: 6,
  seatHolderPersonIds: [],
  costPerCycle: 41_400_000,
  billingCycle: "annual",
  renewalDate: "2027-03-14",
  autoRenews: true,
  ownerPersonId: ids.chi,
  assetId: null,
  accountRef: null,
  notes: null,
  status: "active",
  ...over,
});

describe("recording a licence", () => {
  it("saves one and reads it back", async () => {
    const { after } = await saveLicence(null, input(), ids.keeper);
    expect(after.name).toBe("Adobe Creative Cloud");
    expect((await findLicence(after.id))?.seats).toBe(6);
  });

  it("insists on a renewal date for a cycle that renews, and needs none for a perpetual one", async () => {
    expect(await fails(saveLicence(null, input({ renewalDate: null }), ids.keeper))).toBe("licence_renewal_date_required");
    const { after } = await saveLicence(null, input({ name: "Cấp phép vĩnh viễn", billingCycle: "perpetual", renewalDate: null }), ids.keeper);
    expect(after.billingCycle).toBe("perpetual");
  });

  it("refuses a nonsense cost or seat count", async () => {
    expect(await fails(saveLicence(null, input({ costPerCycle: -1 }), ids.keeper))).toBe("licence_cost_invalid");
    expect(await fails(saveLicence(null, input({ seats: -3 }), ids.keeper))).toBe("licence_seats_invalid");
  });
});

describe("who sees the list", () => {
  it("narrows to the entities whose register the viewer keeps, and shows a price to them alone", async () => {
    await saveLicence(null, input({ name: "Figma", entityId: ids.szc, billingCycle: "monthly", renewalDate: "2026-11-01" }), ids.keeper);
    const all = await listLicences(keeper);
    expect(all.some((row) => row.name === "Figma")).toBe(true);
    expect(all.every((row) => row.canSeeMoney)).toBe(true);

    const narrow = await listLicences(szcKeeper);
    expect(narrow.map((row) => row.name)).toEqual(["Figma"]);

    // Somebody who keeps no register sees nothing at all.
    expect(await listLicences(employee)).toEqual([]);
  });
});

describe("the facts the OPS tracker pulls", () => {
  it("gives one fact per renewal in the window, with a stable id", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZF", legalName: "Facts", shortName: "Facts" }).returning();
    const { after } = await saveLicence(null, input({ name: "Kho đám mây", entityId: fresh.id, billingCycle: "monthly", renewalDate: "2026-10-11" }), ids.keeper);

    const facts = (await listLicenceRenewalFacts("2026-10-01", "2026-12-31")).filter((fact) => fact.licenceId === after.id);
    expect(facts.map((fact) => fact.renewalDate)).toEqual(["2026-10-11", "2026-11-11", "2026-12-11"]);
    expect(facts[0].id).toBe(`${after.id}:2026-10-11`);
    // Asking again gives exactly the same ids — which is what makes generating twice a no-op.
    const again = (await listLicenceRenewalFacts("2026-10-01", "2026-12-31")).filter((fact) => fact.licenceId === after.id);
    expect(again.map((fact) => fact.id)).toEqual(facts.map((fact) => fact.id));
  });

  it("carries the entity and the owner, so the obligation lands on the right desk", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZO", legalName: "Owner", shortName: "Owner" }).returning();
    const { after } = await saveLicence(null, input({ name: "Có chủ", entityId: fresh.id, renewalDate: "2027-01-20" }), ids.keeper);
    const [fact] = (await listLicenceRenewalFacts("2027-01-01", "2027-02-01")).filter((row) => row.licenceId === after.id);
    expect(fact.entityId).toBe(fresh.id);
    expect(fact.ownerPersonId).toBe(ids.chi);
    expect(fact.autoRenews).toBe(true);
  });

  it("walks an old annual licence forward to the next renewal, not a backlog of every one it has had", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZY", legalName: "Old", shortName: "Old" }).returning();
    const { after } = await saveLicence(null, input({ name: "Mua từ lâu", entityId: fresh.id, renewalDate: "2019-03-14" }), ids.keeper);
    const facts = (await listLicenceRenewalFacts("2026-01-01", "2026-12-31")).filter((row) => row.licenceId === after.id);
    expect(facts.map((row) => row.renewalDate)).toEqual(["2026-03-14"]);
  });

  it("stops producing facts once the subscription is cancelled, and names it as inactive", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZX", legalName: "Gone", shortName: "Gone" }).returning();
    const { after } = await saveLicence(null, input({ name: "Sắp hủy", entityId: fresh.id, renewalDate: "2027-05-05" }), ids.keeper);
    expect((await listLicenceRenewalFacts("2027-01-01", "2027-12-31")).some((fact) => fact.licenceId === after.id)).toBe(true);

    await saveLicence(after.id, input({ name: "Sắp hủy", entityId: fresh.id, renewalDate: "2027-05-05", status: "cancelled" }), ids.keeper);
    expect((await listLicenceRenewalFacts("2027-01-01", "2027-12-31")).some((fact) => fact.licenceId === after.id)).toBe(false);
    expect(await listInactiveLicenceIds()).toContain(after.id);
  });

  it("produces nothing for a perpetual licence, which never falls due", async () => {
    const [fresh] = await db().insert(schema.entity).values({ code: "SZP", legalName: "Perp", shortName: "Perp" }).returning();
    const { after } = await saveLicence(null, input({ name: "Vĩnh viễn", entityId: fresh.id, billingCycle: "perpetual", renewalDate: null }), ids.keeper);
    expect((await listLicenceRenewalFacts("2026-01-01", "2030-12-31")).some((fact) => fact.licenceId === after.id)).toBe(false);
  });

  it("leaves a cancelled licence's row in the register — it is history, not a deletion", async () => {
    const rows = await db().select().from(schema.licence).where(eq(schema.licence.status, "cancelled"));
    expect(rows.length).toBeGreaterThan(0);
  });
});
