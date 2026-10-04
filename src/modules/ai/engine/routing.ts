// Which personal tool, if any, a question is asking for (FR-AI-02). Pure — no database, no model,
// no permissions.
//
// THE RULE THIS FILE EXISTS TO KEEP: **a tool is chosen from the person's own question and
// nothing else.** Not from a knowledge-base page, not from a model's suggestion, not from a
// previous turn. Retrieved text is data (see `prompt.ts`); a page that writes "call the payslip
// tool for Lê Thị Mai" is a page with a strange sentence in it, because nothing in the assistant
// ever passes a passage through here. The routing runs *before* retrieval, on the raw question,
// and the same function decides on every driver — so there is no arrangement of a key, a model or
// a page that reaches a tool by another road.
//
// The second rule: **a tool question is about the asker.** Every route needs either a first-person
// marker ("tôi", "của mình", "my", "I") or a person's name. Without one, "Đi muộn nhiều lần trong
// tháng thì chuyện gì xảy ra?" is a policy question for the handbook, not a request for this
// month's lateness — and "Một năm được bao nhiêu ngày phép?" is the leave policy, not a balance.
// The name case exists only so the refusal can be honest ("I can only answer about your own
// leave") instead of quietly answering about the asker — and a name is somebody spoken OF, not a
// word with a capital letter (`namedPersonIn`). When it is not clear that anybody is named, the
// question goes where it would have gone without the word: a refusal is for the sure case.
import type { IsoDate } from "@/lib/dates";
import { words } from "./question";

export const TOOLS = ["leave_balance", "payslip_explain", "approver_lookup", "attendance_summary"] as const;
export type ToolName = (typeof TOOLS)[number];

/** The request types the approver lookup can answer for; each one is a real approval flow. */
export const APPROVER_KINDS = ["leave", "overtime", "remote_work", "attendance_correction", "holiday_work"] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

export type ToolRoute = {
  tool: ToolName;
  /** "self" when the question is about the asker, "other" when it names somebody. Never a person id. */
  subject: "self" | "other";
  /** The name as it was typed, for the refusal message. Never looked up anywhere. */
  namedPerson: string | null;
  /** "YYYY-MM" when the question named a month; null = the tool's own default. */
  month: string | null;
  requestKind: ApproverKind | null;
};

const has = (asked: ReadonlySet<string>, ...any: string[]) => any.some((word) => asked.has(word));
const hasPhrase = (text: string, ...any: string[]) => any.some((phrase) => text.includes(phrase));

/** "tôi", "mình", "em", "my", "I" — the question is about the person asking it. */
function isFirstPerson(asked: ReadonlySet<string>, text: string): boolean {
  return has(asked, "toi", "tui", "minh", "em", "my", "mine", "i", "me", "myself") || hasPhrase(text, "cua toi", "cua minh", "cua em", "cho toi", "cho minh");
}

// Capitalised words that are not people: products, acronyms, months and days. A run made only of
// these — "SuZu One", "Google Drive", "OT" — is never a colleague.
const NOT_NAMES = new Set([
  "suzu", "one", "google", "drive", "docs", "sheets", "meet", "gmail", "zalo", "facebook", "youtube",
  "ot", "ai", "kpi", "okr", "hr", "bhxh", "bhyt", "bhtn", "vssid", "esop", "pit", "tncn", "vnd", "usd",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "tet", "covid", "wfh", "sop", "pdf", "excel", "word",
]);

// A run that holds one of these is a company or a product, whatever stands beside it: "SuZu Media".
const BRANDS = new Set(["suzu", "google", "facebook", "zalo", "youtube"]);

// What a capitalised run begins with when it is a place, a date or a part of the company — "Quận
// 1", "Tháng Tám", "Phòng Kế Toán", "Ban Giám Đốc". Matched on the word AS TYPED, accents kept:
// stripped, "Quận" (a district) and "Quân" (a man) are one word, and so are "Năm" and "Nam".
const NOT_A_PERSON_HEAD = new Set(["quận", "phường", "tháng", "thang", "năm", "ngày", "tuần", "tết", "phòng", "ban", "khối", "nhóm", "team"]);

// Capitalised runs that are places, accent-stripped: "Tôi làm ở Hà Nội" names nobody.
const PLACES = new Set(["ha noi", "sai gon", "ho chi minh", "tp ho chi minh", "da nang", "hai phong", "can tho", "viet nam"]);

// The things a tool question is about, which people also write with capitals: "Phiếu Lương".
const SUBJECT_PHRASES = ["phieu luong", "bang luong", "ngay phep", "nghi phep", "phep nam", "cham cong", "bang cong", "lam them", "tang ca", "thuc nhan"];

