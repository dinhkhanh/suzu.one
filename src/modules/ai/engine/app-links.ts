// Links from an answer to the screen where the thing is done. Pure.
//
// A policy says "tạo đơn trong mục Nghỉ phép"; the reader then has to find that screen. When the
// question or the quoted passages talk about something SuZu One does, the answer ends with a link
// to it. The catalogue is ours — never a URL out of a page or a model — and an entry is offered
// only when its sidebar entry is in the asker's own navigation (`navFor`), so a link never points
// at a screen the sidebar would not show them. Every page re-checks access anyway.
import { words } from "./question";

export type AppLink = { key: string; href: string };

type Entry = AppLink & { nav: string; phrases: readonly string[] };

// Phrases are matched on accent-stripped, lower-cased words (`words`), whole words only.
const CATALOGUE: readonly Entry[] = [
  { key: "leaveNew", nav: "leave", href: "/leave/new", phrases: ["xin nghi", "don nghi", "nghi phep", "dang ky nghi", "leave request", "request leave", "apply for leave", "annual leave", "take leave", "time off", "day off", "days off"] },
  { key: "checkIn", nav: "checkIn", href: "/attendance/check-in", phrases: ["cham cong", "check in", "vao ca", "ra ca", "clock in", "clock out"] },
  { key: "attendanceRequest", nav: "attendance", href: "/attendance/requests/new", phrases: ["lam them gio", "tang ca", "overtime", "lam tu xa", "remote work", "work from home", "wfh", "dieu chinh cong", "quen cham cong", "attendance correction", "lam ngay le"] },
  { key: "payslips", nav: "payslips", href: "/payslips", phrases: ["phieu luong", "payslip", "payslips", "tra luong", "payday", "pay day"] },
  { key: "requestNew", nav: "requests", href: "/requests/new", phrases: ["tam ung", "hoan ung", "de nghi thanh toan", "thanh toan chi phi", "de nghi mua", "mua sam", "cong tac phi", "salary advance", "cash advance", "reimburse", "reimbursement", "expense claim", "purchase request", "giay xac nhan"] },
  { key: "profile", nav: "me", href: "/me", phrases: ["thong tin ca nhan", "ho so ca nhan", "tai khoan ngan hang", "so tai khoan", "ma so thue", "personal details", "bank account", "tax code"] },
  { key: "bookings", nav: "bookings", href: "/assets/bookings", phrases: ["muon thiet bi", "dat thiet bi", "dat lich thiet bi", "book equipment", "equipment booking"] },
  { key: "myEquipment", nav: "assets", href: "/assets/mine", phrases: ["thiet bi cua toi", "ban giao thiet bi", "tra thiet bi", "my equipment", "return equipment"] },
  { key: "referral", nav: "referrals", href: "/recruit/referrals", phrases: ["gioi thieu ung vien", "thuong gioi thieu", "referral", "refer a candidate", "refer someone"] },
  { key: "kudos", nav: "kudos", href: "/kudos", phrases: ["ghi nhan dong nghiep", "gui ghi nhan", "kudos"] },
  { key: "acknowledgements", nav: "kb", href: "/kb/acknowledgements", phrases: ["xac nhan da doc", "acknowledge", "must read"] },
];

export const APP_LINK_KEYS = CATALOGUE.map((entry) => entry.key);
const MAX_LINKS = 3;

const spaced = (text: string): string => ` ${words(text).join(" ")} `;
const mentions = (text: string, entry: Entry): boolean => entry.phrases.some((phrase) => text.includes(` ${phrase} `));

/**
 * The screens an answer should point to: those the question names first, then those the quoted
 * passages name, in the order they were quoted — at most three, and only where `allowedNav`
 * (the asker's sidebar keys) has the entry.
 */
export function appLinksFor(question: string, passages: readonly string[], allowedNav: ReadonlySet<string>): AppLink[] {
  const available = CATALOGUE.filter((entry) => allowedNav.has(entry.nav));
  const chosen: Entry[] = [];
  for (const text of [question, ...passages].map(spaced)) {
    for (const entry of available) {
      if (chosen.length >= MAX_LINKS) break;
      if (!chosen.includes(entry) && mentions(text, entry)) chosen.push(entry);
    }
  }
  return chosen.map(({ key, href }) => ({ key, href }));
}

/** Every link a real model may write, for its prompt: the catalogue entries the asker's sidebar allows. */
export const allowedAppLinks = (allowedNav: ReadonlySet<string>): AppLink[] => CATALOGUE.filter((entry) => allowedNav.has(entry.nav)).map(({ key, href }) => ({ key, href }));

/**
 * Where a link in an answer may go: a path inside this app (the page re-checks access on arrival)
 * or an https address. Anything else — `javascript:`, `data:`, a protocol-relative `//host`, a
 * backslash trick — is not a link at all, and the renderer shows its text only.
 */
export function answerLinkTarget(href: string): { kind: "internal" | "external"; href: string } | null {
  const trimmed = href.trim();
  if (/^\/(?!\/)[^\s\\]*$/.test(trimmed)) return { kind: "internal", href: trimmed };
  if (/^https:\/\/[^\s/?#@\\]+(?:[/?#][^\s\\]*)?$/i.test(trimmed)) return { kind: "external", href: trimmed };
  return null;
}
