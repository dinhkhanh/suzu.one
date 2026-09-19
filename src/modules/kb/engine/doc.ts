// The page document (FR-KB-02): ProseMirror JSON as the editor produces it, and the only shape the
// server stores. Pure. `validateDoc` is the gate every save goes through — a node, mark or
// attribute that is not listed here is refused, so what the reading view renders is always one of
// a known set of elements and never markup somebody typed.
import { CALLOUT_KINDS } from "./callouts";
import { normalizeEmbed, safeHref } from "./embed";

export type DocMark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: DocMark[]; text?: string };
export type Doc = { type: "doc"; content: DocNode[] };

export const EMPTY_DOC: Doc = { type: "doc", content: [{ type: "paragraph" }] };

export const MAX_DOC_BYTES = 500_000;
const MAX_DEPTH = 24;
const MAX_NODES = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Invalid extends Error {
  constructor(
    readonly problem: string,
    readonly path: string,
  ) {
    super(`${problem} at ${path}`);
  }
}

type Attrs = Record<string, unknown>;
type NodeSpec = {
  group: "block" | "inline" | "structure";
  /** Types a child may have; undefined = a leaf. */
  children?: readonly string[] | "block" | "inline";
  min?: number;
  /** Returns the attributes to keep. Throws on anything it does not know. */
  attrs?: (attrs: Attrs, path: string) => Attrs | undefined;
  marks?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads the attributes a spec names; any other key with a value is a refusal. */
function pick(attrs: Attrs, path: string, readers: Record<string, (value: unknown) => unknown>, ignored: readonly string[] = []): Attrs {
  const kept: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (ignored.includes(key)) continue;
    const reader = readers[key];
    if (!reader) throw new Invalid("unknown_attribute", `${path}.${key}`);
    const read = reader(value);
    if (read === undefined) throw new Invalid("bad_attribute", `${path}.${key}`);
    kept[key] = read;
  }
  return kept;
}

const intBetween = (min: number, max: number) => (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined);
const shortText = (max: number) => (value: unknown) => (typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : undefined);
const uuid = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined);
const none = (attrs: Attrs, path: string) => {
  pick(attrs, path, {});
  return undefined;
};

const cellAttrs = (attrs: Attrs, path: string) => {
  const kept = pick(attrs, path, {
    colspan: intBetween(1, 50),
    rowspan: intBetween(1, 200),
    colwidth: (value) => (Array.isArray(value) && value.length <= 50 && value.every((width) => width === null || (typeof width === "number" && width > 0 && width < 5000)) ? value : undefined),
  });
  if (kept.colspan === 1) delete kept.colspan;
  if (kept.rowspan === 1) delete kept.rowspan;
  return Object.keys(kept).length ? kept : undefined;
};

const NODES: Record<string, NodeSpec> = {
  paragraph: { group: "block", children: "inline", attrs: none },
  heading: {
    group: "block",
    children: "inline",
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { level: intBetween(1, 3) });
      if (!kept.level) throw new Invalid("bad_attribute", `${path}.level`);
      return kept;
    },
  },
  bulletList: { group: "block", children: ["listItem"], min: 1, attrs: none },
  orderedList: {
    group: "block",
    children: ["listItem"],
    min: 1,
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { start: intBetween(0, 100_000) }, ["type"]);
      return kept.start !== undefined && kept.start !== 1 ? kept : undefined;
    },
  },
  listItem: { group: "structure", children: "block", min: 1, attrs: none },
  blockquote: { group: "block", children: "block", min: 1, attrs: none },
  codeBlock: {
    group: "block",
    children: ["text"],
    marks: false,
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { language: (value) => (typeof value === "string" && /^[A-Za-z0-9_+#.-]{1,30}$/.test(value) ? value : undefined) });
      return Object.keys(kept).length ? kept : undefined;
    },
  },
  horizontalRule: { group: "block", attrs: none },
  table: { group: "block", children: ["tableRow"], min: 1, attrs: none },
  tableRow: { group: "structure", children: ["tableCell", "tableHeader"], min: 1, attrs: none },
  tableCell: { group: "structure", children: "block", min: 1, attrs: cellAttrs },
  tableHeader: { group: "structure", children: "block", min: 1, attrs: cellAttrs },
  callout: {
    group: "block",
    children: "block",
    min: 1,
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { kind: (value) => ((CALLOUT_KINDS as readonly unknown[]).includes(value) ? value : undefined) });
      return { kind: kept.kind ?? "info" };
    },
  },
  embed: {
    group: "block",
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { url: shortText(2000), provider: shortText(40) });
      const embed = normalizeEmbed(kept.url);
      if (!embed) throw new Invalid("embed_not_allowed", `${path}.url`);
      // The provider is ours to say, not the client's.
      return { url: (kept.url as string).trim(), provider: embed.provider };
    },
  },
  attachment: {
    group: "block",
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { fileId: uuid, fileName: shortText(200), sizeBytes: intBetween(0, 1_000_000_000) });
      if (!kept.fileId || !kept.fileName) throw new Invalid("bad_attribute", `${path}.fileId`);
      return kept;
    },
  },
  image: {
    group: "block",
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, {
        fileId: uuid,
        // A picture hosted elsewhere: https only. It is shown without a referrer.
        src: (value) => (typeof value === "string" && value.length <= 2000 && /^https:\/\/[^\s@]+$/i.test(value) && safeHref(value) ? value : undefined),
        alt: shortText(300),
        title: shortText(300),
      });
      if (!kept.fileId === !kept.src) throw new Invalid("bad_attribute", `${path}.src`);
      return kept;
    },
  },
  hardBreak: { group: "inline", attrs: none },
  mention: {
    group: "inline",
    attrs: (attrs, path) => {
      const kept = pick(attrs, path, { personId: uuid, label: shortText(120) });
      if (!kept.personId || !kept.label) throw new Invalid("bad_attribute", `${path}.personId`);
      return kept;
    },
  },
};

