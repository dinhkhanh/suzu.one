// Drafting help (FR-PJM-64): the end-of-day report's notes, a project status update's summary and
// a hand-off note, drafted from what is already recorded. Pure.
//
// These are the LOCAL DRIVER'S drafts — deterministic and extractive, like the assistant's answers:
// they rearrange the person's own recorded facts and add nothing. The EOD and status drafts come
// back as message keys and numbers (the server renders them in the reader's language, the same
// "data, not prose" rule as the personal tools); the hand-off note is extracted from the thread's
// own words. With a model configured, the same facts — and only them — are what it is given.
//
// FR-AI-06 GUARDRAIL: `redactCompensation` runs over every piece of free text before it reaches a
// model. The sources are work records (task titles, comments, status facts in hours) and never
// read a compensation table, but people write anything in a comment; a sentence about pay or an
// amount of money is taken out rather than trusted to stay in the building.

export type DraftLine = { key: string; params: Record<string, string | number> };

// ── Guardrail ───────────────────────────────────────────────────────────────────────────────

/** Amounts of money: "15.000.000 đ", "15tr", "20 triệu", "1,5 tỷ", "VND 3,000,000", "$1200". */
const MONEY = /(?:(?:vnd|vnđ|usd|\$)\s?\d[\d.,]*(?:\s?(?:k|tr|triệu|tỷ|nghìn|ngàn)(?!\p{L}))?)|(?:\d[\d.,]*\s?(?:đồng|đ|₫|vnd|vnđ|usd|k|tr|triệu|tỷ|nghìn|ngàn)(?!\p{L}))/giu;
/**
 * Whole words, in any script: `\b` only knows ASCII letters, so "sẽ" or "đã" would never match it.
 * Tested with Vietnamese on both edges.
 */
const words = (list: readonly string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, "iu");
/** Words that make a sentence about someone's pay. */
const PAY_WORDS = words(["lương", "thưởng(?!\\s+thức)", "phụ cấp", "thu nhập", "phiếu lương", "bảng lương", "thuế tncn", "salary", "salaries", "payslip", "payroll", "bonus", "wage", "wages", "compensation", "allowance"]);
export const REDACTED = "[…]";

/** Takes out sentences about pay and any amount of money. Deterministic; applied before any model call. */
export function redactCompensation(text: string): string {
  // Sentences end at . ! ? followed by a space, or at a line break — never inside "15.000.000".
  return text
    .split(/(?<=[.!?])(?=\s)|(?<=\n)/u)
    .map((sentence) => {
      if (!PAY_WORDS.test(sentence)) return sentence.replace(MONEY, REDACTED);
      const lead = /^\s*/u.exec(sentence)![0];
      return `${lead}${REDACTED}${sentence.endsWith("\n") ? "\n" : ""}`;
    })
    .join("")
    .replace(/\[…\](?:\s*\[…\])+/gu, REDACTED)
    .trim();
}

// ── EOD report notes (FR-PJM-22) ────────────────────────────────────────────────────────────

export type EodFacts = {
  done: readonly { title: string; ref: string | null }[];
  notDone: readonly { title: string; ref: string | null }[];
  activity: readonly { kind: string; title: string; ref: string | null }[];
  minutesLogged: number;
};

const label = (item: { title: string; ref: string | null }) => (item.ref ? `${item.ref} ${item.title}` : item.title);
const list = (items: readonly { title: string; ref: string | null }[], max = 5) => {
  const unique = [...new Map(items.map((item) => [label(item), item])).values()];
  return unique.slice(0, max).map(label).join("; ") + (unique.length > max ? "; …" : "");
};

/**
 * The notes draft: what got done, what moved on reviews and hand-offs, what is still open from the
 * plan, and the hours. One line per fact that is there — nothing for what is not.
 */
