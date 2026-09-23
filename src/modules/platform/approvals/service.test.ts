// The approval engine against a real database (PGlite), with a request type of its own:
// configured flows (entity > group > default in code), conditions, parallel steps as rows,
// standing and ad-hoc delegation, comments.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayInVietnam } from "@/lib/dates";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { createDelegation, followDelegations, listDelegations, revokeDelegation } from "./delegations";
import { deleteFlow, effectiveFlow, saveFlow } from "./flows";
import { commentOnRequest, decideRequest, defineRequestType, delegateRequest, getRequest, isRequestParty, listInbox, submitRequest } from "./service";

const leave = defineRequestType({
  type: "test_leave",
  flow: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] },
  conditionFields: ["days"],
  bulkApprovable: () => true,
});

const ids = {} as Record<"media" | "creative" | "owner" | "head" | "manager" | "deputy" | "hr" | "huy" | "lan", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const person = async (name: string, entityId: string, managerId: string | null = null) => {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, primaryEntityId: entityId, managerId }).returning();
    return row.id;
  };
  const owner = await person("The Owner", media.id);
  const head = await person("Dept Head", media.id);
  const manager = await person("Line Manager", media.id, head);
  const deputy = await person("The Deputy", media.id, head);
  const hr = await person("Hr Staff", media.id);
  const huy = await person("Ho Gia Huy", media.id, manager);
  const lan = await person("Tran Lan", creative.id, manager);
  await db().insert(schema.roleAssignment).values([
    { personId: owner, role: "owner", scopeType: "group", validFrom: "2024-01-01" },
    { personId: hr, role: "hr_staff", scopeType: "entity", scopeId: media.id, validFrom: "2024-01-01" },
  ]);
  Object.assign(ids, { media: media.id, creative: creative.id, owner, head, manager, deputy, hr, huy, lan });
});

beforeEach(async () => {
  await db().delete(schema.approvalEvent);
  await db().delete(schema.approvalActionToken);
  await db().delete(schema.approvalAssignee);
  await db().delete(schema.approvalStep);
  await db().delete(schema.approvalRequest);
  await db().delete(schema.approvalFlow);
  await db().delete(schema.approvalDelegation);
});

const submit = (personId: string, entityId: string, days: number) =>
  db().transaction((tx) => submitRequest(tx, leave, { entityId, requesterPersonId: personId, subjectPersonId: personId, summary: `${days} days`, payload: { days }, link: (id) => `/x/${id}` }));
const decide = (requestId: string, actorId: string, action: "approve" | "reject" | "return" = "approve") => db().transaction((tx) => decideRequest(tx, leave, requestId, actorId, { action, comment: action === "approve" ? null : "why" }));
const twoStep = { steps: [{ key: "manager", mode: "any" as const, approvers: [{ rule: "line_manager" as const }] }, { key: "head", mode: "any" as const, approvers: [{ rule: "manager_level" as const, level: 2 }], condition: { field: "days", op: "gt" as const, value: 3 } }] };