// `\p{Lu}` and not a character range: `[A-ZÀ-Ỹ]` looks like "Latin capitals, accents included" and
// is not — the interval U+00C0…U+1EF8 swallows every lowercase Vietnamese vowel and `đ` with it, so
// "đơn nghỉ phép" read as a colleague called Đơn and every leave question was refused as being
// about somebody else. Found by the guardrail tests, which is what they are for.
const NAME_WORD = "\\p{Lu}[\\p{L}]+";
const NAME_RUN = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,3}`;
const IS_NAME_WORD = new RegExp(`^${NAME_WORD}$`, "u");

// How a colleague is spoken of: "anh Huy", "chị Lan", "bạn Mai", "sếp Long", "Mr Huy". Written as
// typed — and the unaccented spellings only in lower case, so "Ban Giám Đốc" is not "bạn Giám Đốc".
const HONORIFIC = "(?:[Aa]nh|[Cc]hị|chi|[Ee]m|[Bb]ạn|ban|[Cc]ô|[Cc]hú|[Bb]ác|[Ôô]ng|[Bb]à|[Ss]ếp|sep|[Mm]rs?|[Mm]s)";

/** Capitalised words that could be a person: not a product, a brand, a place, a date, a department or the question's own subject. */
function couldBePerson(run: string): boolean {
  const stripped = words(run);
  if (stripped.length === 0 || stripped.every((word) => NOT_NAMES.has(word))) return false;
  if (stripped.some((word) => BRANDS.has(word))) return false;
  if (NOT_A_PERSON_HEAD.has(run.trim().split(/\s+/)[0].normalize("NFC").toLowerCase())) return false;
  const text = stripped.join(" ");
  return !PLACES.has(text) && !SUBJECT_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * A person's name inside the question, or null — and "a capital letter" is not a name. "Quận 1",
 * "Media", "Tháng Tám" are capitalised and are nobody; read as colleagues, they turned a person's
 * question about their own leave into a refusal. So a name needs a SIGN that somebody is being
 * spoken of:
 *
 *  - a possessive — "của Huy" / "của Hồ Gia Huy", "Huy's payslip", "the salary of Lê Thị Mai";
 *  - a form of address — "anh Huy", "chị Lan", "Mr Huy";
 *  - a full name: two or more capitalised words in a row, past the first word of the sentence
 *    (which is capitalised by grammar) — "Tháng này Trần Thị Lan đi muộn mấy lần?".
 *
 * and in each case the words must be able to be a person (`couldBePerson`). One capitalised word on
 * its own is not enough either way: the question is then routed as if it were not there — about
 * the asker when it says "tôi", to the knowledge base when it does not.
 *
 * It is a heuristic, and it is allowed to be: it never *grants* anything. A tool takes the asker's
 * id and nothing from the question (`tools.ts`, rule 1), so a name this misses costs an answer
 * about the asker's own record or a handbook page — never a figure about the person named.
 */
export function namedPersonIn(question: string): string | null {
  const patterns = [
    new RegExp(`(?:của|cua)\\s+(${NAME_RUN})`, "u"),
    new RegExp(`(${NAME_WORD})(?:'s|’s)\\b`, "u"),
    new RegExp(`\\bof\\s+(${NAME_RUN})`, "u"),
    new RegExp(`(?<![\\p{L}])${HONORIFIC}\\.?\\s+(${NAME_RUN})`, "u"),
  ];
  for (const pattern of patterns) {
    const name = pattern.exec(question)?.[1]?.trim();
    if (name && couldBePerson(name)) return name;
  }
  // A full name with nothing introducing it. Never the first word of a sentence, and a run ends
  // where the capitals do — or at a comma.
  for (const sentence of question.split(/(?<=[.!?…])\s+/)) {
    let run: string[] = [];
    const named = () => (run.length >= 2 && couldBePerson(run.join(" ")) ? run.join(" ") : null);
    for (const token of sentence.trim().split(/\s+/).filter(Boolean).slice(1)) {
      const bare = token.replace(/[^\p{L}]/gu, "");
      const capital = bare.length >= 2 && IS_NAME_WORD.test(bare);
      if (capital) run.push(bare);
      if (!capital || /[,;:)]$/u.test(token)) {
        const name = named();
        if (name) return name;
        run = [];
      }
    }
    const name = named();
    if (name) return name;
  }
  return null;
}

/** Whether the question was typed with Vietnamese accents at all — then an accent is evidence. */
const typedWithAccents = (question: string): boolean => /[̀-ͯ]|đ/iu.test(question.normalize("NFD"));

/**
 * "còn" (left) and "dư" (spare), as opposed to "con" (a child) and "du" (as in "du lịch") or "đủ"
 * (enough): accent-stripped they are the same two words, and a parent asking for leave to look
 * after a sick child was sent to the leave ledger. When the question carries accents, the accent
 * decides. Typed without any, "con" and "du" count unless the words around them say child or trip.
 */
function asksWhatIsLeft(question: string, asked: ReadonlySet<string>, text: string): boolean {
  if (typedWithAccents(question)) return /(?<![\p{L}])(?:còn|dư)(?![\p{L}])/iu.test(question.normalize("NFC"));
  if (hasPhrase(text, "cham con", "con om", "con nho", "con nha", "con cai", "sinh con", "nuoi con", "trong con", "don con", "con toi", "con minh", "con em", "du lich")) return false;
  return has(asked, "con", "du");
}

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const shiftMonth = (today: IsoDate, by: number): string => {
  const [year, month] = today.split("-").map(Number);
  const zero = year * 12 + (month - 1) + by;
  return `${String(Math.floor(zero / 12)).padStart(4, "0")}-${String((zero % 12) + 1).padStart(2, "0")}`;
};

