// The company calendar behind an adapter, exactly the shape Google Chat uses
// (`platform/notifications/chat.ts`) and web push before it. Written for interview scheduling
// (FR-REC-06) and used by project meetings too (FR-PJM-30), which is why it sits in the platform
// rather than in either of them. Two drivers, chosen by configuration:
//
//   · **"local"** — no service account → nothing leaves the machine. The delivery is recorded as
//     `simulated`, and that is not a degraded mode: the row in our own database *is* the schedule
//     (an interview also hands every participant an `.ics` their own calendar understands).
//     Scheduling works end to end with no integration at all, which is the point.
//   · **"google"** — creates the event on a Google Calendar and asks for a Meet link.
//
// **The Google driver has never been run.** The company has no service account and the incremental
// OAuth scopes were never set up, so this is written against Google's documented API (service
// account, domain-wide delegation, `events.insert` with `conferenceDataVersion=1`) and is untested
// against a real calendar. It is listed under "Needs the owner"; until then the local driver runs.
import "server-only";
import { createSign } from "node:crypto";
import { env } from "@/lib/env";

export type CalendarAttendee = { email: string; name: string; optional?: boolean };

export type CalendarEvent = {
  /** The same UID an `.ics` of the event carries, so the two describe one event rather than two. */
  uid: string;
  summary: string;
  description: string;
  location: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  attendees: readonly CalendarAttendee[];
  /** Ask Google for a Meet link. Ignored by the local driver, which has no video service. */
  wantsMeeting: boolean;
};

export type CalendarResult =
  | { status: "simulated" }
  | { status: "sent"; eventId: string; meetingUrl: string | null }
  | { status: "failed"; error: string };

export type CalendarDriver = {
  name: "google" | "local";
  /** Which calendar is written to; never a credential. Recorded on the row that asked for it. */
  calendarId: string | null;
  create: (event: CalendarEvent) => Promise<CalendarResult>;
  /** Rewrites an event already out there — the time moved, somebody else is coming. */
  update: (eventId: string, event: CalendarEvent) => Promise<CalendarResult>;
  cancel: (eventId: string) => Promise<CalendarResult>;
};

const localDriver: CalendarDriver = {
  name: "local",
  calendarId: null,
  create: async () => ({ status: "simulated" }),
  update: async () => ({ status: "simulated" }),
  cancel: async () => ({ status: "simulated" }),
};

// ── The Google driver (written, never run) ──────────────────────────────────────────────────

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

type ServiceAccount = { email: string; privateKey: string; impersonate: string; calendarId: string };

const base64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/**
 * A signed JWT assertion (RFC 7523, which is what Google's service-account flow is). `sub` is the
 * domain-wide-delegation subject: without impersonating a real mailbox Google refuses to create a
 * Meet conference, so the mailbox is configuration rather than something guessed here.
 */
function assertionFor(account: ServiceAccount, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: account.email, sub: account.impersonate, scope: CALENDAR_SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  // The key is stored with literal "\n" in an environment variable, as every deployment does it.
  return `${header}.${claims}.${signer.sign(account.privateKey.replace(/\\n/g, "\n"), "base64url")}`;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertionFor(account, new Date()) }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`token: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("token: no access_token in the response");
  return body.access_token;
}

/** Google wants a local wall-clock time *and* the zone it is in; the instants here are UTC. */
const googleTime = (at: Date, timeZone: string) => ({ dateTime: at.toISOString(), timeZone });

/** The event as Google's API wants it. `iCalUID` is only accepted on an insert, so it is passed in. */
const googleBody = (event: CalendarEvent, withUid: boolean) => ({
  // Google's `iCalUID` is the same identifier the .ics carries, so importing the file and
  // syncing the calendar cannot produce two events.
  ...(withUid ? { iCalUID: event.uid } : {}),
  summary: event.summary,
  description: event.description,
  location: event.location ?? undefined,
  start: googleTime(event.start, event.timeZone),
  end: googleTime(event.end, event.timeZone),
  attendees: event.attendees.map((attendee) => ({ email: attendee.email, displayName: attendee.name, optional: attendee.optional ?? false })),
  ...(event.wantsMeeting ? { conferenceData: { createRequest: { requestId: event.uid, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
});

/** Where a Meet link ends up in an answer, whichever way Google chose to put it there. */
const meetingUrlOf = (event: { hangoutLink?: string; conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] } }): string | null =>
  event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ?? null;

function googleDriver(account: ServiceAccount): CalendarDriver {
  const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(account.calendarId)}/events`;

  /** An insert and a patch differ only in the method, the URL and whether the UID may be sent. */
  const write = async (url: string, method: "POST" | "PATCH", event: CalendarEvent, fallbackId: string): Promise<CalendarResult> => {
    try {
      const token = await accessToken(account);
      const response = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(googleBody(event, method === "POST")),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
      const written = (await response.json()) as { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] } };
      return { status: "sent", eventId: written.id ?? fallbackId, meetingUrl: meetingUrlOf(written) };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    name: "google",
    calendarId: account.calendarId,
    create: (event) => write(`${eventsUrl}?conferenceDataVersion=1&sendUpdates=none`, "POST", event, event.uid),
    update: (eventId, event) => write(`${eventsUrl}/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`, "PATCH", event, eventId),
    cancel: async (eventId) => {
      try {
        const token = await accessToken(account);
        const response = await fetch(`${eventsUrl}/${encodeURIComponent(eventId)}?sendUpdates=none`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        // 410 is "already gone", which is the outcome asked for.
        if (!response.ok && response.status !== 410) return { status: "failed", error: `${response.status} ${(await response.text()).slice(0, 300)}` };
        return { status: "sent", eventId, meetingUrl: null };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** All four settings or none: a half-configured integration is worse than none at all. */
export function calendarDriver(): CalendarDriver {
  const {
    GOOGLE_CALENDAR_ID: calendarId,
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: email,
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY: privateKey,
    GOOGLE_CALENDAR_IMPERSONATE: impersonate,
  } = env();
  if (!calendarId || !email || !privateKey || !impersonate) return localDriver;
  return googleDriver({ calendarId, email, privateKey, impersonate });
}
