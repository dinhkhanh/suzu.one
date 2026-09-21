// Golden tests of the page document rules: what is stored, what is refused, what search and the
// version diff read.
import { describe, expect, it } from "vitest";
import { bold, bulletList, callout, codeBlock, doc, embed, heading, link, orderedList, paragraph, rule, table, text } from "./build";
import { diffLines, diffStats } from "./diff";
import { docToPlainText, fileIdsOf, MAX_DOC_BYTES, outlineOf, validateDoc } from "./doc";
import { normalizeEmbed, safeHref } from "./embed";

const FILE = "0b0e7c2e-6f0a-4c55-9f59-3d1f5a1c2b3d";
const PERSON = "7d9a3f10-1111-4222-8333-944455556666";

const sample = doc(
  heading(1, "Quy định nghỉ phép"),
  paragraph("Nhân viên được ", bold("12 ngày"), " phép năm. Xem ", link("biểu mẫu", "/kb/pages/abc"), "."),
  callout("warning", "Báo trước 3 ngày làm việc."),
  heading(2, "Các bước"),
  orderedList("Tạo đơn trên SuZu One", "Quản lý duyệt"),
  bulletList([paragraph("Mục cha"), bulletList("Mục con")]),
  table(["Loại", "Số ngày"], ["Phép năm", "12"], ["Kết hôn", "3"]),
  codeBlock("a = 1\nb = 2", "python"),
  rule(),
  embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
  { type: "attachment", attrs: { fileId: FILE, fileName: "Mẫu đơn.pdf", sizeBytes: 1200 } },
  { type: "image", attrs: { fileId: FILE, alt: "Sơ đồ" } },
  paragraph("Hỏi ", { type: "mention", attrs: { personId: PERSON, label: "Phạm Bảo" } }, { type: "hardBreak" }, "cuối."),
);

describe("validateDoc", () => {
  it("accepts every supported block and returns the copy to store", () => {
    const result = validateDoc(sample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The provider is computed, not trusted.
    expect(result.doc.content.find((node) => node.type === "embed")?.attrs).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube" });
    // Validating the stored copy again changes nothing.
    expect(validateDoc(result.doc)).toEqual(result);
  });

  it("takes what the editor sends (default attributes, link target and rel) and keeps only what matters", () => {
    const result = validateDoc({
      type: "doc",
      content: [
        { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://suzu.vn", target: "_blank", rel: "noopener", class: null } }] }] }] }] },
        { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "y" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] }] }] },
      ],
    });
    expect(result).toEqual({
      ok: true,
      doc: {
        type: "doc",
        content: [
          { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://suzu.vn" } }] }] }] }] },
          { type: "codeBlock", content: [{ type: "text", text: "y" }] },
          { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] },
        ],
      },
    });
  });

  it("turns an empty document into one empty paragraph", () => {
    expect(validateDoc({ type: "doc" })).toEqual({ ok: true, doc: { type: "doc", content: [{ type: "paragraph" }] } });
  });

  const refused: [string, unknown, string][] = [
    ["a script node", doc({ type: "script", content: [text("alert(1)")] }), "unknown_node"],
    ["an iframe node", doc({ type: "iframe", attrs: { src: "https://evil.example" } }), "unknown_node"],
    ["a javascript: link", doc(paragraph(link("x", "javascript:alert(1)"))), "link_not_allowed"],
    ["a data: link", doc(paragraph(link("x", "data:text/html,<script>"))), "link_not_allowed"],
    ["a protocol-relative link", doc(paragraph(link("x", "//evil.example"))), "link_not_allowed"],
    ["an unknown mark", doc(paragraph(text("x", { type: "textStyle", attrs: { color: "red" } }))), "unknown_mark"],
    ["an event-handler attribute", doc({ type: "paragraph", attrs: { onclick: "x" } }), "unknown_attribute"],
    ["a style attribute on a heading", doc({ type: "heading", attrs: { level: 2, style: "position:fixed" }, content: [text("x")] }), "unknown_attribute"],
    ["a heading level outside 1–3", doc({ type: "heading", attrs: { level: 6 }, content: [text("x")] }), "bad_attribute"],
    ["an embed from an unknown site", doc(embed("https://evil.example/embed/1")), "embed_not_allowed"],
    ["an http picture", doc({ type: "image", attrs: { src: "http://example.com/a.png" } }), "bad_attribute"],
    ["a picture with a data: address", doc({ type: "image", attrs: { src: "data:image/svg+xml;base64,AAAA" } }), "bad_attribute"],
    ["a picture with both a file and an address", doc({ type: "image", attrs: { fileId: FILE, src: "https://example.com/a.png" } }), "bad_attribute"],
    ["an attachment without a file", doc({ type: "attachment", attrs: { fileName: "a.pdf" } }), "bad_attribute"],
    ["a block inside a paragraph", doc({ type: "paragraph", content: [paragraph("x")] }), "misplaced_node"],
    ["text at the top level", { type: "doc", content: [text("x")] }, "misplaced_node"],
    ["marks inside a code block", doc({ type: "codeBlock", content: [bold("x")] }), "bad_marks"],
    ["an unknown callout kind", doc({ type: "callout", attrs: { kind: "party" }, content: [paragraph("x")] }), "bad_attribute"],
    ["an extra field on a node", doc({ type: "paragraph", html: "<b>x</b>" } as never), "unknown_field"],
    ["something that is not a document", { type: "paragraph" }, "bad_node"],
    ["an empty list", doc({ type: "bulletList" }), "empty_node"],
  ];
  it.each(refused)("refuses %s", (_, input, problem) => {
    const result = validateDoc(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe(problem);
  });

  it("refuses a document over the size cap or nested too deep", () => {
    const big = doc(...Array.from({ length: 60 }, () => paragraph("x".repeat(10_000))));
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_DOC_BYTES);
    expect(validateDoc(big)).toMatchObject({ ok: false, problem: "too_large" });
    let nested = paragraph("x");
    for (let depth = 0; depth < 30; depth++) nested = { type: "blockquote", content: [nested] };
    expect(validateDoc(doc(nested))).toMatchObject({ ok: false, problem: "too_deep" });
  });
});