const MARKS: Record<string, (attrs: Attrs, path: string) => Attrs | undefined> = {
  bold: none,
  italic: none,
  strike: none,
  underline: none,
  code: none,
  link: (attrs, path) => {
    // The editor also sends target, rel and class: the reading view decides those itself.
    pick(attrs, path, { href: (value) => value }, ["target", "rel", "class"]);
    const href = safeHref(attrs.href);
    if (!href) throw new Invalid("link_not_allowed", `${path}.href`);
    return { href };
  },
};

const BLOCKS = Object.entries(NODES).filter(([, spec]) => spec.group === "block").map(([type]) => type);
const INLINES = ["text", ...Object.entries(NODES).filter(([, spec]) => spec.group === "inline").map(([type]) => type)];

function cleanMarks(raw: unknown, path: string): DocMark[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > 8) throw new Invalid("bad_marks", path);
  const marks = raw.map((mark, index) => {
    if (!isRecord(mark) || typeof mark.type !== "string") throw new Invalid("bad_marks", `${path}[${index}]`);
    const spec = MARKS[mark.type];
    if (!spec) throw new Invalid("unknown_mark", `${path}[${index}].${mark.type}`);
    for (const key of Object.keys(mark)) if (key !== "type" && key !== "attrs") throw new Invalid("unknown_field", `${path}[${index}].${key}`);
    if (mark.attrs !== undefined && mark.attrs !== null && !isRecord(mark.attrs)) throw new Invalid("bad_attribute", `${path}[${index}]`);
    const attrs = spec((mark.attrs as Attrs | undefined) ?? {}, `${path}[${index}]`);
    return attrs ? { type: mark.type, attrs } : { type: mark.type };
  });
  return marks.length ? marks : undefined;
}

function cleanNode(raw: unknown, allowed: readonly string[], path: string, depth: number, budget: { nodes: number }, marksAllowed = true): DocNode {
  if (!isRecord(raw) || typeof raw.type !== "string") throw new Invalid("bad_node", path);
  if (depth > MAX_DEPTH) throw new Invalid("too_deep", path);
  if (++budget.nodes > MAX_NODES) throw new Invalid("too_large", path);
  if (!allowed.includes(raw.type)) throw new Invalid(raw.type in NODES || raw.type === "text" ? "misplaced_node" : "unknown_node", `${path}.${raw.type}`);

  if (raw.type === "text") {
    for (const key of Object.keys(raw)) if (!["type", "text", "marks"].includes(key)) throw new Invalid("unknown_field", `${path}.${key}`);
    if (typeof raw.text !== "string" || raw.text.length === 0 || raw.text.length > 100_000) throw new Invalid("bad_text", path);
    const marks = marksAllowed ? cleanMarks(raw.marks, `${path}.marks`) : undefined;
    if (!marksAllowed && Array.isArray(raw.marks) && raw.marks.length) throw new Invalid("bad_marks", path);
    return marks ? { type: "text", text: raw.text, marks } : { type: "text", text: raw.text };
  }

  const spec = NODES[raw.type];
  for (const key of Object.keys(raw)) if (!["type", "attrs", "content", "marks"].includes(key)) throw new Invalid("unknown_field", `${path}.${key}`);
  if (Array.isArray(raw.marks) && raw.marks.length) throw new Invalid("bad_marks", path);
  if (raw.attrs !== undefined && raw.attrs !== null && !isRecord(raw.attrs)) throw new Invalid("bad_attribute", path);
  const attrs = spec.attrs?.((raw.attrs as Attrs | undefined) ?? {}, `${path}.${raw.type}`);
  const node: DocNode = attrs ? { type: raw.type, attrs } : { type: raw.type };

  if (spec.children === undefined) {
    if (Array.isArray(raw.content) && raw.content.length) throw new Invalid("leaf_with_content", path);
    return node;
  }
  if (raw.content !== undefined && raw.content !== null && !Array.isArray(raw.content)) throw new Invalid("bad_content", path);
  const childTypes = spec.children === "block" ? BLOCKS : spec.children === "inline" ? INLINES : spec.children;
  const children = ((raw.content as unknown[] | undefined) ?? []).map((child, index) => cleanNode(child, childTypes, `${path}.${raw.type}[${index}]`, depth + 1, budget, spec.marks !== false));
  if (children.length < (spec.min ?? 0)) throw new Invalid("empty_node", `${path}.${raw.type}`);
  if (children.length) node.content = children;
  return node;
}

