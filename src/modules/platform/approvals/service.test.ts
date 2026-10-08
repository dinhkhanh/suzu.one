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
import { findActionToken } from "./action-tokens";
import { createDelegation, findDelegation, followDelegations, listDelegations, revokeDelegation } from "./delegations";
import { deleteFlow, effectiveFlow, saveFlow } from "./flows";
import { buildAllRequestsExport } from "./exports";
import { sendOversightDigest } from "./jobs";
import {
  commentOnRequest,
  decideRequest,
  defineRequestType,
  delegateRequest,
  getRequest,
  isRequestParty,
  listAllRequests,
  listInbox,
  listTurnsOf,
  mayReassignRequest,
  reassignRequest,
  reassignStrandedTurns,
  reassignTurnsOfLeaver,
  resubmitRequest,
  submitRequest,
  withdrawRequest,
} from "./service";

const leave = defineRequestType({
  type: "test_leave",
  flow: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] },
  conditionFields: ["days"],
  bulkApprovable: () => true,
});

const ids = {} as Record<"media" | "creative" | "owner" | "head" | "manager" | "deputy" | "hr" | "huy" | "lan", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  const person = async (name: string, entityId: string, managerId: string | null = null) => {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, primaryEntityId: entityId, managerId })
      .returning();
    return row.id;
  };
  const owner = await person("The Owner", media.id);
  const head = await person("Dept Head", media.id);
  const manager = await person("Line Manager", media.id, head);
  const deputy = await person("The Deputy", media.id, head);
  const hr = await person("Hr Staff", media.id);
  const huy = await person("Ho Gia Huy", media.id, manager);
  const lan = await person("Tran Lan", creative.id, manager);
  await db()
    .insert(schema.roleAssignment)
    .values([
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
const twoStep = {
  steps: [
    { key: "manager", mode: "any" as const, approvers: [{ rule: "line_manager" as const }] },
    { key: "head", mode: "any" as const, approvers: [{ rule: "manager_level" as const, level: 2 }], condition: { field: "days", op: "gt" as const, value: 3 } },
  ],
};

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
    await expect(
      saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ key: "x", mode: "any", approvers: [{ rule: "person", personId: "00000000-0000-4000-8000-000000000000" }] }] }, active: true }, ids.owner),
    ).rejects.toThrow("flow_person_unknown");
  });

  it("runs parallel steps: both open at once, the request is approved when both are done", async () => {
    await saveFlow(
      {
        requestType: "test_leave",
        entityId: null,
        definition: {
          steps: [
            { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
            { key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "leave:manage" }], parallel: true },
          ],
        },
        active: true,
      },
      ids.owner,
    );
    const { request, approverIds } = await submit(ids.huy, ids.media, 1);
    expect(approverIds.sort()).toEqual([ids.manager, ids.hr].sort());
    expect((await decide(request.id, ids.hr)).outcome).toBe("pending");
    const view = await getRequest({ personId: ids.manager, principal: { personId: ids.manager, workforceType: "employee", grants: [] } }, leave, request.id);
    expect(view?.canDecide).toBe(true);
    expect(view?.steps.map((step) => [step.status, step.parallel])).toEqual([
      ["pending", false],
      ["approved", true],
    ]);
    expect((await decide(request.id, ids.manager)).outcome).toBe("approved");
  });

  it("asks several approvers in one notice, each with their own one-click link", async () => {
    await saveFlow(
      {
        requestType: "test_leave",
        entityId: null,
        definition: {
          steps: [
            { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
            { key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "leave:manage" }], parallel: true },
          ],
        },
        active: true,
      },
      ids.owner,
    );
    await db().delete(schema.chatDelivery);
    const { request } = await submit(ids.huy, ids.media, 1);
    const cards = await db().select().from(schema.chatDelivery).where(eq(schema.chatDelivery.kind, "approvals.requested"));
    expect(cards.map((card) => card.personId).sort()).toEqual([ids.manager, ids.hr].sort());
    for (const card of cards) {
      expect(card.actionLabel).toBe("Duyệt");
      const found = await findActionToken(card.actionLink!.split("/approvals/act/")[1]);
      expect(found.ok && [found.row.personId, found.row.requestId]).toEqual([card.personId, request.id]);
    }
    expect((await db().select().from(schema.approvalActionToken).where(eq(schema.approvalActionToken.requestId, request.id))).length).toBe(2);
  });
});

