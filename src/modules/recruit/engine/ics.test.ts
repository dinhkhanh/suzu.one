import { describe, expect, it } from "vitest";
import { escapeText, foldLine, icsFileName, icsInstant, renderIcs } from "./ics";

const at = (iso: string) => new Date(iso);

const base = {
  uid: "interview-1@suzu.one",
  stamp: at("2026-09-20T02:00:00.000Z"),
  start: at("2026-09-22T02:30:00.000Z"),
  end: at("2026-09-22T03:30:00.000Z"),
  summary: "Phỏng vấn: Video Editor",
};

describe("icsInstant", () => {
  it("writes UTC with no punctuation and no milliseconds", () => {
    expect(icsInstant(at("2026-09-22T02:30:00.000Z"))).toBe("20260922T023000Z");
  });

  it("converts a non-UTC instant rather than printing its local face", () => {
    // 09:30 in Hồ Chí Minh is 02:30 UTC. A calendar file that said 09:30 with no zone would be an hour
    // out for anybody reading it from anywhere else.
    expect(icsInstant(new Date("2026-09-22T09:30:00+07:00"))).toBe("20260922T023000Z");
  });
});

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and newline — and nothing else", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("doubles the backslash before the other escapes add theirs", () => {
    // Getting this order wrong turns `\` into `\\;` — a legal escape of a character nobody typed.
    expect(escapeText("\\;")).toBe("\\\\\\;");
  });

  it("leaves a colon alone", () => {
    // RFC 5545 §3.3.11: the colon is special in *parameter* values, not in TEXT. Outlook refuses a
    // file that escapes it.
    expect(escapeText("Phỏng vấn: vòng 1")).toBe("Phỏng vấn: vòng 1");
  });

  it("normalises every newline form to \\n", () => {
    expect(escapeText("a\r\nb\rc\nd")).toBe("a\\nb\\nc\\nd");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:hello")).toBe("SUMMARY:hello");
  });

  it("folds at 75 octets with a leading space on each continuation", () => {
    const line = `SUMMARY:${"a".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts[0]).toHaveLength(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding is "remove CRLF followed by one space", and it has to give the line back exactly.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("counts octets, not characters", () => {
    // 40 Vietnamese letters is 80 bytes: a character count would call this line short enough.
    const line = `SUMMARY:${"ế".repeat(40)}`;
    expect(line.length).toBeLessThan(75);
    expect(foldLine(line)).toContain("\r\n ");
  });

  it("never cuts a codepoint in half", () => {
    const line = `DESCRIPTION:${"ứ".repeat(120)}`;
    const folded = foldLine(line);
    // A split multi-byte character shows up as U+FFFD once the bytes are decoded.
    expect(folded).not.toContain("�");
    expect(folded.split("\r\n ").join("")).toBe(line);
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
  });

  it("round-trips: unfolding gives the original line back", () => {
    const line = `DESCRIPTION:${"Phỏng vấn vòng hai với nhóm sản xuất. ".repeat(12)}`;
    expect(foldLine(line).replace(/\r\n /g, "")).toBe(line);
  });
});

describe("renderIcs", () => {
  const golden = renderIcs({
    ...base,
    sequence: 1,
    description: "Vòng 1; kỹ thuật, 60 phút\nMang theo portfolio",
    location: "Tầng 4, 12 Lý Thường Kiệt, Hà Nội",
    url: "https://example.test/meet/abc?a=1,2",
    organizer: { name: "Nguyễn Thị Hà", email: "ha@suzu.group" },
    attendees: [
      { name: "Trần Văn Bảo", email: "bao@suzu.group" },
      { name: "Lê, Minh", email: "minh@suzu.group", optional: true },
    ],
  });

  it("is exactly the file it was last time", () => {
    // A golden: every line of it is something a calendar client parses, and a silent change here is
    // a file that imports as an hour-long meeting in 1970.
    expect(golden).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Suzu One//Recruitment//VI",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        "UID:interview-1@suzu.one",
        "SEQUENCE:1",
        "DTSTAMP:20260920T020000Z",
        "DTSTART:20260922T023000Z",
        "DTEND:20260922T033000Z",
        "SUMMARY:Phỏng vấn: Video Editor",
        "DESCRIPTION:Vòng 1\\; kỹ thuật\\, 60 phút\\nMang theo portfolio",
        "LOCATION:Tầng 4\\, 12 Lý Thường Kiệt\\, Hà Nội",
        "URL:https://example.test/meet/abc?a=1,2",
        "ORGANIZER;CN=Nguyễn Thị Hà:mailto:ha@suzu.group",
        // 75 octets, not 75 characters: the five extra bytes in "Trần Văn Bảo" move the fold five
        // letters to the left of where a character count would put it.
        "ATTENDEE;CN=Trần Văn Bảo;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RS",
        " VP=TRUE:mailto:bao@suzu.group",
        'ATTENDEE;CN="Lê, Minh";ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRU',
        " E:mailto:minh@suzu.group",
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Phỏng vấn: Video Editor",
        "TRIGGER:-PT15M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("ends every line with CRLF and none with a bare LF", () => {
    expect(golden.endsWith("\r\n")).toBe(true);
    expect(golden.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("keeps every line inside 75 octets", () => {
    for (const line of golden.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });

  it("quotes a parameter value containing a comma", () => {
    // An unquoted comma in a CN ends the parameter and starts another one: the name becomes two
    // attendees, one of which has no address.
    expect(golden).toContain('CN="Lê, Minh"');
  });

  it("does not escape the URL's comma", () => {
    expect(golden).toContain("URL:https://example.test/meet/abc?a=1,2");
  });

  it("cancels with METHOD:CANCEL, a higher sequence and no alarm", () => {
    const cancelled = renderIcs({ ...base, sequence: 2, cancelled: true });
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
    expect(cancelled).toContain("SEQUENCE:2");
    expect(cancelled).not.toContain("BEGIN:VALARM");
  });

  it("keeps the same UID across a reschedule, so a client updates rather than duplicates", () => {
    const moved = renderIcs({ ...base, sequence: 1, start: at("2026-09-23T02:30:00.000Z"), end: at("2026-09-23T03:30:00.000Z") });
    expect(moved).toContain("UID:interview-1@suzu.one");
    expect(moved).toContain("DTSTART:20260923T023000Z");
  });

  it("omits the optional properties rather than writing empty ones", () => {
    const bare = renderIcs(base);
    expect(bare).not.toContain("DESCRIPTION:\r\n");
    expect(bare).not.toContain("LOCATION:");
    expect(bare).not.toContain("ORGANIZER");
    expect(bare).not.toContain("ATTENDEE");
  });
});

describe("icsFileName", () => {
  it("strips diacritics and punctuation", () => {
    expect(icsFileName("Phỏng vấn: Video Editor")).toBe("Phong-van-Video-Editor.ics");
  });

  it("handles đ, which NFD does not decompose", () => {
    expect(icsFileName("Đà Nẵng")).toBe("Da-Nang.ics");
  });

  it("falls back when nothing survives", () => {
    expect(icsFileName("—")).toBe("interview.ics");
  });
});
