// Comment bodies (FR-WRK-09). Plain text with two kinds of mark-up the screens understand:
//   @[Full name](person-uuid)  — a mention, put there by the picker
//   https://…                  — shown as a link. Nothing remote is ever embedded (images and
//                                 videos stay links: the content-security policy, and privacy).
// Pure: the server uses it to find who was mentioned, the browser to draw the comment.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENTION = new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`, "g");
const TOKEN = new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)|(https?:\\/\\/[^\\s<>"]+)`, "g");

export const mentionToken = (name: string, personId: string) => `@[${name.replace(/[\[\]\n]/g, " ").trim()}](${personId})`;

/** The people a body mentions, once each, in order of appearance. */
export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

/** A mention of someone who may not see the task becomes plain text: no notice, no link to them. */
export function dropMentions(body: string, allowed: ReadonlySet<string>): string {
  return body.replace(MENTION, (token, name: string, personId: string) => (allowed.has(personId) ? token : `@${name}`));
}

export type BodySegment = { type: "text"; text: string } | { type: "mention"; personId: string; name: string } | { type: "link"; url: string };

export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let cursor = 0;
  const text = (value: string) => {
    if (value) segments.push({ type: "text", text: value });
  };
  for (const match of body.matchAll(TOKEN)) {
    const start = match.index;
    text(body.slice(cursor, start));
    cursor = start + match[0].length;
    if (match[2]) {
      segments.push({ type: "mention", name: match[1], personId: match[2] });
      continue;
    }
    // A full stop or bracket right after a URL belongs to the sentence, not the address.
    const trailing = /[.,;:!?)\]]+$/.exec(match[3])?.[0] ?? "";
    const url = match[3].slice(0, match[3].length - trailing.length);
    if (safeLink(url)) segments.push({ type: "link", url });
    else text(url);
    text(trailing);
  }
  text(body.slice(cursor));
  return segments;
}

/** Only web addresses are ever made clickable. */
export function safeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !!parsed.hostname;
  } catch {
    return false;
  }
}

/** The mention being typed at the caret ("@thu ha|"), for the picker; null when there is none. */
export function mentionQueryAt(body: string, caret: number): { start: number; query: string } | null {
  const before = body.slice(0, caret);
  const match = /(^|\s)@([^\s@\[\]()]{0,20}(?: [^\s@\[\]()]{1,20}){0,3})$/.exec(before);
  return match ? { start: before.length - match[2].length - 1, query: match[2] } : null;
}
