// The endpoints a kiosk tablet calls: refused without an open kiosk behind the cookie, a punch only
// for the face the server itself names, the earlier time within the minute, "Not me", and the QR code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const kiosk = { session: { id: "s1" }, device: { id: "d1", entityId: "e1", name: "Cửa chính" }, entityIds: ["e1"] };
const TOKEN = `szk_${"a".repeat(43)}`;
const recognise = vi.fn();
const commit = vi.fn();
const recent = vi.fn();
const withdraw = vi.fn();
const next = vi.fn();
const audit = vi.fn();

vi.mock("./kiosk", () => ({
  kioskTokenOf: (request: Request) => /suzu_kiosk=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null,
  kioskOfToken: async (token: string | null) => (token === TOKEN ? kiosk : null),
  kioskQrUrl: () => "https://suzu.one/attendance/check-in/kiosk?t=x",
}));
vi.mock("./faces", () => ({ recogniseFace: (...args: unknown[]) => recognise(...args) }));
vi.mock("./devices", () => ({
  commitKioskPunch: (...args: unknown[]) => commit(...args),
  recentKioskPunches: (...args: unknown[]) => recent(...args),
  nextKioskDirection: (...args: unknown[]) => next(...args),
  withdrawKioskPunch: (...args: unknown[]) => withdraw(...args),
}));
vi.mock("@/modules/assets/service", () => ({ qrPath: () => ({ path: "M0 0h1v1h-1z", size: 25 }) }));
vi.mock("@/modules/platform/audit/service", () => ({ recordAudit: (entry: unknown) => audit(entry) }));
vi.mock("@/lib/observability/report", () => ({ reportError: async () => undefined }));

import { identify, punch, qr, undo } from "./kiosk-api";

const embedding = Array.from({ length: 128 }, () => 0.1);
const PERSON = "7d1f2b9e-1c3a-4b5d-8e6f-0a1b2c3d4e5f";
const request = (path: string, body?: unknown, cookie: string | null = `suzu_kiosk=${TOKEN}`) =>
  new Request(`https://suzu.one${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => {
  recognise.mockReset().mockResolvedValue({ personId: PERSON, name: "Huy", entityId: "e1", score: 0.71 });
  commit.mockReset().mockResolvedValue({ punchId: "p1", at: new Date("2026-10-02T01:42:00Z"), direction: "in" });
  next.mockReset().mockResolvedValue("in");
  recent.mockReset().mockResolvedValue(new Map());
  withdraw.mockReset();
  audit.mockReset();
});

describe("the kiosk's endpoints", () => {
  it("refuse a browser without an open kiosk", async () => {
    for (const response of [await identify(request("/api/kiosk/identify", { embedding }, null)), await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }, "suzu_kiosk=szk_old")), await undo(request("/api/kiosk/undo", { punchId: PERSON }, null)), await qr(request("/api/kiosk/qr", undefined, null))]) {
      expect(response.status).toBe(401);
    }
    expect(recognise).not.toHaveBeenCalled();
  });

  it("says whether the face's next punch arrives or leaves", async () => {
    next.mockResolvedValueOnce("out");
    recent.mockResolvedValueOnce(new Map([[PERSON, { at: new Date("2026-10-02T10:30:00Z"), direction: "out" }]]));
    expect(await (await identify(request("/api/kiosk/identify", { embedding }))).json()).toEqual({ person: { personId: PERSON, name: "Huy", next: "out", recentAt: "2026-10-02T10:30:00.000Z", recentDirection: "out" } });
  });

  it("names a face among the kiosk's entities, with any punch of the last minute", async () => {
    const response = await identify(request("/api/kiosk/identify", { embedding }));
    expect(await response.json()).toEqual({ person: { personId: PERSON, name: "Huy", next: "in", recentAt: null, recentDirection: null } });
    expect(recognise).toHaveBeenCalledWith(embedding, ["e1"]);
    recognise.mockResolvedValueOnce(null);
    expect(await (await identify(request("/api/kiosk/identify", { embedding }))).json()).toEqual({ person: null });
    expect((await identify(request("/api/kiosk/identify", { embedding: embedding.slice(1) }))).status).toBe(400);
  });

  it("punches only when the server names the same person, and audits it", async () => {
    const response = await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }));
    expect(await response.json()).toEqual({ punchId: "p1", at: "2026-10-02T01:42:00.000Z", name: "Huy", repeat: false, direction: "in" });
    expect(commit).toHaveBeenCalledWith("d1", { personId: PERSON, entityId: "e1" }, "face");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.kiosk.punch", resource: { type: "attendance_device", id: "d1", entityId: "e1" } }));

    recognise.mockResolvedValueOnce({ personId: "someone-else", name: "Nhu", entityId: "e1", score: 0.6 });
    expect((await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }))).status).toBe(409);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("shows the earlier time within the minute instead of punching again", async () => {
    recent.mockResolvedValueOnce(new Map([[PERSON, { at: new Date("2026-10-02T10:31:30Z"), direction: "out" }]]));
    expect(await (await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }))).json()).toEqual({ punchId: null, at: "2026-10-02T10:31:30.000Z", name: "Huy", repeat: true, direction: "out" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("takes a punch back on \"Not me\", and audits only what it took back", async () => {
    withdraw.mockResolvedValueOnce({ personId: PERSON, at: new Date("2026-10-02T01:42:00Z") });
    expect(await (await undo(request("/api/kiosk/undo", { punchId: PERSON }))).json()).toEqual({ cancelled: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.kiosk.punch_withdrawn" }));
    withdraw.mockResolvedValueOnce(null);
    audit.mockReset();
    expect(await (await undo(request("/api/kiosk/undo", { punchId: PERSON }))).json()).toEqual({ cancelled: false });
    expect(audit).not.toHaveBeenCalled();
  });

  it("hands out the QR code, drawn on the server", async () => {
    expect(await (await qr(request("/api/kiosk/qr"))).json()).toEqual({ url: "https://suzu.one/attendance/check-in/kiosk?t=x", qr: { path: "M0 0h1v1h-1z", size: 25 } });
  });

  it("answers 500 when something breaks, never a stack", async () => {
    commit.mockRejectedValueOnce(new Error("db down"));
    const response = await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "failed" });
  });
});
