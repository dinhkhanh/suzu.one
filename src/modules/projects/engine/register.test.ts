import { describe, expect, it } from "vitest";
import { lineStatus, type RegisterStatus, registerProgress, type UnitFacts, unitsConsumed, unitStatus } from "./register";

const CATEGORIES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
const REVIEWS = [null, "pending", "approved", "changes_requested"] as const;
const CLIENT = [null, "approved", "approved_with_changes", "changes_required"] as const;

describe("deliverables register (FR-PJM-05)", () => {
  // The truth table of a unit with no client data at all, for client work and for work without a
  // client: rows are the task's state category, columns the internal review of its current version.
  //                                   no version         pending            approved             changes requested
  const BY_TASK: Record<(typeof CATEGORIES)[number], { client: RegisterStatus[]; noClient: RegisterStatus[] }> = {
    backlog: { client: ["promised", "in_production", "ready_for_client", "in_production"], noClient: ["promised", "in_production", "in_production", "in_production"] },
    todo: { client: ["promised", "in_production", "ready_for_client", "in_production"], noClient: ["promised", "in_production", "in_production", "in_production"] },
    in_progress: { client: ["in_production", "in_production", "ready_for_client", "in_production"], noClient: ["in_production", "in_production", "in_production", "in_production"] },
    in_review: { client: ["in_production", "in_production", "ready_for_client", "in_production"], noClient: ["in_production", "in_production", "in_production", "in_production"] },
    done: { client: ["ready_for_client", "ready_for_client", "ready_for_client", "ready_for_client"], noClient: ["accepted", "accepted", "accepted", "accepted"] },
  };

  it("places a unit by its task and its internal review when the client has said nothing", () => {
    for (const category of CATEGORIES) {
      REVIEWS.forEach((review, column) => {
        expect(unitStatus({ category, review }), `${category} / ${review} / client work`).toBe(BY_TASK[category].client[column]);
        expect(unitStatus({ category, review, noClient: true }), `${category} / ${review} / no client`).toBe(BY_TASK[category].noClient[column]);
      });
    }
  });

  it("never calls a unit accepted by the client's work without the client's word", () => {
    // Done, in review, reviewed and approved inside the house: none of it is the client's acceptance.
    for (const category of CATEGORIES) for (const review of REVIEWS) expect(unitStatus({ category, review })).not.toBe("accepted");
    // Nor is it "client review" unless the version was actually sent.
    for (const category of CATEGORIES) for (const review of REVIEWS) for (const noClient of [false, true]) expect(unitStatus({ category, review, noClient })).not.toBe("client_review");
  });

  it("lets the client's decision, the sending, a delivery and a publish record each overrule what is below them", () => {
    for (const category of CATEGORIES) {
      for (const review of REVIEWS) {
        for (const noClient of [false, true]) {
          const base: UnitFacts = { category, review, noClient };
          const below = unitStatus(base);
          for (const clientDecision of CLIENT) {
            // The client's answer decides, whatever the task and the internal review say.
            const decided = clientDecision === null ? below : clientDecision === "changes_required" ? "in_production" : "accepted";
            expect(unitStatus({ ...base, clientDecision }), JSON.stringify({ ...base, clientDecision })).toBe(decided);
            // A current version waiting on the client is in client review — even after an older approval or request.
            expect(unitStatus({ ...base, clientDecision, sentToClient: true })).toBe("client_review");
            for (const sentToClient of [false, true]) {
              expect(unitStatus({ ...base, clientDecision, sentToClient, delivered: true })).toBe("delivered");
              expect(unitStatus({ ...base, clientDecision, sentToClient, published: true })).toBe("published");
              expect(unitStatus({ ...base, clientDecision, sentToClient, delivered: true, published: true })).toBe("published");
            }
          }
        }
      }
    }
  });

  it("gives a cancelled task no status, whatever else is recorded on it", () => {
    for (const review of REVIEWS)
      for (const clientDecision of CLIENT) for (const flag of [false, true]) expect(unitStatus({ category: "cancelled", review, clientDecision, sentToClient: flag, noClient: flag, delivered: flag, published: flag })).toBeNull();
  });

  it("puts a line at its least advanced unit; unlinked units stay promised", () => {
    const twelvePosts = (units: Parameters<typeof lineStatus>[0]["units"]) => lineStatus({ quantity: 12, cancelled: false, units });
    const accepted = { category: "done" as const, clientDecision: "approved" as const };
    expect(twelvePosts([])).toMatchObject({ status: "promised", promised: 12, accepted: 0, awaitingClient: 0, linked: 0 });
    // Something started: in production, even though ten units have no task yet.
    expect(twelvePosts([accepted, { category: "in_progress" }])).toMatchObject({ status: "in_production", accepted: 1, linked: 2 });
    // Twelve tasks done and nothing heard from the client: ready for them, none accepted.
    expect(twelvePosts(Array.from({ length: 12 }, () => ({ category: "done" as const })))).toMatchObject({ status: "ready_for_client", accepted: 0, awaitingClient: 12 });
    const allAccepted = Array.from({ length: 12 }, () => accepted);
    expect(twelvePosts(allAccepted)).toMatchObject({ status: "accepted", accepted: 12, awaitingClient: 0 });
    expect(twelvePosts([...allAccepted.slice(1), { category: "in_review", sentToClient: true }])).toMatchObject({ status: "client_review", accepted: 11, awaitingClient: 1 });
    expect(twelvePosts([...allAccepted.slice(2), { category: "done" }, { category: "in_review", sentToClient: true }])).toMatchObject({ status: "ready_for_client", accepted: 10, awaitingClient: 2 });
    // Without a client the same twelve done tasks are the line accepted.
    expect(twelvePosts(Array.from({ length: 12 }, () => ({ category: "done" as const, noClient: true })))).toMatchObject({ status: "accepted", accepted: 12, awaitingClient: 0 });
    // Delivered and published units together: the line is delivered.
    expect(
      lineStatus({
        quantity: 2,
        cancelled: false,
        units: [
          { category: "done", delivered: true },
          { category: "done", published: true },
        ],
      }).status,
    ).toBe("delivered");
  });

  it("fills the promise with the most advanced units; cancelled tasks and lines count for nothing", () => {
    const line = lineStatus({ quantity: 1, cancelled: false, units: [{ category: "todo" }, { category: "done", clientDecision: "approved_with_changes" }, { category: "cancelled" }] });
    expect(line).toMatchObject({ status: "accepted", promised: 1, accepted: 1, linked: 2 });
    expect(line.counts).toEqual({ promised: 0, in_production: 0, ready_for_client: 0, client_review: 0, accepted: 1, delivered: 0, published: 0 });
    expect(lineStatus({ quantity: 3, cancelled: true, units: [{ category: "done", clientDecision: "approved" }] })).toMatchObject({ status: "cancelled", promised: 0, accepted: 0, awaitingClient: 0 });
  });

  it("measures progress as accepted ÷ promised, with what waits on the client beside it", () => {
    expect(
      registerProgress([
        { promised: 12, accepted: 6, awaitingClient: 4 },
        { promised: 4, accepted: 4, awaitingClient: 0 },
        { promised: 0, accepted: 0, awaitingClient: 0 },
      ]),
    ).toEqual({ promised: 16, accepted: 10, awaitingClient: 4, percent: 62 });
    expect(registerProgress([])).toEqual({ promised: 0, accepted: 0, awaitingClient: 0, percent: null });
  });

  it("counts consumed units — finished on our side — without the quantity's cap (FR-PJM-06)", () => {
    const done = { category: "done" as const };
    expect(unitsConsumed([done, done, { category: "in_progress" }, { category: "cancelled" }, { category: "in_review", clientDecision: "approved" }, { category: "in_review", sentToClient: true }])).toBe(4);
    expect(unitsConsumed(Array.from({ length: 15 }, () => done))).toBe(15);
    // Sent back by the client: not finished any more.
    expect(unitsConsumed([{ category: "done", clientDecision: "changes_required" }])).toBe(0);
    expect(unitsConsumed([])).toBe(0);
  });
});