describe("requests about no person", () => {
  const pagePublish = defineRequestType({ type: "test_page", flow: { steps: [{ key: "review", mode: "any", approvers: [{ rule: "permission", permission: "person:manage" }] }] } });
  const submitPage = (target?: { entityId: string }) =>
    db().transaction((tx) => submitRequest(tx, pagePublish, { entityId: target?.entityId ?? null, requesterPersonId: ids.huy, subjectPersonId: null, subjectType: "page", subjectId: null, summary: "A page", target }));

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
    const next = new Map([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(followDelegations("a", next)).toBe("c");
    expect(
      followDelegations(
        "a",
        new Map([
          ["a", "b"],
          ["b", "a"],
        ]),
      ),
    ).toBe("a");
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

describe("oversight (approval:oversee)", () => {
  const ownerView = () => ({ personId: ids.owner, principal: { personId: ids.owner, workforceType: null, grants: [{ role: "owner" as const, scope: { type: "group" as const } }] } });
  const brief = defineRequestType({ type: "project_brief", flow: { steps: [{ key: "lead", mode: "any", approvers: [{ rule: "line_manager" }] }] } });

  it("lists every request with whom it waits for, and lets the owner open one they were never asked about", async () => {
    const { request } = await submit(ids.huy, ids.media, 2);
    const rows = await listAllRequests({ all: true }, { state: "open" });
    expect(rows.map((row) => [row.id, row.waitingOn])).toEqual([[request.id, "Line Manager"]]);
    expect(await getRequest(ownerView(), leave, request.id)).not.toBeNull();
    // Nobody else follows along: HR over the entity is no party and holds no oversight.
    expect(await getRequest({ personId: ids.hr, principal: { personId: ids.hr, workforceType: null, grants: [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }] } }, leave, request.id)).toBeNull();

    const returned = await submit(ids.lan, ids.creative, 1);
    await decide(returned.request.id, ids.manager, "return");
    expect((await listAllRequests({ all: true }, { state: "open", since: todayInVietnam() })).find((row) => row.id === returned.request.id)?.waitingOn).toBe("Tran Lan");
    await db().transaction((tx) => withdrawRequest(tx, returned.request.id, ids.lan));

    await decide(request.id, ids.manager);
    expect(await listAllRequests({ all: true }, { state: "open" })).toEqual([]);
    // Newest first: the withdrawn one, then the approved one — both waiting on nobody.
    expect((await listAllRequests({ all: true }, { state: "decided" })).map((row) => [row.id, row.waitingOn])).toEqual([
      [returned.request.id, null],
      [request.id, null],
    ]);
    // An entity reach sees its own entity's requests only.
    expect((await listAllRequests({ all: false, entityIds: [ids.creative] })).map((row) => row.id)).toEqual([returned.request.id]);
    expect(await listAllRequests({ all: false, entityIds: [] })).toEqual([]);
  });

  it("exports the oversight list for the same reach, naming builder types from the labels it is given", async () => {
    await submit(ids.huy, ids.media, 2);
    await submit(ids.lan, ids.creative, 1);
    const all = await buildAllRequestsExport({ all: true }, { state: "open" }, new Map([["test_leave", "Nghỉ thử"]]), "en");
    expect(all.file.table.header).toEqual(["Type", "Request", "From", "Status", "Waiting for", "Sent", "Decided"]);
    expect(all.file.table.rows.map((row) => [row[0], row[2], row[3], row[4]]).sort()).toEqual([
      ["Nghỉ thử", "Ho Gia Huy", "Waiting for approval", "Line Manager"],
      ["Nghỉ thử", "Tran Lan", "Waiting for approval", "Line Manager"],
    ]);
    expect(all.file.table.rows[0][5]).toBe(todayInVietnam());
    const scoped = await buildAllRequestsExport({ all: false, entityIds: [ids.creative] }, {}, new Map(), "vi");
    expect(scoped.file.table.rows.map((row) => [row[0], row[2]])).toEqual([["test_leave", "Tran Lan"]]);
    expect((await buildAllRequestsExport({ all: false, entityIds: [] }, {}, new Map(), "en")).file.table.rows).toEqual([]);
  });

  it("follows a project's requests too, reading them without a say in them", async () => {
    const { request } = await db().transaction((tx) => submitRequest(tx, brief, { entityId: ids.media, requesterPersonId: ids.huy, subjectPersonId: ids.huy, summary: "Dự án kín", payload: {}, link: (id) => `/x/${id}` }));
    expect((await listAllRequests({ all: true })).map((row) => row.id)).toEqual([request.id]);
    const view = await getRequest(ownerView(), brief, request.id);
    expect(view?.canDecide).toBe(false);
  });

  it("tells the owner once a morning what was filed the day before", async () => {
    await db().delete(schema.notification);
    await submit(ids.huy, ids.media, 2);
    await submit(ids.lan, ids.creative, 1);
    const tomorrow = addDays(todayInVietnam(), 1);
    expect(await sendOversightDigest(tomorrow)).toEqual({ filed: 2, told: 1 });
    expect(await sendOversightDigest(tomorrow)).toEqual({ filed: 2, told: 0 });
    const notices = await db().select().from(schema.notification).where(eq(schema.notification.kind, "approvals.oversight_digest"));
    expect(notices.map((row) => [row.recipientPersonId, row.params, row.link])).toEqual([[ids.owner, { date: todayInVietnam(), count: 2, open: 2 }, `/approvals/all?since=${todayInVietnam()}`]]);
    // Nothing filed, nothing sent.
    expect(await sendOversightDigest(addDays(tomorrow, 1))).toEqual({ filed: 0, told: 0 });
  });
});

// PLT-02: an approval never strands with a leaver or an absentee.
describe("a turn whose approver has left", () => {
  // What core HR does when a last day has passed: the person is offboarded and, in the same
  // transaction, their unanswered turns move on.
  const leave_ = (personId: string, actorPersonId: string | null = null) =>
    db().transaction(async (tx) => {
      await tx.update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, personId));
      return reassignTurnsOfLeaver(tx, personId, { actorPersonId });
    });
  const turnsOf = async (requestId: string) => (await db().select().from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, requestId))).map((row) => [row.approverPersonId, row.status, row.delegatedFromPersonId]);
  const moves = async (requestId: string) => (await db().select().from(schema.approvalEvent).where(eq(schema.approvalEvent.requestId, requestId))).filter((event) => event.type === "reassigned");
  const asked = async (personId: string) => (await db().select().from(schema.notification).where(eq(schema.notification.kind, "approvals.requested"))).filter((row) => row.recipientPersonId === personId).length;
  const hrFlow = { steps: [{ key: "hr", mode: "any" as const, approvers: [{ rule: "role" as const, role: "hr_staff" }] }] };
  let hrTwo = "";

  beforeAll(async () => {
    const [row] = await db().insert(schema.person).values({ fullName: "Hr Two", searchName: "hr two", workEmail: "hr.two@suzu.group", primaryEntityId: ids.media }).returning();
    hrTwo = row.id;
  });
  beforeEach(async () => {
    await db().delete(schema.notification);
    await db().delete(schema.roleAssignment).where(eq(schema.roleAssignment.personId, hrTwo));
    await db().update(schema.person).set({ status: "active" });
  });

  it("goes to whoever the step's rule names now, with an event saying why and a notice", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: hrFlow, active: true }, ids.owner);
    const { request, approverIds } = await submit(ids.huy, ids.media, 1);
    expect(approverIds).toEqual([ids.hr]);
    // A second HR person joins after the request was filed: the snapshot does not know them, the rule does.
    await db().insert(schema.roleAssignment).values({ personId: hrTwo, role: "hr_staff", scopeType: "entity", scopeId: ids.media, validFrom: "2024-01-01" });
    await db().delete(schema.notification);

    expect(await leave_(ids.hr, ids.owner)).toEqual({ moved: 1, stranded: 0 });
    expect(await turnsOf(request.id)).toEqual([[hrTwo, "pending", ids.hr]]);
    expect((await listInbox(hrTwo)).map((row) => row.id)).toEqual([request.id]);
    expect(await listInbox(ids.hr)).toEqual([]);
    const [event] = await moves(request.id);
    expect(event).toMatchObject({ actorPersonId: ids.owner, stepIndex: 0, meta: { reason: "offboarded", fromPersonId: ids.hr, fromName: "Hr Staff", to: [{ personId: hrTwo, name: "Hr Two" }] } });
    expect(await asked(hrTwo)).toBe(1);
    // The new approver answers it like any other.
    expect((await decide(request.id, hrTwo)).outcome).toBe("approved");
  });

  it("falls back to the owners when the rule names nobody else", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    expect(await leave_(ids.manager)).toEqual({ moved: 1, stranded: 0 });
    expect(await turnsOf(request.id)).toEqual([[ids.owner, "pending", ids.manager]]);
    const [event] = await moves(request.id);
    // Nobody ended the employment by hand: the nightly roll-over did.
    expect(event).toMatchObject({ actorPersonId: null, meta: { reason: "offboarded", to: [{ personId: ids.owner, name: "The Owner" }] } });
    expect(await asked(ids.owner)).toBe(1);
    expect((await decide(request.id, ids.owner)).outcome).toBe("approved");
  });

  it("leaves the step to the others who were asked, and never finishes it by itself", async () => {
    await db().insert(schema.roleAssignment).values({ personId: hrTwo, role: "hr_staff", scopeType: "entity", scopeId: ids.media, validFrom: "2024-01-01" });
    await saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ ...hrFlow.steps[0], mode: "all" }] }, active: true }, ids.owner);
    const { request } = await submit(ids.huy, ids.media, 1);
    expect((await turnsOf(request.id)).map(([personId]) => personId).sort()).toEqual([ids.hr, hrTwo].sort());
    await db().delete(schema.notification);

    expect(await leave_(ids.hr)).toEqual({ moved: 1, stranded: 0 });
    expect(await turnsOf(request.id)).toEqual([[hrTwo, "pending", null]]);
    expect((await moves(request.id))[0].meta).toMatchObject({ reason: "offboarded", to: [] });
    // Nobody new was asked: the other approver already knows.
    expect(await asked(hrTwo)).toBe(0);
    expect((await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, request.id)))[0].status).toBe("pending");
    expect((await decide(request.id, hrTwo)).outcome).toBe("approved");
  });

  it("when everyone else on the step has answered, the owners take the leaver's place", async () => {
    await db().insert(schema.roleAssignment).values({ personId: hrTwo, role: "hr_staff", scopeType: "entity", scopeId: ids.media, validFrom: "2024-01-01" });
    await saveFlow({ requestType: "test_leave", entityId: null, definition: { steps: [{ ...hrFlow.steps[0], mode: "all" }] }, active: true }, ids.owner);
    const { request } = await submit(ids.huy, ids.media, 1);
    expect((await decide(request.id, hrTwo)).outcome).toBe("pending");
    await leave_(ids.hr);
    expect((await turnsOf(request.id)).sort()).toEqual(
      [
        [hrTwo, "approved", null],
        [ids.owner, "pending", ids.hr],
      ].sort(),
    );
    expect((await decide(request.id, ids.owner)).outcome).toBe("approved");
  });

  it("moves a turn on a step that has not opened yet, and asks nobody until it does", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: twoStep, active: true }, ids.owner);
    const { request } = await submit(ids.huy, ids.media, 5);
    expect(await leave_(ids.head)).toEqual({ moved: 1, stranded: 0 });
    expect(await asked(ids.owner)).toBe(0);
    expect((await moves(request.id))[0]).toMatchObject({ stepIndex: 1 });
    expect((await decide(request.id, ids.manager)).outcome).toBe("pending");
    expect(await asked(ids.owner)).toBe(1);
    expect((await decide(request.id, ids.owner)).outcome).toBe("approved");
  });

  it("gives the turn back to the approver a leaver was standing in for", async () => {
    const today = todayInVietnam();
    await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: addDays(today, 7), requestTypes: null, reason: "holiday" });
    const { request, approverIds } = await submit(ids.huy, ids.media, 1);
    expect(approverIds).toEqual([ids.deputy]);
    await leave_(ids.deputy);
    // The delegation's stand-in is gone, so the manager is asked themself.
    expect(await turnsOf(request.id)).toEqual([[ids.manager, "pending", ids.deputy]]);
  });

  it("leaves alone what is decided, and a turn it cannot give to anyone", async () => {
    const done = await submit(ids.huy, ids.media, 1);
    await decide(done.request.id, ids.manager);
    // The owner's own request, waiting for a head who is also the only other candidate: no owner may answer it.
    const own = await db().transaction((tx) =>
      submitRequest(tx, defineRequestType({ type: "test_named", flow: { steps: [{ key: "named", mode: "any", approvers: [{ rule: "person", personId: ids.head }] }] } }), {
        entityId: ids.media,
        requesterPersonId: ids.owner,
        subjectPersonId: ids.owner,
        summary: "the owner asks",
      }),
    );
    expect(await leave_(ids.manager)).toEqual({ moved: 0, stranded: 0 });
    expect(await leave_(ids.head)).toEqual({ moved: 0, stranded: 1 });
    expect(await turnsOf(own.request.id)).toEqual([[ids.head, "pending", null]]);
    expect(await moves(own.request.id)).toEqual([]);
  });

  it("sweeps up a turn left with someone who went before their turns moved with them", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, ids.manager));
    expect(await reassignStrandedTurns()).toEqual({ moved: 1, stranded: 0 });
    expect(await turnsOf(request.id)).toEqual([[ids.owner, "pending", ids.manager]]);
    // Once, not every night.
    expect(await reassignStrandedTurns()).toEqual({ moved: 0, stranded: 0 });
  });

  it("moves it on when a returned request comes round again to someone who has left since", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: twoStep, active: true }, ids.owner);
    const { request } = await submit(ids.huy, ids.media, 5);
    await decide(request.id, ids.manager);
    await decide(request.id, ids.head, "return");
    // The manager had answered, so there was nothing of theirs to move when they left.
    expect(await leave_(ids.manager)).toEqual({ moved: 0, stranded: 0 });
    await db().delete(schema.notification);
    await db().transaction((tx) => resubmitRequest(tx, leave, request.id, ids.huy, { summary: "5 days, corrected" }));
    expect((await listInbox(ids.owner)).map((row) => row.id)).toEqual([request.id]);
    expect(await asked(ids.owner)).toBe(1);
    expect(await asked(ids.manager)).toBe(0);
  });
});

