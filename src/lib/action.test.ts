// createAction's last step (ENG-09): the change has committed by the time its audit entry is
// written, so a failed write must neither undo the answer nor go unnoticed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const recordAudit = vi.fn();
const reportError = vi.fn();
vi.mock("@/modules/platform/audit/service", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("@/lib/observability/report", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock("@/lib/cache/live", () => ({ invalidateLive: async () => undefined }));
vi.mock("@/modules/platform/auth/session", () => ({
  getCurrentUser: async () => ({ userId: "u1", person: { id: "p1" }, email: "an@suzu.vn", reauthAt: null, principal: { personId: "p1", workforceType: "employee", grants: [] }, request: { ipAddress: null, userAgent: null } }),
}));

const { AUDIT_ATTEMPTS, createAction } = await import("./action");

const changes: string[] = [];
const save = createAction({
  name: "thing.save",
  input: z.object({ value: z.string() }),
  authorize: () => true,
  run: async ({ input }) => {
    changes.push(input.value);
    return { data: { saved: input.value }, audit: { resource: { type: "thing", id: "t1" }, summary: "saved", after: { salary: 1 } } };
  },
});

beforeEach(() => {
  recordAudit.mockReset();
  reportError.mockReset();
  changes.length = 0;
});

describe("the audit entry of a committed change", () => {
  it("is written once when the database takes it", async () => {
    recordAudit.mockResolvedValue(undefined);
    expect(await save({ value: "a" })).toEqual({ ok: true, data: { saved: "a" } });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ action: "thing.save", actor: { personId: "p1" }, resource: { type: "thing", id: "t1" } });
  });

  it("is tried again when a write fails, and the person is not told it failed", async () => {
    recordAudit.mockRejectedValueOnce(new Error("connection reset")).mockResolvedValue(undefined);
    expect(await save({ value: "b" })).toEqual({ ok: true, data: { saved: "b" } });
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("is reported — by name, never by content — when it cannot be written, and the change still answers ok", async () => {
    recordAudit.mockRejectedValue(new Error("database down"));
    expect(await save({ value: "c" })).toEqual({ ok: true, data: { saved: "c" } });
    expect(changes).toEqual(["c"]);
    expect(recordAudit).toHaveBeenCalledTimes(AUDIT_ATTEMPTS);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [, context] = reportError.mock.calls[0];
    expect(context).toMatchObject({ event: "thing.save.audit_failed", tags: { action: "thing.save", actorPersonId: "p1", resourceType: "thing", resourceId: "t1" } });
    expect(JSON.stringify(context)).not.toContain("salary");
  });
});