export type DocValidation = { ok: true; doc: Doc } | { ok: false; problem: string; path: string };

/** Checks a document from the editor (or an importer) and returns the copy to store. */
export function validateDoc(input: unknown): DocValidation {
  try {
    if (!isRecord(input) || input.type !== "doc") throw new Invalid("bad_node", "doc");
    for (const key of Object.keys(input)) if (!["type", "content", "attrs"].includes(key)) throw new Invalid("unknown_field", `doc.${key}`);
    if (input.content !== undefined && !Array.isArray(input.content)) throw new Invalid("bad_content", "doc");
    const budget = { nodes: 0 };
    const content = ((input.content as unknown[] | undefined) ?? []).map((child, index) => cleanNode(child, BLOCKS, `doc[${index}]`, 1, budget));
    const doc: Doc = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
    if (new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DOC_BYTES) throw new Invalid("too_large", "doc");
    return { ok: true, doc };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, problem: error.problem, path: error.path };
    throw error;
  }
}

// ── Reading a document ──────────────────────────────────────────────────────────────────────

export function inlineText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return `@${String(node.attrs?.label ?? "")}`;
  return (node.content ?? []).map(inlineText).join("");
}

function blockLines(node: DocNode): string[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "codeBlock":
      return inlineText(node).split("\n");
    case "tableRow":
      return [(node.content ?? []).map((cell) => (cell.content ?? []).flatMap(blockLines).join(" ")).join(" | ")];
    case "attachment":
      return [String(node.attrs?.fileName ?? "")];
    case "embed":
      return [String(node.attrs?.url ?? "")];
    case "image":
      return [String(node.attrs?.alt ?? "")];
    case "horizontalRule":
      return [];
    default:
      return (node.content ?? []).flatMap(blockLines);
  }
}

/**
 * The words of a page, one line per block (a table row is one line). Feeds search, the version
 * diff and, later, the chunks the assistant retrieves.
 */
export function docToPlainText(doc: Doc): string {
  return doc.content
    .flatMap(blockLines)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type OutlineItem = { id: string; level: number; text: string };

/** The anchor of the n-th heading of a page, in document order. The reading view numbers them the same way. */
export const headingId = (index: number): string => `h-${index + 1}`;

export function outlineOf(doc: Doc): OutlineItem[] {
  const items: OutlineItem[] = [];
  const walk = (node: DocNode) => {
    if (node.type === "heading") {
      const text = inlineText(node).replace(/\s+/g, " ").trim();
      items.push({ id: headingId(items.length), level: Number(node.attrs?.level ?? 1), text });
      return;
    }
    (node.content ?? []).forEach(walk);
  };
  doc.content.forEach(walk);
  return items;
}

/** Files a document shows (attachments and uploaded pictures). */
export function fileIdsOf(doc: Doc): string[] {
  const ids = new Set<string>();
  const walk = (node: DocNode) => {
    if ((node.type === "attachment" || node.type === "image") && typeof node.attrs?.fileId === "string") ids.add(node.attrs.fileId);
    (node.content ?? []).forEach(walk);
  };
  doc.content.forEach(walk);
  return [...ids];
}

export const isEmptyDoc = (doc: Doc): boolean => docToPlainText(doc) === "" && fileIdsOf(doc).length === 0 && !JSON.stringify(doc).includes('"embed"');
