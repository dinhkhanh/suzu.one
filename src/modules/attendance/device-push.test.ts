// The endpoint a time clock posts to: refused without its token, refused past its rate limit, a bad
// body answered with a 400, a clock set in the future refused line by line, and everything else
// committed and audited.
import { beforeEach, describe, expect, it, vi } from "vitest";

const device = { id: "d1", entityId: "e1", name: "Face kiosk" };
const presenting = vi.fn();
const commit = vi.fn();
const audit = vi.fn();
const limit = vi.fn();
vi.mock("./endpoint-limit", () => ({ endpointKey: (kind: string, id: string) => `${kind}:${id}`, countEndpointHit: (...args: unknown[]) => limit(...args) }));
vi.mock("./devices", () => ({
  devicePresentingToken: (token: string) => presenting(token),
  commitPushedRows: (deviceId: string, rows: unknown) => commit(deviceId, rows),
  deviceRoster: async () => [{ userId: "SZM-0004", fullName: "Bảo", employeeCode: "SZM-0004" }],
}));
vi.mock("@/modules/platform/audit/service", () => ({ recordAudit: (entry: unknown) => audit(entry) }));
vi.mock("@/lib/observability/report", () => ({ reportError: async () => undefined }));

import { receivePunches, sendRoster } from "./device-push";

const TOKEN = `szd_${"a".repeat(43)}`;
const post = (body: unknown, token: string | null = TOKEN) =>
  new Request("https://suzu.one/api/attendance/device/punches", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  presenting.mockReset().mockImplementation(async (token: string) => (token === TOKEN ? device : null));
  commit.mockReset().mockImplementation(async (_id: string, rows: unknown[]) => ({ punches: rows.length, skipped: 0, unmapped: 0, people: rows.length ? 1 : 0 }));
  audit.mockReset();
  limit.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/attendance/device/punches", () => {
  it("refuses a missing or wrong token without reading the body", async () => {
    expect((await receivePunches(post({ punches: [] }, null))).status).toBe(401);
    expect((await receivePunches(post({ punches: [] }, "szd_wrong"))).status).toBe(401);
    expect(commit).not.toHaveBeenCalled();
    // Nothing is counted for a caller with no clock behind it.
    expect(limit).not.toHaveBeenCalled();
  });

  it("counts each call against its clock, and past the limit answers 429 without reading the body", async () => {
    await receivePunches(post({ punches: [] }));
    expect(limit).toHaveBeenCalledWith("device_punches", "device:d1");
    limit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
    const response = await receivePunches(post("not json"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("answers a body it cannot read with 400", async () => {
    expect((await receivePunches(post("not json"))).status).toBe(400);
    const response = await receivePunches(post({ punches: [{ userId: "17", at: "2026-10-01 08:00:00" }] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid", issues: [{ path: "punches.0.at" }] });
  });

  it("commits the punches, refuses the ones from the future, and audits the batch", async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const response = await receivePunches(post({ punches: [{ userId: "SZM-0004", at: soon }, { userId: "SZM-0004", at: later }] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ punches: 1, skipped: 0, unmapped: 0, people: 1, refused: [2] });
    expect(commit.mock.calls[0][0]).toBe("d1");
    expect(commit.mock.calls[0][1]).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.device.push", resource: { type: "attendance_device", id: "d1", entityId: "e1" } }));
  });

  it("takes an empty batch as a heartbeat, with nothing to audit", async () => {
    expect((await receivePunches(post({ punches: [] }))).status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it("answers 500 when the commit fails, so the clock keeps the punches and resends", async () => {
    commit.mockRejectedValueOnce(new Error("db down"));
    expect((await receivePunches(post({ punches: [{ userId: "SZM-0004", at: new Date().toISOString() }] }))).status).toBe(500);
  });
});

describe("GET /api/attendance/device/roster", () => {
  it("lists the clock's people for its token only", async () => {
    expect((await sendRoster(new Request("https://suzu.one/api/attendance/device/roster"))).status).toBe(401);
    const response = await sendRoster(new Request("https://suzu.one/api/attendance/device/roster", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(await response.json()).toEqual({ device: "Face kiosk", people: [{ userId: "SZM-0004", fullName: "Bảo", employeeCode: "SZM-0004" }] });
  });
});
