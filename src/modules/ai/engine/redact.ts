// What may reach a model (FR-AI-06, SRS §4.15 rule 4). Pure.
//
// Two sentences of the SRS, made into the only functions a real driver builds its request with:
//
//  - "compensation data is never sent to the model except for the user's own payslip explanation";
//  - "contact details are never sent to the model" — a client's phone, an email address, a Zalo or
//    Messenger link. Nobody needs a model to know them, and they are in every comment thread.
//
// THE CHOKE POINT is `chatRequestForModel` / `draftRequestForModel`: the Claude drivers in
// `model.ts` call them on their first line and build the request from what comes back, so whoever
// calls a driver — the chat, a draft helper, something written next year — hands over the raw
// request and cannot forget a step. The local extractive driver is not passed through here on
// purpose: it sends nothing anywhere, and what it quotes goes to a reader who can open the page.
//
// Redaction is by field, never over the assembled prompt: the prompt also carries OUR text — the
// hrefs of the sources, the app's own screens — and a page id is a row of hex digits that a phone
// pattern has no business reading.
import { MONEY, REDACTED, redactCompensation } from "./drafts";

// ── Contact details ─────────────────────────────────────────────────────────────────────────

/** An email address, with Vietnamese letters allowed where people do write them. */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/**
 * A chat handle written as a link: zalo.me/0912…, chat.zalo.me/…, m.me/ten.khach,
 * messenger.com/t/…, facebook.com/messages/t/…, and the two others people paste the same way
 * (t.me, wa.me). The whole link goes — the handle is the address.
 */
const CHAT_LINK = /(?<![\p{L}\p{N}_.-])(?:https?:\/\/)?(?:[\w-]+\.)*(?:zalo\.me|zaloapp\.com|m\.me|fb\.me|t\.me|wa\.me|messenger\.com|facebook\.com\/messages)\/[^\s<>"')\]]+/giu;

/**
 * A Vietnamese phone number as people type it: `0912345678`, `0912 345 678`, `091.234.5678`,
 * `028 3823 1234`, `+84 912 345 678`, `(+84) 912-345-678`.
 *
 * National form: 0, then the digit every mobile and landline prefix starts with (2 3 5 7 8 9),
 * then a third digit with no separator before it — which is what keeps `05-10-2026 08:00` a date
 * — and seven or eight more, each optionally after a space, dot or dash. International form: +84
 * and eight to ten digits. Never a number that merely is long: an amount of money does not start
 * with 0, and a figure of somebody's own payslip must survive this.
 */
const PHONE = /(?<![\p{L}\p{N}])(?:(?:\(\+84\)|\+84)[\s.-]?\d(?:[\s.-]?\d){7,9}|0[235789]\d(?:[\s.-]?\d){7,8})(?!\d)/gu;

/** Takes out email addresses, phone numbers and chat links. Deterministic. */
export function redactContacts(text: string): string {
  // Links first: `zalo.me/0912345678` is one thing to remove, not a link with a hole in it.
  return text.replace(CHAT_LINK, REDACTED).replace(EMAIL, REDACTED).replace(PHONE, REDACTED);
}

// ── Money in a knowledge-base passage ───────────────────────────────────────────────────────

/** A figure of a million or more written with its thousands: "30.000.000", "1,500,000". */
const GROUPED_MILLIONS = /(?<![\p{L}\p{N}.,])\d{1,3}(?:[.,]\d{3}){2,}(?![\p{L}\p{N}])/gu;

/**
 * Amounts of money, and nothing else. A passage is not treated like a comment: `redactCompensation`
 * drops every sentence that mentions pay, which is right for a thread and would empty the handbook
 * — "Lương được trả vào ngày 5" is a rule, not somebody's salary. What a model must not be given is
 * the FIGURE, and a page that holds figures (a salary band, a bonus table) cannot be told from its
 * text or its space reliably. So every amount goes, wherever the passage came from: the amounts
 * `MONEY` knows by their unit, and — because a table's cells carry no unit — any number of a
 * million or more written with its thousands.
 */
export function redactMoney(text: string): string {
  return text.replace(MONEY, REDACTED).replace(GROUPED_MILLIONS, REDACTED);
}

// ── By kind of text ─────────────────────────────────────────────────────────────────────────

/** A retrieved passage (its text, its title, its headings) on the way to a model. */
export const passageForModel = (text: string): string => redactMoney(redactContacts(text));

/** Free text of work records — a thread, the day's activity, status facts — on the way to a model. */
export const factsForModel = (text: string): string => redactCompensation(redactContacts(text));

// ── The two requests a real driver sends ────────────────────────────────────────────────────

type PassageText = { pageTitle: string; spaceName: string; headingPath: string; content: string };

/**
 * The chat request as a model may see it. The question keeps its words — "lương" in a question is
 * the subject, not a leak — and loses any contact detail typed into it; every passage loses its
 * contact details and its amounts of money. Ids, anchors and scores are untouched: they are ours.
 */
export function chatRequestForModel<Request extends { question: string; passages: readonly PassageText[] }>(request: Request): Request {
  return {
    ...request,
    question: redactContacts(request.question),
    passages: request.passages.map((passage) => ({
      ...passage,
      pageTitle: passageForModel(passage.pageTitle),
      spaceName: passageForModel(passage.spaceName),
      headingPath: passageForModel(passage.headingPath),
      content: passageForModel(passage.content),
    })),
  };
}

/**
 * The draft request as a model may see it: the facts lose contact details, sentences about pay and
 * amounts of money. The instruction is ours except for a name inside it (a project's), so it only
 * loses contact details — dropping a "sentence about pay" there would drop the instruction.
 */
export function draftRequestForModel<Request extends { instruction: string; facts: string }>(request: Request): Request {
  return { ...request, instruction: redactContacts(request.instruction), facts: factsForModel(request.facts) };
}
