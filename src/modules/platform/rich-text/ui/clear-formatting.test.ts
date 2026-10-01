import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { bold, bulletList, callout, codeBlock, doc, heading, link, paragraph, rule, table, text } from "../engine/build";
import { type Doc, validateDoc } from "../engine/doc";
import { clearFormatting } from "./clear-formatting";
import { textExtensions } from "./extensions";

// The page editor's embeds, pictures and attachments are blocks that are not text, as a divider
// is: cleared the same way.
const schema = getSchema(textExtensions());

function cleared(input: Doc, select: (node: ProseMirrorNode) => EditorState["selection"]): unknown {
  const node = ProseMirrorNode.fromJSON(schema, input);
  const state = EditorState.create({ doc: node, selection: select(node) });
  const tr = clearFormatting(state.tr);
  tr.doc.check();
  // Through the validator, as a save would: it drops the editor's empty default attributes.
  const stored = validateDoc(tr.doc.toJSON());
  if (!stored.ok) throw new Error(`${stored.problem} at ${stored.path}`);
  return stored.doc;
}

const all = (node: ProseMirrorNode) => new AllSelection(node);
const plain = (...lines: string[]) => doc(...lines.map((line) => paragraph(line)));

describe("clear formatting", () => {
  it("takes a whole page back to plain paragraphs of its words", () => {
    const page = doc(
      heading(2, "Tiêu đề"),
      { type: "paragraph", attrs: { textAlign: "center" }, content: [bold("Đậm"), text(" và "), link("liên kết", "https://example.com"), text(" tô", { type: "highlight" })] },
      bulletList("Một", [paragraph("Hai"), bulletList("Hai rưỡi")]),
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Việc")] }] },
      callout("warning", "Cẩn thận"),
      { type: "blockquote", content: [paragraph("Trích")] },
      codeBlock("a = 1\nb = 2"),
      table(["Loại", "Số ngày"], ["Phép năm", "12"]),
      rule(),
      paragraph("Cuối"),
    );
    const result = cleared(page, all) as Doc;
    const code = result.content.find((node) => node.content?.some((child) => child.type === "hardBreak"));
    expect(code).toEqual(paragraph("a = 1", { type: "hardBreak" }, "b = 2"));
    expect(result.content.filter((node) => node !== code)).toEqual(plain("Tiêu đề", "Đậm và liên kết tô", "Một", "Hai", "Hai rưỡi", "Việc", "Cẩn thận", "Trích", "Loại | Số ngày", "Phép năm | 12", "Cuối").content);
  });

  it("with nothing selected, clears only the block the cursor is in", () => {
    const page = doc(heading(1, "Giữ"), { type: "blockquote", content: [paragraph(bold("Bỏ"))] }, heading(1, "Giữ"));
    const result = cleared(page, (node) => TextSelection.create(node, node.child(0).nodeSize + 3));
    expect(result).toEqual(doc(heading(1, "Giữ"), paragraph("Bỏ"), heading(1, "Giữ")));
  });

  it("clears marks only where the selection reaches inside a paragraph", () => {
    const page = doc(paragraph(bold("đậm hết")));
    // Select "đậm" (positions 1..4).
    const result = cleared(page, (node) => TextSelection.create(node, 1, 4));
    expect(result).toEqual(doc(paragraph("đậm", bold(" hết"))));
  });

  it("removes a picked block, even the only one in a callout", () => {
    const page = doc(paragraph("Trước"), callout("info", rule()), paragraph("Sau"));
    const at = ProseMirrorNode.fromJSON(schema, page).child(0).nodeSize + 1;
    const result = cleared(page, (node) => NodeSelection.create(node, at)) as Doc;
    expect(JSON.stringify(result)).not.toContain("horizontalRule");
    expect(result.content.at(0)).toEqual(paragraph("Trước"));
    expect(result.content.at(-1)).toEqual(paragraph("Sau"));
  });

  it("leaves a table it only reaches into, clearing the text in its cells", () => {
    const page = doc(table(["A", "B"], [bold("1"), "2"]));
    const node = ProseMirrorNode.fromJSON(schema, page);
    let inCell = 0;
    node.descendants((child, pos) => {
      if (!inCell && child.isText && child.text === "1") inCell = pos;
      return !inCell;
    });
    const result = cleared(page, (doc) => TextSelection.create(doc, inCell, inCell + 1));
    expect(result).toEqual(doc(table(["A", "B"], ["1", "2"])));
  });
});
