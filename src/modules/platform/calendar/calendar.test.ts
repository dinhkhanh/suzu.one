// The calendar adapter. Two things are worth a test and neither needs a database: which driver
// configuration chooses, and that the Google driver — the one that has never run against a real
// calendar — builds the request Google documents and never throws at its caller.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, string | undefined> = {};
vi.mock("@/lib/env", () => ({ env: () => settings }));

import { calendarDriver, putInCalendar, removeFromCalendar } from "./service";

/** A key that only has to parse: nothing here verifies a signature. */
const PRIVATE_KEY = (
  await import("node:crypto")
).generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;

const event = {
  uid: "meeting-1@suzu.one",
  summary: "Họp tuần — TVC Tết",
  description: "Duyệt kịch bản",
  location: null,
  start: new Date("2026-10-19T02:00:00Z"),
  end: new Date("2026-10-19T03:00:00Z"),
  timeZone: "Asia/Ho_Chi_Minh",
  attendees: [{ email: "tam@suzu.group", name: "Bùi Thanh Tâm" }],
  wantsMeeting: true,
};

const configure = () => {
  settings.GOOGLE_CALENDAR_ID = "work@suzu.group";
  settings.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL = "bot@project.iam.gserviceaccount.com";
  settings.GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY = PRIVATE_KEY.replaceAll("\n", "\\n");
  settings.GOOGLE_CALENDAR_IMPERSONATE = "hr@suzu.group";
};

/** Answers the token call, then the event call, and hands back what was asked of each. */
function fakeGoogle(eventResponse: { status: number; body: unknown }) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; body?: unknown }) => {
    // The token call posts a form; only the event call posts JSON.
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    return new Response(JSON.stringify(eventResponse.body), { status: eventResponse.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

beforeEach(() => {
  for (const key of Object.keys(settings)) delete settings[key];
});
afterEach(() => vi.unstubAllGlobals());

describe("choosing a driver", () => {
  it("runs locally, and says so, when there are no credentials", async () => {
    expect(calendarDriver().name).toBe("local");
    // "simulated" is the whole point: nothing left the machine and the page must not pretend it did.
    expect(await putInCalendar(event)).toEqual({ driver: "local", status: "simulated", eventId: null, meetingUrl: null, error: null });
    expect(await removeFromCalendar("evt-1")).toEqual({ driver: "local", status: "simulated", eventId: null, meetingUrl: null, error: null });
  });

  it("stays local when the integration is half configured — a missing mailbox is not a calendar", () => {
    configure();
    delete settings.GOOGLE_CALENDAR_IMPERSONATE;
    expect(calendarDriver().name).toBe("local");
  });

  it("takes the Google driver once all four settings are there", () => {
    configure();
    expect(calendarDriver()).toMatchObject({ name: "google", calendarId: "work@suzu.group" });
  });
});

describe("the Google driver", () => {
  it("inserts the event with its UID, its zone and a Meet request, and keeps the id and the link", async () => {
    configure();
    const calls = fakeGoogle({ status: 200, body: { id: "evt-9", hangoutLink: "https://meet.google.com/abc-defg-hij" } });
    expect(await putInCalendar(event)).toEqual({ driver: "google", status: "sent", eventId: "evt-9", meetingUrl: "https://meet.google.com/abc-defg-hij", error: null });
    const insert = calls[1] as { url: string; method: string; body: { iCalUID: string; start: { timeZone: string }; conferenceData?: unknown; attendees: { email: string }[] } };
    expect(insert.method).toBe("POST");
    expect(insert.url).toContain("conferenceDataVersion=1");
    expect(insert.body.iCalUID).toBe("meeting-1@suzu.one");
    expect(insert.body.start.timeZone).toBe("Asia/Ho_Chi_Minh");
    expect(insert.body.conferenceData).toBeTruthy();
    expect(insert.body.attendees).toEqual([{ email: "tam@suzu.group", displayName: "Bùi Thanh Tâm", optional: false }]);
  });

  it("patches the event it already has rather than making a second one", async () => {
    configure();
    const calls = fakeGoogle({ status: 200, body: { id: "evt-9", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xyz" }] } } });
    expect(await putInCalendar(event, "evt-9")).toMatchObject({ status: "sent", eventId: "evt-9", meetingUrl: "https://meet.google.com/xyz" });
    const patch = calls[1] as { url: string; method: string; body: Record<string, unknown> };
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toContain("/events/evt-9");
    // Google refuses an iCalUID on a patch; the event is already the one that UID names.
    expect(patch.body.iCalUID).toBeUndefined();
  });

  it("hands a refusal back to be stored instead of throwing, and keeps the event it had", async () => {
    configure();
    fakeGoogle({ status: 403, body: { error: "forbidden" } });
    const failed = await putInCalendar(event, "evt-9");
    expect(failed).toMatchObject({ driver: "google", status: "failed", eventId: "evt-9", meetingUrl: null });
    expect(failed.error).toContain("403");
  });

  it("treats an event Google no longer has as cancelled — 410 is the outcome asked for", async () => {
    configure();
    fakeGoogle({ status: 410, body: {} });
    expect(await removeFromCalendar("evt-9")).toEqual({ driver: "google", status: "sent", eventId: null, meetingUrl: null, error: null });
  });
});