describe("configured flows", () => {
  it("uses the entity's flow, then the group's, then the default in code", async () => {
    expect((await effectiveFlow(db(), "test_leave", ids.media, leave.flow)).source).toBe("default");
    await saveFlow({ requestType: "test_leave", entityId: null, definition: twoStep, active: true }, ids.owner);
    expect((await effectiveFlow(db(), "test_leave", ids.media, leave.flow)).source).toBe("group");
    const { after } = await saveFlow({ requestType: "test_leave", entityId: ids.media, definition: { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "leave:manage" }] }] }, active: true }, ids.owner);
    expect((await effectiveFlow(db(), "test_leave", ids.media, leave.flow)).source).toBe("entity");
    expect((await effectiveFlow(db(), "test_leave", ids.creative, leave.flow)).source).toBe("group");

    // Media's request goes to HR; Creative's follows the group flow with its condition.
    expect((await submit(ids.huy, ids.media, 5)).approverIds).toEqual([ids.hr]);
    const long = await submit(ids.lan, ids.creative, 5);
    expect(long.approverIds).toEqual([ids.manager]);
    expect((await decide(long.request.id, ids.manager)).outcome).toBe("pending");
    expect((await listInbox(ids.head)).map((row) => row.id)).toEqual([long.request.id]);
    expect((await decide(long.request.id, ids.head)).outcome).toBe("approved");

    // Saving again replaces; switching off and deleting fall back.
    await saveFlow({ requestType: "test_leave", entityId: ids.media, definition: twoStep, active: false }, ids.owner);
    expect((await effectiveFlow(db(), "test_leave", ids.media, leave.flow)).source).toBe("group");
    expect((await db().select().from(schema.approvalFlow)).length).toBe(2);
    await deleteFlow(after.id);
    expect((await db().select().from(schema.approvalFlow)).length).toBe(1);
  });

  it("skips a step whose condition does not hold, and keeps the flow it started with", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: twoStep, active: true }, ids.owner);
    const short = await submit(ids.huy, ids.media, 2);
    await saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "role", role: "hr_staff" }] }] }, active: true }, ids.owner);
    expect((await decide(short.request.id, ids.manager)).outcome).toBe("approved");
  });

  it("refuses a flow that could approve by nobody, and a named approver who is not there", async () => {
    await expect(saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ ...twoStep.steps[1] }] }, active: true }, ids.owner)).rejects.toThrow("flow_no_unconditional_step");
    await expect(saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ key: "x", mode: "any", approvers: [{ rule: "person", personId: "00000000-0000-4000-8000-000000000000" }] }] }, active: true }, ids.owner)).rejects.toThrow("flow_person_unknown");
  });

  it("runs parallel steps: both open at once, the request is approved when both are done", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }, { key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "leave:manage" }], parallel: true }] }, active: true }, ids.owner);
    const { request, approverIds } = await submit(ids.huy, ids.media, 1);
    expect(approverIds.sort()).toEqual([ids.manager, ids.hr].sort());
    expect((await decide(request.id, ids.hr)).outcome).toBe("pending");
    const view = await getRequest({ personId: ids.manager, principal: { personId: ids.manager, workforceType: "employee", grants: [] } }, leave, request.id);
    expect(view?.canDecide).toBe(true);
    expect(view?.steps.map((step) => [step.status, step.parallel])).toEqual([["pending", false], ["approved", true]]);
    expect((await decide(request.id, ids.manager)).outcome).toBe("approved");
  });
});

describe("requests about no person", () => {
  const pagePublish = defineRequestType({ type: "test_page", flow: { steps: [{ key: "review", mode: "any", approvers: [{ rule: "permission", permission: "person:manage" }] }] } });
  const submitPage = (target?: { entityId: string }) => db().transaction((tx) => submitRequest(tx, pagePublish, { entityId: target?.entityId ?? null, requesterPersonId: ids.huy, subjectPersonId: null, subjectType: "page", subjectId: null, summary: "A page", target }));

  it("asks the people whose scope covers the target, and the owners when nothing says where it sits", async () => {
    expect((await submitPage({ entityId: ids.media })).approverIds).toEqual([ids.hr]);
    // Another entity: the media HR grant does not cover it.
    expect((await submitPage({ entityId: ids.creative })).approverIds).toEqual([ids.owner]);
    expect((await submitPage()).approverIds).toEqual([ids.owner]);
  });
});

describe("delegation", () => {
  const today = todayInVietnam();

  it("follows chains, but not loops or a stand-in who is the requester", () => {
    const next = new Map([["a", "b"], ["b", "c"]]);
    expect(followDelegations("a", next)).toBe("c");
    expect(followDelegations("a", new Map([["a", "b"], ["b", "a"]]))).toBe("a");
    expect(followDelegations("a", next, new Set(["c"]))).toBe("a");
  });

  it("asks the stand-in while a standing delegation runs, and keeps whom they stand in for", async () => {
    await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: addDays(today, 7), requestTypes: null, reason: "holiday" });
    const { request, approverIds } = await submit(ids.huy, ids.media, 1);
    expect(approverIds).toEqual([ids.deputy]);
    const [assignee] = await db().select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, request.id));
    expect(assignee.delegatedFromPersonId).toBe(ids.manager);
    // The manager still sees it; only the deputy decides.
    await expect(decide(request.id, ids.manager)).rejects.toThrow("approval_not_assignee");
    expect((await decide(request.id, ids.deputy)).outcome).toBe("approved");
    expect((await listDelegations(ids.deputy)).received).toHaveLength(1);
  });

  it("ignores delegations for other types, other days, revoked ones, and never asks the requester", async () => {
    await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: today, requestTypes: ["other_type"], reason: null });
    await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: addDays(today, 3), validTo: addDays(today, 9), requestTypes: null, reason: null });
    const revoked = await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: today, requestTypes: null, reason: null });
    await revokeDelegation(ids.manager, revoked.id);
    expect((await submit(ids.huy, ids.media, 1)).approverIds).toEqual([ids.manager]);
    await createDelegation(ids.manager, { toPersonId: ids.huy, validFrom: today, validTo: today, requestTypes: null, reason: null });
    expect((await submit(ids.huy, ids.media, 1)).approverIds).toEqual([ids.manager]);
    await expect(createDelegation(ids.manager, { toPersonId: ids.manager, validFrom: today, validTo: today, requestTypes: null, reason: null })).rejects.toThrow("delegation_self");
    await expect(revokeDelegation(ids.deputy, revoked.id)).rejects.toThrow("delegation_not_found");
  });

  it("hands one request on, once, to someone who is not the requester", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    expect(await isRequestParty(request.id, ids.manager)).toEqual({ party: true, canDelegate: true });
    expect(await isRequestParty(request.id, ids.hr)).toEqual({ party: false, canDelegate: false });
    await expect(db().transaction((tx) => delegateRequest(tx, request.id, ids.manager, { toPersonId: ids.huy }))).rejects.toThrow("approval_own_request");
    await expect(db().transaction((tx) => delegateRequest(tx, request.id, ids.hr, { toPersonId: ids.deputy }))).rejects.toThrow("approval_delegate_refused");
    await db().transaction((tx) => delegateRequest(tx, request.id, ids.manager, { toPersonId: ids.deputy, comment: "away" }));
    expect((await listInbox(ids.deputy)).map((row) => row.id)).toEqual([request.id]);
    expect(await listInbox(ids.manager)).toEqual([]);
    // Still a party (they can follow it), no longer their turn.
    expect(await isRequestParty(request.id, ids.manager)).toEqual({ party: true, canDelegate: false });
    expect((await decide(request.id, ids.deputy)).outcome).toBe("approved");
  });
});