export function eodDraftLines(facts: EodFacts): DraftLine[] {
  const lines: DraftLine[] = [];
  const of = (kinds: readonly string[]) => facts.activity.filter((item) => kinds.includes(item.kind));
  if (facts.done.length) lines.push({ key: "eod.done", params: { count: facts.done.length, items: list(facts.done) } });
  const submitted = of(["submitted"]);
  if (submitted.length) lines.push({ key: "eod.submitted", params: { count: submitted.length, items: list(submitted) } });
  const reviewed = of(["reviewed"]);
  if (reviewed.length) lines.push({ key: "eod.reviewed", params: { count: reviewed.length, items: list(reviewed) } });
  const handoffs = of(["handoff_sent", "handoff_received"]);
  if (handoffs.length) lines.push({ key: "eod.handoffs", params: { count: handoffs.length, items: list(handoffs) } });
  const blockers = of(["blocker_raised"]);
  if (blockers.length) lines.push({ key: "eod.blocked", params: { count: blockers.length, items: list(blockers) } });
  if (facts.notDone.length) lines.push({ key: "eod.notDone", params: { count: facts.notDone.length, items: list(facts.notDone) } });
  if (facts.minutesLogged > 0) lines.push({ key: "eod.time", params: { hours: Math.round((facts.minutesLogged / 60) * 10) / 10 } });
  if (lines.length === 0) lines.push({ key: "eod.nothing", params: {} });
  return lines;
}

// ── Project status summary (FR-PJM-27) ──────────────────────────────────────────────────────

/** The status facts of a project — hours and counts; the fee is never among them. */
export type StatusDraftFacts = { tasksDone: number; tasksOpen: number; overdue: number; blocked: number; milestoneSlipDays: number | null; nextMilestone: { name: string; dueDate: string | null } | null; minutesLogged: number; budgetMinutes: number | null; deliverablesAccepted: number; deliverablesPromised: number };

export function statusDraftLines(facts: StatusDraftFacts): DraftLine[] {
  const lines: DraftLine[] = [{ key: "status.progress", params: { done: facts.tasksDone, open: facts.tasksOpen } }];
  if (facts.deliverablesPromised > 0) lines.push({ key: "status.register", params: { accepted: facts.deliverablesAccepted, promised: facts.deliverablesPromised } });
  if (facts.overdue > 0) lines.push({ key: "status.overdue", params: { count: facts.overdue } });
  if (facts.blocked > 0) lines.push({ key: "status.blocked", params: { count: facts.blocked } });
  if (facts.milestoneSlipDays !== null && facts.milestoneSlipDays > 0) lines.push({ key: "status.slip", params: { days: facts.milestoneSlipDays } });
  if (facts.nextMilestone) lines.push(facts.nextMilestone.dueDate ? { key: "status.nextMilestone", params: { name: facts.nextMilestone.name, date: facts.nextMilestone.dueDate } } : { key: "status.nextMilestoneUndated", params: { name: facts.nextMilestone.name } });
  const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
  if (facts.budgetMinutes && facts.budgetMinutes > 0) lines.push({ key: "status.burn", params: { logged: hours(facts.minutesLogged), budget: hours(facts.budgetMinutes), percent: Math.round((facts.minutesLogged / facts.budgetMinutes) * 100) } });
  else if (facts.minutesLogged > 0) lines.push({ key: "status.hours", params: { logged: hours(facts.minutesLogged) } });
  return lines;
}

/** The health the facts point to — a suggestion the lead is free to overrule. */
export function suggestedHealth(facts: StatusDraftFacts): "on_track" | "at_risk" | "off_track" {
  const overBudget = !!facts.budgetMinutes && facts.minutesLogged > facts.budgetMinutes;
  if (overBudget || (facts.milestoneSlipDays ?? 0) > 7 || facts.overdue >= 5) return "off_track";
  if (facts.overdue > 0 || facts.blocked > 0 || (facts.milestoneSlipDays ?? 0) > 0 || (!!facts.budgetMinutes && facts.minutesLogged > facts.budgetMinutes * 0.8)) return "at_risk";
  return "on_track";
}

