// Reference and personal reads that moved to the shared cache (PERF-04): approval flows, checklist
// templates, document templates, entities and work's saved views. The cache here is a plain map
// that keeps whatever it is given until `invalidate()` drops the key — so each test proves both
// halves: the reader answers what Postgres holds, and **every writer drops the entry**, since a
// writer that forgot would leave the reader on the old rows.
import { beforeAll, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/cache", () => ({
  TTL: { reference: 3600, personal: 300, live: 60 },
  cached: async (key: string, _ttl: number, load: () => Promise<unknown>) => {
    if (!store.has(key)) store.set(key, await load());
    return structuredClone(store.get(key));
  },
  invalidate: async (...keys: string[]) => {
    for (const key of keys) store.delete(key);
  },
}));
vi.mock("@/lib/db", () => import("./helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/modules/platform/files/storage", () => import("./helpers/storage"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {},
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { db, schema } from "@/lib/db";
import { listTemplates as listDocumentTemplates, findTemplate as findDocumentTemplate, saveTemplate as saveDocumentTemplate, type TemplateInput as DocumentTemplateInput } from "@/modules/documents/service";
import { listOfferTemplates } from "@/modules/recruit/offers";
import { deleteFlow, effectiveFlow, getFlow, listFlows, saveFlow } from "@/modules/platform/approvals/flows";
import { createEntity, findEntity, listEntities, updateEntity } from "@/modules/platform/org/service";
import { addTemplateItem, listTemplates as listChecklistTemplates, removeTemplateItem, saveTemplate as saveChecklistTemplate } from "@/modules/platform/tasks-engine/service";
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from "@/modules/work/views";
import { migrateTestDb } from "./helpers/db";

const ids = {} as Record<"szm" | "szc" | "mai" | "huy" | "team" | "project", string>;
const FALLBACK = { steps: [{ key: "manager", mode: "any" as const, approvers: [{ rule: "line_manager" as const }] }] };

beforeAll(async () => {
  await migrateTestDb();
  ids.szm = (await createEntity({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "SuZu Media" } as never)).id;
  ids.szc = (await createEntity({ code: "SZC", legalName: "Công ty TNHH SuZu Creative", shortName: "SuZu Creative" } as never)).id;
  for (const [key, fullName] of [
    ["mai", "Lê Thị Mai"],
    ["huy", "Hồ Gia Huy"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: ids.szm, status: "active" }).returning();
    ids[key] = row.id;
  }
  const [team] = await db().insert(schema.workTeam).values({ key: "VID", name: "Video" }).returning();
  ids.team = team.id;
  const [project] = await db().insert(schema.workProject).values({ teamId: team.id, key: "VID-P1", name: "Phim", createdByPersonId: ids.mai } as never).returning();
  ids.project = project.id;
});

describe("approval flows", () => {
  it("answers from the table and sees every save and delete", async () => {
    expect((await effectiveFlow(db(), "leave", ids.szm, FALLBACK)).source).toBe("default");
    const group = await saveFlow({ requestType: "leave", entityId: null, definition: { steps: [{ key: "boss", mode: "any", approvers: [{ rule: "person", personId: ids.mai }] }] }, active: true }, ids.mai);
    expect((await effectiveFlow(db(), "leave", ids.szm, FALLBACK)).source).toBe("group");
    const own = await saveFlow({ requestType: "leave", entityId: ids.szm, definition: { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "person", personId: ids.huy }] }] }, active: true }, ids.mai);
    expect(await effectiveFlow(db(), "leave", ids.szm, FALLBACK)).toMatchObject({ source: "entity", flow: { steps: [{ key: "hr" }] } });
    // Another entity still follows the group's; switched off, the entity's own stops counting.
    expect((await effectiveFlow(db(), "leave", ids.szc, FALLBACK)).source).toBe("group");
    await saveFlow({ requestType: "leave", entityId: ids.szm, definition: own.after.definition as never, active: false }, ids.mai);
    expect((await effectiveFlow(db(), "leave", ids.szm, FALLBACK)).source).toBe("group");

    // The list: by type, the group's after the entities', each with its entity's current name.
    expect((await listFlows()).map((flow) => [flow.requestType, flow.entityName])).toEqual([
      ["leave", "SuZu Media"],
      ["leave", null],
    ]);
    expect((await getFlow(group.after.id))?.id).toBe(group.after.id);
    await deleteFlow(group.after.id);
    expect(await getFlow(group.after.id)).toBeNull();
    expect((await effectiveFlow(db(), "leave", ids.szc, FALLBACK)).source).toBe("default");
  });

  it("reads inside a transaction from the transaction, not the cache", async () => {
    await db().transaction(async (tx) => {
      await tx.insert(schema.approvalFlow).values({ requestType: "overtime", entityId: null, definition: FALLBACK });
      expect((await effectiveFlow(tx, "overtime", null, { steps: [] } as never)).source).toBe("group");
    });
  });
});

