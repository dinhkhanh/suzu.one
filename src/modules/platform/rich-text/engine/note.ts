// A note: the short formatted text a task description, a comment, a meeting's minutes or a
// candidate's notes are. Pure. It is stored as Markdown in the column that always held the plain
// text, so nothing is migrated: plain text written before is already a note (a line break is a
// break), and whatever else reads the column — a notification, an export, the assistant — still
// reads words.
//
// A note is never turned into HTML. The reading view builds it into the page document (the
// validator's allow-list) and renders that; the editor loads the same document and writes Markdown
// back.
import type { CalloutKind } from "./callouts";
import { type Doc, type DocNode, docToPlainText } from "./doc";
import { blockMarkdown } from "./doc-markdown";
import { markdownToDoc } from "./markdown";

/** The document a note shows. Pictures and framed embeds stay links in a note. */
export function noteToDoc(note: string | null | undefined): Doc {
  return markdownToDoc(note ?? "", { liftTitle: false, breaks: true, media: false }).doc;
}

// The GitHub alert each callout reads back as.
const ALERT: Record<CalloutKind, string> = { info: "NOTE", success: "TIP", warning: "WARNING", danger: "CAUTION" };

function noteBlock(node: DocNode): string[] {
  if (node.type === "heading") {
    const [first = "", ...rest] = blockMarkdown(node);
    return [`${"#".repeat(Number(node.attrs?.level ?? 1))} ${first}`, ...rest];
  }
  if (node.type === "blockquote" || node.type === "callout") {
    // A blank quoted line keeps the paragraphs inside apart.
    const lines = (node.content ?? []).flatMap((child, index) => (index ? ["", ...noteBlock(child)] : noteBlock(child))).map((line) => (line ? `> ${line}` : ">"));
    return node.type === "callout" ? [`> [!${ALERT[node.attrs?.kind as CalloutKind] ?? ALERT.info}]`, ...lines] : lines;
  }
  return blockMarkdown(node);
}

const BULLETED = ["bulletList", "taskList"];

/**
 * Two lists in a row written with the same marker would read back as one: the second takes the
 * other marker (`*` for `-`, `)` for `.`).
 */
function otherMarkers(lines: string[], ordered: boolean): string[] {
  return lines.map((line) => (ordered ? line.replace(/^(\d+)\. /, "$1) ") : line.replace(/^- /, "* ")));
}

/** The Markdown to store for what the editor holds. Empty when there is nothing but blank lines. */
export function docToNote(doc: Doc): string {
  const blocks: string[] = [];
  let previous: { type: string; switched: boolean } | null = null;
  for (const node of doc.content) {
    let lines = noteBlock(node);
    if (!lines.some((line) => line.trim() !== "")) continue;
    const ordered = node.type === "orderedList";
    const sameFamily: boolean = previous !== null && (ordered ? previous.type === "orderedList" : BULLETED.includes(node.type) && BULLETED.includes(previous.type));
    const switched: boolean = sameFamily && !previous!.switched;
    if (switched) lines = otherMarkers(lines, ordered);
    blocks.push(lines.join("\n"));
    previous = { type: node.type, switched };
  }
  return blocks.join("\n\n");
}

/** The words of a note, without its markers: for a one-line preview, a notification or a search key. */
export const noteToPlainText = (note: string | null | undefined): string => (note?.trim() ? docToPlainText(noteToDoc(note)) : "");