describe("reading a document", () => {
  it("gives the plain text one line per block, a table row per line", () => {
    expect(docToPlainText(sample)).toBe(
      ["Quy định nghỉ phép", "Nhân viên được 12 ngày phép năm. Xem biểu mẫu.", "Báo trước 3 ngày làm việc.", "Các bước", "Tạo đơn trên SuZu One", "Quản lý duyệt", "Mục cha", "Mục con", "Loại | Số ngày", "Phép năm | 12", "Kết hôn | 3", "a = 1", "b = 2", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Mẫu đơn.pdf", "Sơ đồ", "Hỏi @Phạm Bảo", "cuối."].join("\n"),
    );
    expect(docToPlainText(doc())).toBe("");
  });

  it("lists the headings with the anchors the reading view uses, and the files", () => {
    expect(outlineOf(sample)).toEqual([
      { id: "h-1", level: 1, text: "Quy định nghỉ phép" },
      { id: "h-2", level: 2, text: "Các bước" },
    ]);
    expect(fileIdsOf(sample)).toEqual([FILE]);
  });
});

describe("links and embeds", () => {
  it("allows http(s), mailto and in-app paths only", () => {
    expect(safeHref("https://suzu.vn/a?b=1")).toBe("https://suzu.vn/a?b=1");
    expect(safeHref(" mailto:hr@suzu.vn ")).toBe("mailto:hr@suzu.vn");
    expect(safeHref("/kb/pages/1")).toBe("/kb/pages/1");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "/\\evil.example", "ftp://x", "kb/pages/1", "", "java\nscript:alert(1)", 5, null]) expect(safeHref(bad)).toBeNull();
  });

  it("rewrites known services to their own embed address", () => {
    expect(normalizeEmbed("https://youtu.be/dQw4w9WgXcQ?t=10")).toEqual({ provider: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(normalizeEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ provider: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(normalizeEmbed("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toEqual({ provider: "google_drive", src: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview" });
    expect(normalizeEmbed("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0")).toEqual({ provider: "google_docs", src: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/preview" });
    expect(normalizeEmbed("https://www.figma.com/design/AbCdEf123456/Brand-kit?node-id=1-2&t=x")).toEqual({ provider: "figma", src: `https://www.figma.com/embed?embed_host=suzu-one&url=${encodeURIComponent("https://www.figma.com/design/AbCdEf123456/Brand-kit?node-id=1-2")}` });
    expect(normalizeEmbed("https://www.canva.com/design/DAFabcdefgh/AbCdEfGhIjKl/view")).toEqual({ provider: "canva", src: "https://www.canva.com/design/DAFabcdefgh/AbCdEfGhIjKl/view?embed" });
  });

  it("frames nothing else", () => {
    for (const bad of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=<script>", "https://user@youtube.com/watch?v=dQw4w9WgXcQ", "https://docs.google.com/forms/d/abcdefgh/viewform", "https://evil.example", "javascript:alert(1)", "not a url", 7]) expect(normalizeEmbed(bad)).toBeNull();
  });
});

describe("diffLines", () => {
  it("marks what was removed and what was added, keeping the rest", () => {
    const before = "Tiêu đề\nNghỉ phép 12 ngày\nBáo trước 3 ngày\nKết";
    const after = "Tiêu đề\nNghỉ phép 14 ngày\nBáo trước 3 ngày\nThêm dòng\nKết";
    const lines = diffLines(before, after);
    expect(lines).toEqual([
      { type: "same", text: "Tiêu đề" },
      { type: "removed", text: "Nghỉ phép 12 ngày" },
      { type: "added", text: "Nghỉ phép 14 ngày" },
      { type: "same", text: "Báo trước 3 ngày" },
      { type: "added", text: "Thêm dòng" },
      { type: "same", text: "Kết" },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("handles empty sides and identical texts", () => {
    expect(diffLines("", "a\nb")).toEqual([{ type: "added", text: "a" }, { type: "added", text: "b" }]);
    expect(diffLines("a", "")).toEqual([{ type: "removed", text: "a" }]);
    expect(diffStats(diffLines("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
});
