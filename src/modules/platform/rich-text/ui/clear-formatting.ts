// "Clear formatting": what is selected becomes plain paragraphs of its words. For text pasted from
// somewhere else that brought odd blocks and styling with it, or a page that has grown strange.
// With nothing selected it clears the paragraph the cursor is in; select all to clear a page.
// Undo brings everything back.
//
// - every mark goes (bold, links, highlight, code…), and alignment with it;
// - headings, list items, quotes, callouts and checkboxes become paragraphs, lifted out of their
//   wrappers;
// - a code block becomes a paragraph, a line break for each of its lines;
// - a table wholly selected becomes a paragraph per row, its cells separated by " | ";
// - a block that is not text (an embed, a picture, an attachment, a divider) wholly selected is
//   removed.
//
// A ProseMirror transform and nothing else, so it is tested without a browser.
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";

function textOf(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText) text += child.text;
    else if (child.type.name === "hardBreak") text += " ";
    else if (child.isBlock && text && !text.endsWith(" ")) text += " ";
    return true;
  });
  return text.replace(/\s+/g, " ").trim();
}

const paragraph = (schema: Schema, text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);

/** A code block's lines, as one paragraph with a break between them. */
function codeAsParagraph(schema: Schema, node: ProseMirrorNode): ProseMirrorNode {
  const lines = node.textContent.split("\n");
  const content = lines.flatMap((line, index) => [...(index ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line)] : [])]);
  return schema.nodes.paragraph.create(null, content);
}

/** Clears what `tr`'s selection covers, in place. Returns the same transaction. */
export function clearFormatting(tr: Transaction): Transaction {
  const schema = tr.doc.type.schema;

  // Nothing selected: the text block the cursor is in.
  if (tr.selection.empty && tr.selection.$from.parent.isTextblock) {
    const $at = tr.selection.$from;
    tr.setSelection(TextSelection.create(tr.doc, $at.start(), $at.end()));
  }
  const { from, to } = tr.selection;

  // Blocks that are not plain text: tables and atoms wholly inside the selection, code blocks it touches.
  const replaced: { pos: number; node: ProseMirrorNode; with: ProseMirrorNode[] }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    const inside = pos >= from && pos + node.nodeSize <= to;
    if (node.type.name === "codeBlock") {
      replaced.push({ pos, node, with: [codeAsParagraph(schema, node)] });
      return false;
    }
    if (!inside) return true;
    if (node.type.name === "table") {
      const rows: ProseMirrorNode[] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(textOf(cell)));
        rows.push(paragraph(schema, cells.filter(Boolean).join(" | ")));
      });
      replaced.push({ pos, node, with: rows });
      return false;
    }
    if (node.isBlock && node.isAtom) {
      replaced.push({ pos, node, with: [] });
      return false;
    }
    return true;
  });
  // From the end, so the positions still to come are not moved by what is done.
  for (const { pos, node, with: nodes } of replaced.reverse()) {
    if (nodes.length) tr.replaceWith(pos, pos + node.nodeSize, nodes);
    // A removed block may have been the only thing in its callout or cell: deleteRange closes up.
    else tr.deleteRange(pos, pos + node.nodeSize);
  }

  const start = tr.mapping.map(from, -1);
  const end = Math.max(start, tr.mapping.map(to, 1));
  tr.removeMark(start, end);

  // Every text block in the range becomes a paragraph (which also drops its alignment), and each
  // node is lifted out of the lists, quotes and callouts around it as far as the document allows
  // (a table cell is as far as it goes): Tiptap's `clearNodes` over the whole range, repeated
  // until nothing moves — an item of a nested list comes out one level per pass.
  let [rangeFrom, rangeTo] = [start, end];
  for (let pass = 0; pass < 8; pass++) {
    const base = tr.steps.length;
    tr.doc.nodesBetween(rangeFrom, rangeTo, (node, pos) => {
      if (node.isText) return;
      const mapping = tr.mapping.slice(base);
      const $from = tr.doc.resolve(mapping.map(pos));
      const $to = tr.doc.resolve(mapping.map(pos + node.nodeSize));
      const range = $from.blockRange($to);
      if (!range) return;
      const target = liftTarget(range);
      if (node.isTextblock && !node.hasMarkup(schema.nodes.paragraph)) tr.setNodeMarkup(range.start, schema.nodes.paragraph);
      if (target !== null && target !== undefined) tr.lift(range, target);
    });
    if (tr.steps.length === base) break;
    const moved = tr.mapping.slice(base);
    [rangeFrom, rangeTo] = [moved.map(rangeFrom, -1), moved.map(rangeTo, 1)];
  }
  if (tr.selection.empty) tr.setStoredMarks([]);
  return tr;
}