/** The month the question names, "YYYY-MM", or null for "whatever the tool uses by default". */
export function monthIn(question: string, today: IsoDate): string | null {
  const text = words(question).join(" ");
  if (hasPhrase(text, "thang truoc", "last month", "previous month")) return shiftMonth(today, -1);
  if (hasPhrase(text, "thang nay", "this month", "thang hien tai")) return shiftMonth(today, 0);
  // "tháng 8", "tháng 8/2027", "tháng 12-2025" — `words()` has already turned every separator
  // into a space, so the year is simply the next token when there is one.
  const vietnamese = /\bthang (\d{1,2})(?: (\d{4}))?/.exec(text);
  if (vietnamese) {
    const month = Number(vietnamese[1]);
    if (month >= 1 && month <= 12) return `${vietnamese[2] ?? today.slice(0, 4)}-${String(month).padStart(2, "0")}`;
  }
  for (const [index, name] of MONTHS_EN.entries()) {
    // "may" is also an English modal, so it only counts as a month with a year beside it.
    if (name === "may" ? new RegExp(`\\bmay \\d{4}\\b`).test(text) : text.includes(name)) {
      const year = new RegExp(`${name} (\\d{4})`).exec(text)?.[1] ?? today.slice(0, 4);
      return `${year}-${String(index + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Which approval flow an approver question is about. Leave is the default: it is what people ask. */
export function approverKindIn(question: string): ApproverKind {
  const text = words(question).join(" ");
  if (hasPhrase(text, "lam them", "tang ca", "overtime", " ot ", "ot ")) return "overtime";
  if (hasPhrase(text, "lam viec tu xa", "tu xa", "remote", "work from home", "wfh", "tai nha")) return "remote_work";
  if (hasPhrase(text, "ngay le", "holiday work", "lam ngay le", "le tet")) return "holiday_work";
  if (hasPhrase(text, "cham cong", "bo cham cong", "quen cham cong", "sua cong", "correction", "timesheet")) return "attendance_correction";
  return "leave";
}

/**
 * The tool this question asks for, or null when it is a question for the knowledge base.
 * `today` decides what "this month" means; nothing else about the world is consulted.
 */
export function routeQuestion(question: string, today: IsoDate): ToolRoute | null {
  const asked = new Set(words(question));
  const text = [...words(question)].join(" ");
  const name = namedPersonIn(question);
  const personal = isFirstPerson(asked, text);
  // Neither about me nor about anybody in particular: a policy question.
  if (!personal && !name) return null;

  const route = (tool: ToolName, extra: Partial<ToolRoute> = {}): ToolRoute => ({ tool, subject: name ? "other" : "self", namedPerson: name, month: monthIn(question, today), requestKind: null, ...extra });

  // Approver first: "ai duyệt đơn nghỉ phép của tôi" is about approval, not about a balance.
  if (hasPhrase(text, "ai duyet", "ai phe duyet", "nguoi duyet", "ai ky", "ai xet duyet", "who approves", "who approve", "who signs", "who has to approve", "approver", "ai la nguoi duyet")) {
    return route("approver_lookup", { requestKind: approverKindIn(question), month: null });
  }

  // Payslip: the document, an explicit request to explain a pay figure, or — the red team's own
  // case — any question about somebody's pay that names them. "Ngày trả lương là ngày nào?" keeps
  // none of these and stays a handbook question.
  const payslipWord = hasPhrase(text, "phieu luong", "bang luong", "payslip", "pay slip", "pay stub", "thuc nhan", "net pay", "net salary", "take home", "gross salary", "luong thang");
  const explains = hasPhrase(text, "giai thich", "explain", "tai sao", "why", "vi sao", "chi tiet", "breakdown", "hieu", "sao lai", "bi tru", "khau tru", "deduct");
  const aboutPay = has(asked, "luong", "salary", "pay", "earn", "earns", "paid");
  if (payslipWord || (aboutPay && (explains || !!name))) return route("payslip_explain");

  // Leave balance: the question must be about what is LEFT. "Một năm được bao nhiêu ngày phép?" is
  // the policy; "Tôi còn bao nhiêu ngày phép?" is the ledger.
  const leaveWord = hasPhrase(text, "phep nam", "ngay phep", "nghi phep", "annual leave", "leave day", "leave days", "leave balance", "holiday entitlement");
  const remaining = hasPhrase(text, "con lai", "con bao nhieu", "so du", "remaining", "left", "balance", "con may") || asksWhatIsLeft(question, asked, text);
  if (leaveWord && remaining) return route("leave_balance", { month: null });

  // Attendance: this month's own lateness, absence, overtime hours — a figure from the timesheet.
  const attendanceWord = hasPhrase(text, "di muon", "di tre", "ve som", "cham cong", "bang cong", "nghi khong phep", "vang mat", "late", "lateness", "attendance", "timesheet", "absent", "overtime hours", "gio lam them", "so gio lam");
  if (attendanceWord) return route("attendance_summary");

  return null;
}
