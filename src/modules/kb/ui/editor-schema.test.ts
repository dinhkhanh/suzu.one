// The editor and the server must agree on what a document is: every block the validator stores
// has to load into the editor's ProseMirror schema unchanged, and what the editor produces has to
// pass the validator. No DOM needed: the schema is built from the same extensions the editor uses.
import { getSchema } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { bold, bulletList, callout, codeBlock, doc, embed, heading, link, orderedList, paragraph, rule, table } from "../engine/build";
import { validateDoc } from "../engine/doc";
import { Attachment, Callout, Embed, KbImage } from "./editor-nodes";

const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), TableKit, Callout, Embed, Attachment, KbImage]);
const FILE = "0b0e7c2e-6f0a-4c55-9f59-3d1f5a1c2b3d";

const sample = doc(
  heading(1, "Quy định"),
  paragraph("Được ", bold("12 ngày"), ", xem ", link("biểu mẫu", "/kb/pages/abc"), "."),
  callout("warning", "Báo trước 3 ngày.", bulletList("a", "b")),
  orderedList("Một", "Hai"),
  table(["Loại", "Số ngày"], ["Phép năm", "12"]),
  codeBlock("a = 1", "python"),
  rule(),
  embed("https://youtu.be/dQw4w9WgXcQ"),
  { type: "attachment", attrs: { fileId: FILE, fileName: "Mẫu.pdf", sizeBytes: 10 } },
  { type: "image", attrs: { fileId: FILE, alt: "Sơ đồ" } },
);

describe("the editor's schema and the server's validator", () => {
  it("load a stored document into the editor's schema without loss", () => {
    const stored = validateDoc(sample);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const node = ProseMirrorNode.fromJSON(schema, stored.doc);
    node.check();
    // What the editor would send back is accepted and normalises to the very same document.
    expect(validateDoc(node.toJSON())).toEqual(stored);
  });

  it("know the same blocks and marks", () => {
    for (const name of ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak", "table", "tableRow", "tableCell", "tableHeader", "callout", "embed", "attachment", "image"]) expect(schema.nodes[name], name).toBeDefined();
    for (const name of ["bold", "italic", "strike", "underline", "code", "link"]) expect(schema.marks[name], name).toBeDefined();
  });
});
