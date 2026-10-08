// The endpoints a kiosk tablet calls: refused without an open kiosk behind the cookie — and told
// apart when the kiosk ran out of time — refused past the session's rate limit, a punch only for
// the face the server itself names, the earlier time within the minute, "Not me", and the QR code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const kiosk = { session: { id: "s1" }, device: { id: "d1", entityId: "e1", name: "Cửa chính" }, entityIds: ["e1"] };
const TOKEN = `szk_${"a".repeat(43)}`;
/** The token of a kiosk past its lifetime. */
const LAPSED = `szk_${"b".repeat(43)}`;
const limit = vi.fn();
const recognise = vi.fn();
const commit = vi.fn();
const recent = vi.fn();
const withdraw = vi.fn();
const next = vi.fn();
const audit = vi.fn();

vi.mock("./kiosk", () => ({
  kioskTokenOf: (request: Request) => /suzu_kiosk=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null,
  kioskAccessOfToken: async (token: string | null) => (token === TOKEN ? { status: "open", kiosk } : token === LAPSED ? { status: "expired" } : { status: "none" }),
  kioskQrCodes: () => [{ window: 1, url: "https://suzu.one/attendance/check-in/kiosk?t=x" }],
}));
vi.mock("./faces", () => ({ recogniseFace: (...args: unknown[]) => recognise(...args) }));
vi.mock("./endpoint-limit", () => ({ endpointKey: (kind: string, id: string) => `${kind}:${id}`, countEndpointHit: (...args: unknown[]) => limit(...args) }));
vi.mock("./devices", () => ({
  KIOSK_COOLDOWN_MS: 60_000,
  commitKioskPunch: (...args: unknown[]) => commit(...args),
  recentKioskPunches: (...args: unknown[]) => recent(...args),
  nextKioskDirection: (...args: unknown[]) => next(...args),
  withdrawKioskPunch: (...args: unknown[]) => withdraw(...args),
}));
vi.mock("@/modules/platform/audit/service", () => ({ recordAudit: (entry: unknown) => audit(entry) }));
vi.mock("@/lib/observability/report", () => ({ reportError: async () => undefined }));

import { identify, punch, qr, undo } from "./kiosk-api";

