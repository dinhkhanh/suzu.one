// A page block as Markdown, for the passages the assistant quotes (FR-KB-11, FR-AI-01). Pure.
//
// The plain text (`docToPlainText`) is right for search and the version diff, but it drops what a
// reader needs to read an answer: which lines are a list, which row of a table is its header,
// what was bold, where a link pointed. The chunks carry this instead, so an answer can be shown as
// the page showed it. Markdown is the carrier because a real model reads and writes it as well.
//
// Escaping is deliberately light — only what would change the structure (`*`, `_`, backticks,
// brackets, a leading `#` or `>`, and `|` inside a table) — so the text stays searchable and the
// facts in it stay byte-for-byte what HR wrote.
import { CALLOUT_KINDS, type CalloutKind } from "./callouts";
import type { DocMark, DocNode } from "./doc";

const CALLOUT_SIGN: Record<CalloutKind, string> = { info: "ℹ️", warning: "⚠️", success: "✅", danger: "⛔" };

const escapeInline = (text: string, inTable: boolean): string => {
  const escaped = text.replace(/([\\`*_[\]])/g, "\\$1");
  return inTable ? escaped.replace(/\|/g, "\\|") : escaped;
};

/** A line that would start a heading, quote or list when it is only text. */
const escapeLineStart = (line: string): string =>
  line.replace(/^(\s*)(#{1,6}\s|>|[-+]\s)/, "$1\\$2").replace(/^(\s*\d+)([.)]\s)/, "$1\\$2");

function wrap(text: string, marks: DocMark[] | undefined): string {
  if (!marks?.length || !text.trim()) return text;
  // Markdown emphasis cannot open or close on a space: keep the spaces outside the markers.
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  let core = text.slice(lead.length, text.length - trail.length);
  for (const mark of marks) {
    if (mark.type === "code") core = `\`${core.replace(/\\([\\`*_[\]|])/g, "$1").replace(/`/g, "")}\``;
    else if (mark.type === "bold") core = `**${core}**`;
    else if (mark.type === "italic") core = `*${core}*`;
    else if (mark.type === "strike") core = `~~${core}~~`;
    else if (mark.type === "link" && typeof mark.attrs?.href === "string") core = `[${core}](${mark.attrs.href.replace(/[()\s]/g, encodeURIComponent)})`;
  }
  return `${lead}${core}${trail}`;
}

/** A block's inline content. Hard breaks become separate lines. */
function inline(node: DocNode, inTable = false): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === "text") return wrap(escapeInline(child.text ?? "", inTable), child.marks);
      if (child.type === "hardBreak") return inTable ? " " : "\n";
      if (child.type === "mention") return `@${escapeInline(String(child.attrs?.label ?? ""), inTable)}`;
      return inline(child, inTable);
    })
    .join("");
}

const indent = (lines: string[], by: string): string[] => lines.map((line) => (line ? `${by}${line}` : line));

function listLines(node: DocNode, ordered: boolean): string[] {
  const start = ordered && typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return (node.content ?? []).flatMap((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- ";
    // An item's own paragraphs join into one line; a nested list follows, indented under it.
    const own: string[] = [];
    const nested: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") nested.push(...listLines(child, child.type === "orderedList"));
      else own.push(blockMarkdown(child).join(" "));
    }
    return [`${marker}${own.join(" ").trim()}`, ...indent(nested, " ".repeat(marker.length))];
  });
}

function tableLines(node: DocNode): string[] {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((block) => inline(block, true)).join(" ").replace(/\s+/g, " ").trim()));
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  // A Markdown table needs a header row. The editor makes the first row one; an imported table
  // without one still reads correctly with its first row promoted.
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)];
}

/** The Markdown lines of one top-level block (headings excluded: they name chunks). */
export function blockMarkdown(node: DocNode): string[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return inline(node).split("\n").map((line) => escapeLineStart(line.trim())).filter(Boolean);
    case "bulletList":
    case "orderedList":
      return listLines(node, node.type === "orderedList");
    case "table":
      return tableLines(node);
    case "blockquote":
      return (node.content ?? []).flatMap(blockMarkdown).map((line) => `> ${line}`);
    case "callout": {
      const kind = (CALLOUT_KINDS as readonly unknown[]).includes(node.attrs?.kind) ? (node.attrs?.kind as CalloutKind) : "info";
      const lines = (node.content ?? []).flatMap(blockMarkdown);
      return lines.length ? [`> ${CALLOUT_SIGN[kind]} ${lines[0]}`, ...lines.slice(1).map((line) => `> ${line}`)] : [];
    }
    case "codeBlock": {
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      return text.trim() ? ["```", ...text.replace(/```/g, "``​`").split("\n"), "```"] : [];
    }
    case "attachment":
      return [escapeInline(String(node.attrs?.fileName ?? ""), false)].filter(Boolean);
    case "image":
      return [escapeInline(String(node.attrs?.alt ?? ""), false)].filter(Boolean);
    case "embed":
      return typeof node.attrs?.url === "string" ? [`<${node.attrs.url}>`] : [];
    case "horizontalRule":
      return [];
    default:
      return (node.content ?? []).flatMap(blockMarkdown);
  }
}

/** Every heading inside a node, nested ones included — the reading view numbers them all. */
export const headingsIn = (node: DocNode): number => (node.type === "heading" ? 1 : 0) + (node.content ?? []).reduce((sum, child) => sum + headingsIn(child), 0);