// ── Hand-off note from a task's thread (FR-PJM-43) ──────────────────────────────────────────

/** The note shape every hand-off uses (work's `HandoffNote`). */
export type HandoffNoteDraft = { context?: string; state?: string; done?: string; next?: string; questions?: string; links?: string[]; contacts?: string };
export type ThreadFacts = { title: string; description: string | null; stateName: string | null; comments: readonly { author: string; body: string }[] };

const URL_PATTERN = /https?:\/\/[^\s)<>"']*[^\s)<>"'.,;:!?]/giu;
const DONE_WORDS = words(["xong", "hoàn thành", "đã gửi", "đã duyệt", "đã sửa", "đã giao", "done", "finished", "completed", "sent", "approved", "fixed", "delivered"]);
const NEXT_WORDS = words(["tiếp theo", "cần", "sẽ", "chưa", "còn lại", "next", "todo", "to do", "need to", "needs", "will", "remaining", "pending"]);
const MAX_PART = 600;

const sentencesOf = (text: string) =>
  text
    .replace(URL_PATTERN, "")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 2);
const joinPart = (parts: readonly string[]) => {
  const text = [...new Set(parts)].join(" ").trim();
  return text.length > MAX_PART ? `${text.slice(0, MAX_PART - 1).trimEnd()}…` : text;
};

/**
 * The note, extracted: the context from the title and the description's first sentence; the
 * current state and the latest word on it; sentences that say something is done, that something
 * is next, and every question; every link in the thread. Contacts are left to the person — a
 * thread does not say reliably who the client's people are.
 */
export function handoffDraft(facts: ThreadFacts): HandoffNoteDraft {
  const comments = facts.comments.filter((comment) => comment.body.trim()).map((comment) => ({ author: comment.author, body: redactCompensation(comment.body) }));
  const all = comments.flatMap((comment) => sentencesOf(comment.body).map((sentence) => ({ author: comment.author, sentence })));
  const questions = all.filter((item) => item.sentence.endsWith("?"));
  const done = all.filter((item) => !item.sentence.endsWith("?") && DONE_WORDS.test(item.sentence));
  const next = all.filter((item) => !item.sentence.endsWith("?") && !DONE_WORDS.test(item.sentence) && NEXT_WORDS.test(item.sentence));
  const last = comments.at(-1);
  const description = facts.description ? sentencesOf(redactCompensation(facts.description))[0] : undefined;
  const links = [...new Set([...(facts.description ?? "").matchAll(URL_PATTERN), ...facts.comments.flatMap((comment) => [...comment.body.matchAll(URL_PATTERN)])].map((match) => match[0].replace(/[.,;:]+$/u, "")))];
  const note: HandoffNoteDraft = {};
  const context = joinPart([redactCompensation(facts.title), ...(description ? [description] : [])]);
  if (context) note.context = context;
  const state = joinPart([...(facts.stateName ? [facts.stateName] : []), ...(last ? [`${last.author}: ${sentencesOf(last.body).at(-1) ?? ""}`.trim()] : [])]);
  if (state) note.state = state;
  if (done.length) note.done = joinPart(done.slice(-5).map((item) => item.sentence));
  if (next.length) note.next = joinPart(next.slice(-5).map((item) => item.sentence));
  if (questions.length) note.questions = joinPart(questions.slice(-5).map((item) => `${item.author}: ${item.sentence}`));
  if (links.length) note.links = links.slice(0, 10);
  return note;
}

/** The thread as plain text for a model: title, description, state and the comments in order, redacted. */
export function threadText(facts: ThreadFacts): string {
  return redactCompensation([`# ${facts.title}`, facts.description ?? "", facts.stateName ? `State: ${facts.stateName}` : "", ...facts.comments.map((comment) => `${comment.author}: ${comment.body}`)].filter(Boolean).join("\n"));
}