const embedding = Array.from({ length: 128 }, () => 0.1);
const PERSON = "7d1f2b9e-1c3a-4b5d-8e6f-0a1b2c3d4e5f";
const request = (path: string, body?: unknown, cookie: string | null = `suzu_kiosk=${TOKEN}`) =>
  new Request(`https://suzu.one${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => {
  recognise.mockReset().mockResolvedValue({ personId: PERSON, name: "Huy", entityId: "e1", score: 0.71 });
  limit.mockReset().mockResolvedValue({ ok: true });
  commit.mockReset().mockResolvedValue({ punchId: "p1", at: new Date("2026-10-02T01:42:00Z"), direction: "in", repeat: false });
  next.mockReset().mockResolvedValue("in");
  recent.mockReset().mockResolvedValue(new Map());
  withdraw.mockReset();
  audit.mockReset();
});

describe("the kiosk's endpoints", () => {
  it("refuse a browser without an open kiosk", async () => {
    for (const response of [
      await identify(request("/api/kiosk/identify", { embedding }, null)),
      await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }, "suzu_kiosk=szk_old")),
      await undo(request("/api/kiosk/undo", { punchId: PERSON }, null)),
      await qr(request("/api/kiosk/qr", undefined, null)),
    ]) {
      expect(response.status).toBe(401);
    }
    expect(recognise).not.toHaveBeenCalled();
    // Nothing is counted for a caller with no kiosk behind it: a stranger cannot fill the limiter's table.
    expect(limit).not.toHaveBeenCalled();
  });

  it("tell a kiosk that ran out of time that it needs opening again, and do nothing for it", async () => {
    const cookie = `suzu_kiosk=${LAPSED}`;
    for (const response of [
      await identify(request("/api/kiosk/identify", { embedding }, cookie)),
      await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }, cookie)),
      await undo(request("/api/kiosk/undo", { punchId: PERSON }, cookie)),
      await qr(request("/api/kiosk/qr", undefined, cookie)),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "expired" });
    }
    expect((await (await qr(request("/api/kiosk/qr", undefined, null))).json()).error).toBe("unauthorized");
    expect(recognise).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("count every call against the kiosk session, and refuse past the limit before doing anything", async () => {
    await identify(request("/api/kiosk/identify", { embedding }));
    await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }));
    await undo(request("/api/kiosk/undo", { punchId: PERSON }));
    await qr(request("/api/kiosk/qr"));
    expect(limit.mock.calls).toEqual([
      ["kiosk_identify", "kiosk:s1"],
      ["kiosk_punch", "kiosk:s1"],
      ["kiosk_undo", "kiosk:s1"],
      ["kiosk_qr", "kiosk:s1"],
    ]);

    recognise.mockClear();
    withdraw.mockClear();
    commit.mockClear();
    limit.mockResolvedValue({ ok: false, retryAfterSeconds: 17 });
    for (const response of [
      await identify(request("/api/kiosk/identify", { embedding })),
      await punch(request("/api/kiosk/punch", { personId: PERSON, embedding })),
      await undo(request("/api/kiosk/undo", { punchId: PERSON })),
      await qr(request("/api/kiosk/qr")),
    ]) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("17");
      expect(await response.json()).toEqual({ error: "rate_limited" });
    }
    expect(recognise).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
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
    // The punch carries the tablet session it came through.
    expect(commit).toHaveBeenCalledWith("d1", { personId: PERSON, entityId: "e1" }, "face", expect.any(Date), "s1");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.kiosk.punch", resource: { type: "attendance_device", id: "d1", entityId: "e1" } }));

    recognise.mockResolvedValueOnce({ personId: "someone-else", name: "Nhu", entityId: "e1", score: 0.6 });
    expect((await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }))).status).toBe(409);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("shows the earlier time within the minute instead of punching again", async () => {
    // The interval is the commit's to decide (one transaction, under the person's lock): it answers with the earlier punch.
    commit.mockResolvedValueOnce({ punchId: null, at: new Date("2026-10-02T10:31:30Z"), direction: "out", repeat: true });
    expect(await (await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }))).json()).toEqual({ punchId: null, at: "2026-10-02T10:31:30.000Z", name: "Huy", repeat: true, direction: "out" });
    // Nothing was written, so nothing is audited.
    expect(audit).not.toHaveBeenCalled();
  });

  it('takes a punch back on "Not me", and audits only what it took back', async () => {
    withdraw.mockResolvedValueOnce({ personId: PERSON, at: new Date("2026-10-02T01:42:00Z") });
    expect(await (await undo(request("/api/kiosk/undo", { punchId: PERSON }))).json()).toEqual({ cancelled: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.kiosk.punch_withdrawn" }));
    withdraw.mockResolvedValueOnce(null);
    audit.mockReset();
    expect(await (await undo(request("/api/kiosk/undo", { punchId: PERSON }))).json()).toEqual({ cancelled: false });
    expect(audit).not.toHaveBeenCalled();
  });

  it("hands out the QR codes of the next minutes at once, with the server's clock", async () => {
    const body = await (await qr(request("/api/kiosk/qr"))).json();
    expect(body.codes).toEqual([{ window: 1, url: "https://suzu.one/attendance/check-in/kiosk?t=x" }]);
    expect(Math.abs(body.now - Date.now())).toBeLessThan(5_000);
  });

  it("answers 500 when something breaks, never a stack", async () => {
    commit.mockRejectedValueOnce(new Error("db down"));
    const response = await punch(request("/api/kiosk/punch", { personId: PERSON, embedding }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "failed" });
  });
});