describe("checklist templates", () => {
  it("lists the checklists with their steps, and sees every write to either", async () => {
    const { after: template } = await saveChecklistTemplate(null, { purpose: "onboarding", name: "Đón người mới", entityId: null, departmentId: null, positionId: null, isActive: true });
    // A work template on the same table never shows here.
    await db().insert(schema.taskTemplate).values({ purpose: "work_project", name: "Dự án mẫu" });
    store.clear();
    expect((await listChecklistTemplates()).map((row) => row.name)).toEqual(["Đón người mới"]);

    const step = await addTemplateItem(template.id, { title: "Cấp laptop", description: null, assigneeRule: "subject", assigneePersonId: null, dueOffsetDays: 0, sortOrder: 0 });
    expect((await listChecklistTemplates())[0].items.map((item) => item.title)).toEqual(["Cấp laptop"]);
    await saveChecklistTemplate(template.id, { purpose: "onboarding", name: "Đón người mới (v2)", entityId: null, departmentId: null, positionId: null, isActive: true });
    expect((await listChecklistTemplates())[0].name).toBe("Đón người mới (v2)");
    await removeTemplateItem(step.id);
    expect((await listChecklistTemplates())[0].items).toEqual([]);
  });
});

describe("document templates and entities", () => {
  const template = (overrides: Partial<DocumentTemplateInput> = {}): DocumentTemplateInput => ({ code: "XN-1", name: "Giấy xác nhận", entityId: null, kind: "confirmation" as never, tier: "personal", body: "Xác nhận {{person.fullName}}.", letterhead: {}, isActive: true, ...overrides });

  it("lists, finds and offers the templates, with each entity's current name", async () => {
    const { after: confirmation } = await saveDocumentTemplate(null, template({ entityId: ids.szm }), ids.mai);
    const { after: offer } = await saveDocumentTemplate(null, template({ code: "TM-1", name: "Thư mời nhận việc", kind: "offer" }), ids.mai);
    expect((await listDocumentTemplates()).find((row) => row.id === confirmation.id)?.entityName).toBe("SuZu Media");
    expect(await listOfferTemplates()).toEqual([{ id: offer.id, name: "Thư mời nhận việc", entityId: null }]);

    // An edit is seen at once — by the list and by a lookup of the one template.
    await saveDocumentTemplate(confirmation.id, template({ entityId: ids.szm, name: "Giấy xác nhận (v2)" }), ids.mai);
    expect(await findDocumentTemplate(confirmation.id)).toMatchObject({ name: "Giấy xác nhận (v2)", version: 2 });
    await saveDocumentTemplate(offer.id, template({ code: "TM-1", name: "Thư mời nhận việc", kind: "offer", isActive: false }), ids.mai);
    expect(await listOfferTemplates()).toEqual([]);

    // A renamed entity is renamed on the templates too: the name is the org module's, not a copy.
    const before = (await findEntity(ids.szm))!;
    await updateEntity(ids.szm, { legalName: before.legalName, shortName: "SuZu Media Group", taxCode: before.taxCode, insuranceUnitCode: before.insuranceUnitCode, wageRegion: before.wageRegion, address: before.address, legalRepresentative: before.legalRepresentative, isActive: before.isActive });
    expect((await findEntity(ids.szm))?.shortName).toBe("SuZu Media Group");
    expect((await listDocumentTemplates()).find((row) => row.id === confirmation.id)?.entityName).toBe("SuZu Media Group");
    expect((await listEntities()).map((row) => row.code)).toEqual(["SZC", "SZM"]);
  });
});

describe("work's saved views", () => {
  it("shows a person their own views and everybody's shared ones, and follows every write", async () => {
    const mine = await createSavedView({ teamId: ids.team, projectId: ids.project, name: "Của tôi", filters: {}, isShared: false }, ids.mai);
    const shared = await createSavedView({ teamId: ids.team, projectId: ids.project, name: "Chung", filters: {}, isShared: true }, ids.mai);
    // On the team's backlog, not the project's list.
    await createSavedView({ teamId: ids.team, projectId: null, name: "Backlog", filters: {}, isShared: true }, ids.mai);
    const names = async (personId: string, scope: Parameters<typeof listSavedViews>[0] = { projectId: ids.project }) => (await listSavedViews(scope, personId)).map((view) => view.name);

    expect(await names(ids.mai)).toEqual(["Chung", "Của tôi"]);
    expect(await names(ids.huy)).toEqual(["Chung"]);
    expect(await names(ids.huy, { teamId: ids.team })).toEqual(["Backlog"]);

    // Shared later: the colleague sees it; unshared again: gone from their list, still the owner's.
    await updateSavedView(mine.id, { isShared: true });
    expect(await names(ids.huy)).toEqual(["Chung", "Của tôi"]);
    await updateSavedView(mine.id, { isShared: false, name: "Riêng" });
    expect(await names(ids.huy)).toEqual(["Chung"]);
    expect(await names(ids.mai)).toEqual(["Chung", "Riêng"]);
    await deleteSavedView(shared.id);
    expect(await names(ids.huy)).toEqual([]);
    expect(await names(ids.mai)).toEqual(["Riêng"]);
  });
});
