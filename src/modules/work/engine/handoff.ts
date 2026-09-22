// Hand-offs (FR-PJM-40..43). Pure: the service loads a team's packages and what the person filled
// in, these functions say which package a move needs and what is still missing. One note shape
// for every kind of hand-off — stage, cross-team, cover, exit, account — so a reader always finds
// the same headings.

export const HANDOFF_KINDS = ["stage", "cross_team", "cover", "cover_return", "exit", "account"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

/** pending → accepted | returned | cancelled; "recorded" = nobody has to accept it. */
export const HANDOFF_STATUSES = ["pending", "accepted", "returned", "cancelled", "recorded"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_FIELD_TYPES = ["text", "url", "date", "number"] as const;
export type HandoffFieldType = (typeof HANDOFF_FIELD_TYPES)[number];

/** FR-PJM-43: the text parts of a note, in the order the form shows them. `links` is a list beside them. */
export const NOTE_PARTS = ["context", "state", "done", "next", "questions", "contacts"] as const;
export type NotePart = (typeof NOTE_PARTS)[number];

export const MAX_PACKAGE_FIELDS = 12;
export const MAX_PACKAGE_CHECKS = 20;
export const MAX_NOTE_LINKS = 10;

export type PackageField = { key: string; label: string; type: HandoffFieldType; required: boolean };
export type PackageCheck = { id: string; text: string };
export type PackageDef = {
  id: string;
  /** null = from any state. */
  fromStateId: string | null;
  toStateId: string;
  fields: readonly PackageField[];
  checklist: readonly PackageCheck[];
  requireLink: boolean;
  requireFile: boolean;
  requireAccept: boolean;
  isActive: boolean;
};

export type Note = { context?: string; state?: string; done?: string; next?: string; questions?: string; links?: string[]; contacts?: string };

/**
 * The package a move needs. A package that names the state the task leaves beats one for "any
 * state"; staying in the same state needs nothing. Among equals the first one listed wins (the
 * service lists them oldest first), so adding a second package never changes an existing gate.
 */
export function packageFor<Package extends PackageDef>(packages: readonly Package[], fromStateId: string, toStateId: string): Package | null {
  if (fromStateId === toStateId) return null;
  const candidates = packages.filter((pkg) => pkg.isActive && pkg.toStateId === toStateId && (pkg.fromStateId === null || pkg.fromStateId === fromStateId));
  return candidates.find((pkg) => pkg.fromStateId === fromStateId) ?? candidates[0] ?? null;
}

/** What the person filled in the hand-off sheet. */
export type PackageFill = { values: Readonly<Record<string, string>>; checked: readonly string[]; links: readonly string[]; fileId: string | null };

export type MissingItem = { kind: "field"; key: string; label: string } | { kind: "invalid"; key: string; label: string } | { kind: "check"; id: string; text: string } | { kind: "link" } | { kind: "file" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A web address a colleague can open: http(s) only, so a note can never carry a script. */
export function isWebLink(value: string): boolean {
  if (value.length > 1000 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function fieldValueValid(type: HandoffFieldType, value: string): boolean {
  if (type === "url") return isWebLink(value);
  if (type === "date") return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
  if (type === "number") return value.trim() !== "" && Number.isFinite(Number(value));
  return value.length <= 2000;
}

/**
 * Everything the package still asks for, in the order the sheet shows it: fields (empty required
 * ones, then filled ones that do not read as their type), unticked checks, the link, the file. An
 * empty list means the move may go ahead. A link can be given as a note link or as a URL field.
 */
export function missingItems(pkg: Pick<PackageDef, "fields" | "checklist" | "requireLink" | "requireFile">, fill: PackageFill): MissingItem[] {
  const missing: MissingItem[] = [];
  for (const field of pkg.fields) {
    const value = (fill.values[field.key] ?? "").trim();
    if (!value) {
      if (field.required) missing.push({ kind: "field", key: field.key, label: field.label });
    } else if (!fieldValueValid(field.type, value)) missing.push({ kind: "invalid", key: field.key, label: field.label });
  }
  for (const check of pkg.checklist) if (!fill.checked.includes(check.id)) missing.push({ kind: "check", id: check.id, text: check.text });
  if (pkg.requireLink) {
    const urlField = pkg.fields.some((field) => field.type === "url" && isWebLink((fill.values[field.key] ?? "").trim()));
    if (!urlField && !fill.links.some(isWebLink)) missing.push({ kind: "link" });
  }
  if (pkg.requireFile && !fill.fileId) missing.push({ kind: "file" });
  return missing;
}

/** Only the answers the package asks for, trimmed; anything else the form sent is dropped. */
export function keptValues(pkg: Pick<PackageDef, "fields">, values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(pkg.fields.flatMap((field) => ((values[field.key] ?? "").trim() ? [[field.key, (values[field.key] ?? "").trim()]] : [])));
}

export type PackageProblem = "handoff_package_same_state" | "handoff_package_empty" | "handoff_package_field_label" | "handoff_package_field_duplicate" | "handoff_package_too_many" | "handoff_package_check_text";

/** A package definition a team lead saves. Keys are made by the service; labels are what people read. */
export function packageProblem(pkg: Pick<PackageDef, "fromStateId" | "toStateId" | "fields" | "checklist" | "requireLink" | "requireFile" | "requireAccept">): PackageProblem | null {
  if (pkg.fromStateId === pkg.toStateId) return "handoff_package_same_state";
  if (pkg.fields.length > MAX_PACKAGE_FIELDS || pkg.checklist.length > MAX_PACKAGE_CHECKS) return "handoff_package_too_many";
  if (pkg.fields.some((field) => !field.label.trim())) return "handoff_package_field_label";
  const labels = pkg.fields.map((field) => field.label.trim().toLowerCase());
  if (new Set(labels).size !== labels.length || new Set(pkg.fields.map((field) => field.key)).size !== pkg.fields.length) return "handoff_package_field_duplicate";
  if (pkg.checklist.some((check) => !check.text.trim())) return "handoff_package_check_text";
  // A package that asks nothing and needs nobody's acceptance would gate the move for nothing.
  if (pkg.fields.length === 0 && pkg.checklist.length === 0 && !pkg.requireLink && !pkg.requireFile && !pkg.requireAccept) return "handoff_package_empty";
  return null;
}

/** The note as it is stored: trimmed, empty parts left out, only web links, at most ten, no repeats. */
export function normalizeNote(note: Note): Note {
  const result: Note = {};
  for (const part of NOTE_PARTS) {
    const value = note[part]?.trim();
    if (value) result[part] = value.slice(0, 4000);
  }
  const links = [...new Set((note.links ?? []).map((link) => link.trim()).filter(isWebLink))].slice(0, MAX_NOTE_LINKS);
  if (links.length) result.links = links;
  return result;
}

export const noteIsEmpty = (note: Note): boolean => NOTE_PARTS.every((part) => !note[part]?.trim()) && !(note.links ?? []).some(isWebLink);

/**
 * Who receives a stage hand-off when the sheet opens: the stage's own assignee rule (an automation
 * that assigns on entering the state) if the team has one, else nobody — the person is asked. The
 * sender never receives their own hand-off.
 */
export function defaultReceiver(stageAssignee: string | null, senderId: string | null): string | null {
  return stageAssignee && stageAssignee !== senderId ? stageAssignee : null;
}

/**
 * What a new stage hand-off becomes: waiting for its receiver when the package asks for an
 * acceptance and somebody else receives it; otherwise it is only recorded (and the receiver, if
 * any, gets the task at once).
 */
export function stageOutcome(requireAccept: boolean, receiverId: string | null, senderId: string | null): "pending" | "recorded" {
  return requireAccept && receiverId && receiverId !== senderId ? "pending" : "recorded";
}