describe("sending a returned request round again", () => {
  it("accepts it unchanged — the approver may have asked a question rather than for an edit", async () => {
    await db().update(schema.person).set({ status: "active" });
    const { request } = await submit(ids.huy, ids.media, 2);
    await decide(request.id, ids.manager, "return");
    const { request: after } = await db().transaction((tx) => resubmitRequest(tx, leave, request.id, ids.huy, {}));
    expect(after.status).toBe("pending");
    expect(after.summary).toBe("2 days");
    expect((await listInbox(ids.manager)).map((row) => row.id)).toEqual([request.id]);
  });
});

describe("an administrator moves a turn", () => {
  const hrPrincipal = () => ({ personId: ids.hr, workforceType: "employee" as const, grants: [{ role: "hr_staff" as const, scope: { type: "entity" as const, id: ids.media } }] });
  const ownerPrincipal = () => ({ personId: ids.owner, workforceType: "employee" as const, grants: [{ role: "owner" as const, scope: { type: "group" as const } }] });
  const reassign = (requestId: string, fromPersonId: string, toPersonId: string, actorPersonId = ids.hr) => db().transaction((tx) => reassignRequest(tx, requestId, actorPersonId, { fromPersonId, toPersonId, reason: "On sick leave" }));

  beforeEach(async () => {
    await db().delete(schema.notification);
    await db().update(schema.person).set({ status: "active" });
  });

  it("lets whoever answers for the request's subject move it, and nobody else", async () => {
    const mine = await submit(ids.huy, ids.media, 1);
    const theirs = await submit(ids.lan, ids.creative, 1);
    expect(await mayReassignRequest(hrPrincipal(), mine.request.id)).toBe(true);
    // Out of scope: Lan sits in Creative, the grant covers Media.
    expect(await mayReassignRequest(hrPrincipal(), theirs.request.id)).toBe(false);
    expect(await mayReassignRequest(ownerPrincipal(), theirs.request.id)).toBe(true);
    // The approver, a colleague, and the requester themself have no say in who approves.
    expect(await mayReassignRequest({ personId: ids.manager, workforceType: "employee", grants: [] }, mine.request.id)).toBe(false);
    expect(await mayReassignRequest({ personId: ids.huy, workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] }, mine.request.id)).toBe(false);
    expect(await mayReassignRequest(ownerPrincipal(), "00000000-0000-4000-8000-000000000000")).toBe(false);

    // A request about nobody: whoever answers for its requester.
    const page = await db().transaction((tx) =>
      submitRequest(tx, defineRequestType({ type: "test_page", flow: { steps: [{ key: "review", mode: "any", approvers: [{ rule: "line_manager" }] }] } }), {
        entityId: ids.creative,
        requesterPersonId: ids.lan,
        subjectPersonId: null,
        summary: "A page",
      }),
    );
    expect(await mayReassignRequest(hrPrincipal(), page.request.id)).toBe(false);
    expect(await mayReassignRequest(ownerPrincipal(), page.request.id)).toBe(true);
  });

  it("moves the open turn, keeps the reason, tells the new approver, and shows it on the request", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    // The approver is suspended: nothing moves by itself.
    await db().update(schema.person).set({ status: "suspended" }).where(eq(schema.person.id, ids.manager));
    expect((await listTurnsOf(ids.manager)).map((row) => [row.id, row.reassignTarget?.personId])).toEqual([[request.id, ids.huy]]);

    await db().delete(schema.notification);
    const moved = await reassign(request.id, ids.manager, ids.deputy);
    expect(moved).toMatchObject({ fromName: "Line Manager", toName: "The Deputy" });
    expect((await listInbox(ids.deputy)).map((row) => row.id)).toEqual([request.id]);
    expect(await listTurnsOf(ids.manager)).toEqual([]);
    const events = await db().select().from(schema.approvalEvent).where(eq(schema.approvalEvent.requestId, request.id));
    expect(events.at(-1)).toMatchObject({ type: "reassigned", actorPersonId: ids.hr, comment: "On sick leave", meta: { reason: "administrator", fromPersonId: ids.manager, toPersonId: ids.deputy, toName: "The Deputy" } });
    const notices = await db().select().from(schema.notification);
    // The approver it was taken from is suspended, and a suspended person is told nothing (notify);
    // somebody merely away would have had "approvals.turn_reassigned".
    expect(notices.map((row) => [row.kind, row.recipientPersonId])).toEqual([["approvals.requested", ids.deputy]]);

    const view = await getRequest({ personId: ids.hr, principal: hrPrincipal() }, { ...leave, canView: () => true }, request.id);
    expect(view).toMatchObject({ canReassign: true, canDecide: false });
    expect((await listAllRequests({ all: true }, { state: "open" })).map((row) => [row.waiting, row.reassignTarget?.personId])).toEqual([[[{ personId: ids.deputy, name: "The Deputy" }], ids.huy]]);
    expect((await decide(request.id, ids.deputy)).outcome).toBe("approved");
    expect((await getRequest({ personId: ids.hr, principal: hrPrincipal() }, { ...leave, canView: () => true }, request.id))?.canReassign).toBe(false);
  });

  it("holds the engine's rules: nobody approves their own request, sits on a step twice, or takes a turn that is not open", async () => {
    await saveFlow({ requestType: "test_leave", entityId: null, definition: twoStep, active: true }, ids.owner);
    const { request } = await submit(ids.huy, ids.media, 5);
    await expect(reassign(request.id, ids.manager, ids.huy)).rejects.toThrow("approval_own_request");
    // The head's turn has not opened; the deputy has none at all.
    await expect(reassign(request.id, ids.head, ids.deputy)).rejects.toThrow("approval_reassign_refused");
    await expect(reassign(request.id, ids.deputy, ids.hr)).rejects.toThrow("approval_reassign_refused");
    // Someone who is not here to answer, and someone who sees no directory.
    await db().update(schema.person).set({ status: "suspended" }).where(eq(schema.person.id, ids.deputy));
    await expect(reassign(request.id, ids.manager, ids.deputy)).rejects.toThrow("delegation_person_unknown");
    // Someone asked later may take the earlier turn; they then answer both.
    await reassign(request.id, ids.manager, ids.head);
    expect((await decide(request.id, ids.head)).outcome).toBe("pending");
    expect((await decide(request.id, ids.head)).outcome).toBe("approved");
    await expect(reassign(request.id, ids.head, ids.hr)).rejects.toThrow("approval_not_pending");
  });

  it("gives a request that carries restricted values only to someone who reads that tier", async () => {
    const sealed = await db().transaction((tx) => submitRequest(tx, leave, { entityId: ids.media, requesterPersonId: ids.huy, subjectPersonId: ids.huy, summary: "bank account", payloadEnc: "sealed" }));
    // The deputy is a colleague: the directory tier. HR over the entity reads restricted.
    await expect(reassign(sealed.request.id, ids.manager, ids.deputy, ids.owner)).rejects.toThrow("approval_reassign_tier");
    await reassign(sealed.request.id, ids.manager, ids.hr, ids.owner);
    expect((await listInbox(ids.hr)).map((row) => row.id)).toEqual([sealed.request.id]);
    // The same request without a sealed part goes to anyone who works here.
    const plain = await submit(ids.huy, ids.media, 1);
    await reassign(plain.request.id, ids.manager, ids.deputy, ids.owner);
  });
});