describe("a request about someone other than its requester", () => {
  const today = todayInVietnam();
  // HR files for the line manager; the flow names the manager in person and their own line manager.
  const aboutManager = () => defineRequestType({ type: "test_about", flow: { steps: [{ key: "named", mode: "any", approvers: [{ rule: "person", personId: ids.manager }, { rule: "line_manager" }] }] } });
  const fileAboutManager = () => db().transaction((tx) => submitRequest(tx, aboutManager(), { entityId: ids.media, requesterPersonId: ids.hr, subjectPersonId: ids.manager, summary: "about the manager" }));

  it("never asks the person it is about, nor hands them the turn or a standing delegation", async () => {
    const { request, approverIds } = await fileAboutManager();
    expect(approverIds).toEqual([ids.head]);
    await expect(db().transaction((tx) => decideRequest(tx, aboutManager(), request.id, ids.manager, { action: "approve" }))).rejects.toThrow("approval_own_request");
    await expect(db().transaction((tx) => delegateRequest(tx, request.id, ids.head, { toPersonId: ids.manager }))).rejects.toThrow("approval_own_request");
    expect(await isRequestParty(request.id, ids.manager)).toEqual({ party: false, canDelegate: false });

    await createDelegation(ids.head, { toPersonId: ids.manager, validFrom: today, validTo: today, requestTypes: null, reason: null });
    expect((await fileAboutManager()).approverIds).toEqual([ids.head]);
  });

  it("hands no turn to a collaborator, by hand or by a standing delegation", async () => {
    const [outsider] = await db().insert(schema.person).values({ fullName: "Free Lancer", searchName: "free lancer", workEmail: "free.lancer@suzu.group", primaryEntityId: ids.media, workforceType: "collaborator" }).returning();
    const { request } = await fileAboutManager();
    await expect(db().transaction((tx) => delegateRequest(tx, request.id, ids.head, { toPersonId: outsider.id }))).rejects.toThrow("delegation_person_unknown");
    await expect(createDelegation(ids.head, { toPersonId: outsider.id, validFrom: today, validTo: today, requestTypes: null, reason: null })).rejects.toThrow("delegation_person_unknown");
    // One written before the rule, straight into the table: skipped.
    await db().insert(schema.approvalDelegation).values({ fromPersonId: ids.head, toPersonId: outsider.id, validFrom: today, validTo: today });
    expect((await fileAboutManager()).approverIds).toEqual([ids.head]);
  });
});

describe("comments", () => {
  it("lets the parties remark without deciding, and nobody else", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    await db().transaction((tx) => commentOnRequest(tx, request.id, ids.manager, "Which project covers for you?"));
    await db().transaction((tx) => commentOnRequest(tx, request.id, ids.huy, "Lan does."));
    await expect(db().transaction((tx) => commentOnRequest(tx, request.id, ids.hr, "hello"))).rejects.toThrow("approval_not_found");
    const events = await db().select().from(schema.approvalEvent).where(eq(schema.approvalEvent.requestId, request.id));
    expect(events.map((event) => event.type)).toEqual(["submitted", "commented", "commented"]);
    const [row] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, request.id));
    expect(row.status).toBe("pending");
    const notices = await db().select().from(schema.notification).where(eq(schema.notification.kind, "approvals.commented"));
    expect(notices.map((notice) => notice.recipientPersonId).sort()).toEqual([ids.huy, ids.manager].sort());
  });
});
