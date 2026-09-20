// A calendar file for one interview (RFC 5545). Pure: dates and strings in, one string out.
//
// This exists because Google Calendar is **not** available to this system — no keys, and the
// incremental OAuth scopes were never set up. Rather than let that stop interview scheduling, the
// internal `interview` row is the truth and this turns it into the one interchange format every
// calendar on earth reads. An `.ics` needs no integration, no account and no permission: the
// recruiter downloads it, the interviewer opens it, and it is in their calendar.
//
// Four details are the whole of why a hand-written `.ics` usually fails to import:
//   · **CRLF.** The spec says every line ends `\r\n`, and several clients mean it.
//   · **Folding at 75 *octets*, not characters.** A Vietnamese job title is two bytes a letter, so
//     counting characters produces lines that are legal-looking and too long. Folding also must not
//     cut a codepoint in half, which is why the walk below is over encoded bytes.
//   · **Escaping in TEXT values**: backslash, semicolon, comma and newline. A colon is *not*
//     escaped (it is only special in parameter values), and escaping it breaks Outlook.
//   · **UTC timestamps.** A local time without a VTIMEZONE block is a guess; `Z` is not.

export type IcsAttendee = { name: string; email: string; optional?: boolean };

export type IcsEvent = {
  /** Stable for the life of the event: a reschedule reuses it, which is what lets a client update rather than duplicate. */
  uid: string;
  /** Bumped on every change to the same UID. A client ignores an update whose sequence did not move. */
  sequence?: number;
  /** When this file was produced. */
  stamp: Date;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer?: { name: string; email: string } | null;
  attendees?: readonly IcsAttendee[];
  /** A cancellation is the same UID with a higher sequence and `METHOD:CANCEL`. */
  cancelled?: boolean;
};

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** `20260921T093000Z`. Always UTC: see the note at the top. */
export function icsInstant(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/** RFC 5545 §3.3.11. Order matters: the backslash has to be doubled before anything else adds one. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * A parameter value (a CN, say). Parameters are quoted rather than escaped, and a quoted value may
 * not itself contain a quote — so quotes are dropped, along with the control characters that would
 * end the line early.
 */
function parameterValue(value: string): string {
  const clean = value.replace(/["\r\n]/g, " ").trim();
  return /[:;,]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * Folds one content line to 75 octets, continuation lines starting with a single space. The walk is
 * over UTF-8 bytes and stops at codepoint boundaries, so no character is ever cut in half.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let cursor = 0;
  // The first line may use all 75 octets; every continuation spends one on its leading space.
  let budget = MAX_OCTETS;
  while (cursor < bytes.length) {
    let take = Math.min(budget, bytes.length - cursor);
    // Back off until the next byte is not a UTF-8 continuation byte (10xxxxxx).
    while (take > 0 && cursor + take < bytes.length && (bytes[cursor + take] & 0b1100_0000) === 0b1000_0000) take -= 1;
    if (take <= 0) break;
    parts.push(bytes.subarray(cursor, cursor + take).toString("utf8"));
    cursor += take;
    budget = MAX_OCTETS - 1;
  }
  return parts.join(`${CRLF} `);
}

const property = (name: string, value: string): string => foldLine(`${name}:${value}`);

/** The whole file. One VEVENT — an interview is one event, and a file per event imports everywhere. */
export function renderIcs(event: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // The identifier a client shows when it asks who made this file.
    "PRODID:-//Suzu One//Recruitment//VI",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    property("UID", event.uid),
    property("SEQUENCE", String(event.sequence ?? 0)),
    property("DTSTAMP", icsInstant(event.stamp)),
    property("DTSTART", icsInstant(event.start)),
    property("DTEND", icsInstant(event.end)),
    property("SUMMARY", escapeText(event.summary)),
  ];

  if (event.description) lines.push(property("DESCRIPTION", escapeText(event.description)));
  if (event.location) lines.push(property("LOCATION", escapeText(event.location)));
  // A URL is a URI value, not TEXT: it is not escaped, and a comma in one is part of the address.
  if (event.url) lines.push(property("URL", event.url));
  if (event.organizer) lines.push(foldLine(`ORGANIZER;CN=${parameterValue(event.organizer.name)}:mailto:${event.organizer.email}`));
  for (const attendee of event.attendees ?? []) {
    lines.push(
      foldLine(
        `ATTENDEE;CN=${parameterValue(attendee.name)};ROLE=${attendee.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT"};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`,
      ),
    );
  }
  lines.push(property("STATUS", event.cancelled ? "CANCELLED" : "CONFIRMED"));
  // Fifteen minutes' warning. Deliberately the only alarm: more than one is noise nobody asked for.
  if (!event.cancelled) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", property("DESCRIPTION", escapeText(event.summary)), "TRIGGER:-PT15M", "END:VALARM");
  lines.push("END:VEVENT", "END:VCALENDAR");

  // A trailing CRLF: the last content line ends like every other one.
  return `${lines.join(CRLF)}${CRLF}`;
}

/** A filename a browser will accept, derived from the summary. ASCII only — `Content-Disposition` is a minefield. */
export function icsFileName(summary: string): string {
  const ascii = summary
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${ascii || "interview"}.ics`;
}
