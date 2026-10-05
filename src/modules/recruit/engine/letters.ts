// The facts an interview letter states, as text a candidate reads (FR-REC-05, 06). Pure: dates,
// words and a time zone in, strings out.
//
// The time is written in the candidate's language and **always in the office's time zone, with the
// offset printed**: a candidate abroad reading "09:30" with no zone turns up an hour early or six
// hours late, and their mail client will not correct a time that is only text. The `.ics` beside
// the letter carries the instant in UTC, and their calendar does the converting.
import type { CandidateLocale, InterviewMode } from "../enums";

const LANGUAGE_TAG: Record<CandidateLocale, string> = { vi: "vi-VN", en: "en-GB" };

/** "Thứ Năm, 24/09/2026, 09:30–10:30 GMT+7" / "Thursday, 24 September 2026, 09:30–10:30 GMT+7". */
export function interviewTimeText(start: Date, end: Date, locale: CandidateLocale, timeZone: string): string {
  const tag = LANGUAGE_TAG[locale];
  const day = new Intl.DateTimeFormat(tag, { timeZone, weekday: "long", day: locale === "vi" ? "2-digit" : "numeric", month: locale === "vi" ? "2-digit" : "long", year: "numeric" }).format(start);
  const clock = new Intl.DateTimeFormat(tag, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(start).find((part) => part.type === "timeZoneName")?.value ?? "";
  return `${day}, ${clock.format(start)}–${clock.format(end)}${offset ? ` ${offset}` : ""}`;
}

/**
 * Where to be. Never empty, because the letter's "where" line is not optional: a video call is its
 * link, a phone call says so, and an office interview with no address typed names the company's
 * office rather than leaving a hole.
 */
export function interviewPlaceText(
  interview: { mode: InterviewMode; location: string | null; meetingUrl: string | null },
  words: { video: string; phone: string; office: string },
): string {
  const location = interview.location?.trim() || null;
  switch (interview.mode) {
    case "video":
      return interview.meetingUrl ?? location ?? words.video;
    case "phone":
      return location ? `${words.phone} — ${location}` : words.phone;
    case "onsite":
      return location ?? words.office;
  }
}