describe("a delegation set for someone who is away", () => {
  const today = todayInVietnam();
  beforeEach(async () => {
    await db().delete(schema.notification);
    await db().update(schema.person).set({ status: "active" });
  });

  it("is the absent person's delegation, tells them who set it, and routes new requests", async () => {
    const row = await createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: addDays(today, 7), requestTypes: null, reason: "In hospital" }, ids.hr);
    expect(row).toMatchObject({ fromPersonId: ids.manager, toPersonId: ids.deputy, reason: "In hospital" });
    const notices = await db().select().from(schema.notification);
    expect(notices.map((notice) => [notice.kind, notice.recipientPersonId]).sort()).toEqual(
      [
        ["approvals.delegated_to_you", ids.deputy],
        ["approvals.delegation_set_for_you", ids.manager],
      ].sort(),
    );
    expect(notices.find((notice) => notice.kind === "approvals.delegation_set_for_you")?.params).toMatchObject({ actor: "Hr Staff", delegate: "The Deputy" });
    expect((await submit(ids.huy, ids.media, 1)).approverIds).toEqual([ids.deputy]);
    // Theirs to see and to end; an administrator ends it through the same row.
    expect((await listDelegations(ids.manager)).given.map((given) => given.id)).toEqual([row.id]);
    expect((await findDelegation(row.id))?.fromPersonId).toBe(ids.manager);
    await revokeDelegation(ids.manager, row.id);
    expect((await submit(ids.huy, ids.media, 1)).approverIds).toEqual([ids.manager]);
  });

  it("hands over what is already waiting in the administrator's name, under the tier rule", async () => {
    const { request } = await submit(ids.huy, ids.media, 1);
    await db().transaction((tx) => delegateRequest(tx, request.id, ids.manager, { toPersonId: ids.deputy, comment: "In hospital", onBehalfBy: ids.hr }));
    expect((await listInbox(ids.deputy)).map((inbox) => inbox.id)).toEqual([request.id]);
    const events = await db().select().from(schema.approvalEvent).where(eq(schema.approvalEvent.requestId, request.id));
    expect(events.at(-1)).toMatchObject({ type: "delegated", actorPersonId: ids.hr, comment: "In hospital", meta: { toPersonId: ids.deputy, fromPersonId: ids.manager, fromName: "Line Manager" } });

    const sealed = await db().transaction((tx) => submitRequest(tx, leave, { entityId: ids.media, requesterPersonId: ids.huy, subjectPersonId: ids.huy, summary: "bank account", payloadEnc: "sealed" }));
    await expect(db().transaction((tx) => delegateRequest(tx, sealed.request.id, ids.manager, { toPersonId: ids.deputy, onBehalfBy: ids.hr }))).rejects.toThrow("approval_reassign_tier");
    // The approver handing on their own turn is their own judgement, as before.
    await db().transaction((tx) => delegateRequest(tx, sealed.request.id, ids.manager, { toPersonId: ids.deputy }));
  });

  it("is refused for someone who has left: their turns moved when they did", async () => {
    await db().update(schema.person).set({ status: "offboarded" }).where(eq(schema.person.id, ids.manager));
    await expect(createDelegation(ids.manager, { toPersonId: ids.deputy, validFrom: today, validTo: today, requestTypes: null, reason: "gone" }, ids.hr)).rejects.toThrow("delegation_person_unknown");
  });
});
