import { describe, expect, it } from "vitest";
import { docToPlainText, validateDoc } from "./doc";
import { markdownToDoc } from "./markdown";

const SAMPLE = `# Quy định nghỉ phép

Mỗi nhân viên có **12 ngày** phép năm, _hưởng nguyên lương_. Xem [Bộ luật Lao động](https://thuvienphapluat.vn/x) và [trang nội bộ](/kb).

## Cách đăng ký

1. Vào **Nghỉ phép** → *Tạo đơn*
2. Chọn loại nghỉ
   - Phép năm
   - Nghỉ không lương
3. Gửi quản lý duyệt

> [!WARNING]
> Đăng ký trước **3 ngày** làm việc.

> Trích dẫn thường.

| Loại nghỉ | Số ngày | Ghi chú |
|---|---:|---|
| Kết hôn | 3 | Bản thân |
| Tang | 3 | Tứ thân phụ mẫu |

#### Tiêu đề cấp 4

\`\`\`ts
const days = 12;
\`\`\`

---

![Sơ đồ](https://example.com/so-do.png)

https://www.youtube.com/watch?v=dQw4w9WgXcQ
`;

describe("markdownToDoc", () => {
  it("turns a policy written in Markdown into a valid document", () => {
    const { title, doc } = markdownToDoc(SAMPLE);
    expect(title).toBe("Quy định nghỉ phép");
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "heading", "orderedList", "callout", "blockquote", "table", "heading", "codeBlock", "horizontalRule", "image", "embed"]);
    expect(doc.content[0].content).toEqual([
      { type: "text", text: "Mỗi nhân viên có " },
      { type: "text", text: "12 ngày", marks: [{ type: "bold" }] },
      { type: "text", text: " phép năm, " },
      { type: "text", text: "hưởng nguyên lương", marks: [{ type: "italic" }] },
      { type: "text", text: ". Xem " },
      { type: "text", text: "Bộ luật Lao động", marks: [{ type: "link", attrs: { href: "https://thuvienphapluat.vn/x" } }] },
      { type: "text", text: " và " },
      { type: "text", text: "trang nội bộ", marks: [{ type: "link", attrs: { href: "/kb" } }] },
      { type: "text", text: "." },
    ]);
    const [, , list, callout, , table, deep, code, , image, embed] = doc.content;
    expect(list.content).toHaveLength(3);
    expect(list.content![1].content!.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
    expect(callout).toMatchObject({ attrs: { kind: "warning" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Đăng ký trước " }, { type: "text", text: "3 ngày", marks: [{ type: "bold" }] }, { type: "text", text: " làm việc." }] }] });
    expect(table.content).toHaveLength(3);
    expect(table.content![0].content!.map((cell) => cell.type)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
    expect(table.content![2].content![2].content![0].content![0].text).toBe("Tứ thân phụ mẫu");
    expect(deep.attrs).toEqual({ level: 3 });
    expect(code).toEqual({ type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const days = 12;" }] });
    expect(image.attrs).toEqual({ src: "https://example.com/so-do.png", alt: "Sơ đồ" });
    expect(embed.attrs).toMatchObject({ provider: "youtube" });
    expect(docToPlainText(doc)).toContain("Kết hôn");
  });

  it("never lets markup or an unsafe address through", () => {
    const { doc } = markdownToDoc(`Xin chào <script>alert(1)</script> [bấm](javascript:alert(1)) ![x](http://insecure/x.png)\n\n<iframe src="https://evil.example"></iframe>\n\n<!-- ghi chú của Google Docs -->\n\nA &amp; B &lt;3`);
    expect(validateDoc(doc).ok).toBe(true);
    const flat = JSON.stringify(doc);
    expect(flat).not.toContain("javascript:");
    expect(flat).not.toContain('"link"');
    expect(flat).not.toContain("ghi chú của Google Docs");
    // Raw HTML survives only as the text it is; the reading view prints text, never markup.
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(doc.content[1].content![0].text).toBe('<iframe src="https://evil.example"></iframe>');
    expect(doc.content[2].content![0].text).toBe("A & B <3");
  });

  it("keeps a document without a leading title, an empty text, task lists and ragged tables", () => {
    expect(markdownToDoc("Không có tiêu đề\n\n# Tiêu đề ở giữa").title).toBeNull();
    expect(markdownToDoc("# Chỉ tiêu đề").doc.content).toEqual([{ type: "paragraph" }]);
    expect(markdownToDoc("").doc.content).toEqual([{ type: "paragraph" }]);
    expect(markdownToDoc("# Giữ lại", { liftTitle: false }).doc.content[0].type).toBe("heading");
    const tasks = markdownToDoc("- [x] Xong\n- [ ] Chưa").doc.content[0];
    expect(tasks.content!.map((item) => item.content![0].content![0].text)).toEqual(["☑ Xong", "☐ Chưa"]);
    const ragged = markdownToDoc("| a | b |\n|---|---|\n| 1 |").doc.content[0];
    expect(ragged.content![1].content).toHaveLength(2);
  });
});

import { mammothHtmlToMarkdown } from "./docx-html";

describe("mammothHtmlToMarkdown", () => {
  const HTML = `<h1>Quy chế công tác phí</h1><p>Áp dụng cho <strong>toàn bộ</strong> nhân viên &amp; <em>cộng tác viên</em>. Xem <a href="https://suzu.one/kb (1)">tại đây</a>.</p><h2>Định mức</h2><table><tr><th><p>Khoản</p></th><th><p>Mức</p></th></tr><tr><td><p>Khách sạn</p></td><td><p>Theo thực tế | có hoá đơn</p></td></tr></table><ol><li>Lập đề nghị<ul><li>Kèm kế hoạch</li></ul></li><li>Trình duyệt</li></ol><p>2 * 3 = 6 &lt;script&gt;alert(1)&lt;/script&gt;</p><p><img src="data:image/png;base64,xx" /></p>`;

  it("keeps headings, emphasis, links, nested lists and tables — and only text of everything else", () => {
    const markdown = mammothHtmlToMarkdown(HTML);
    expect(markdown).toBe(
      [
        "# Quy chế công tác phí",
        "",
        "Áp dụng cho **toàn bộ** nhân viên & _cộng tác viên_. Xem [tại đây](https://suzu.one/kb%20%281%29).",
        "",
        "## Định mức",
        "",
        "| Khoản | Mức |",
        "| --- | --- |",
        "| Khách sạn | Theo thực tế \\| có hoá đơn |",
        "",
        "1. Lập đề nghị",
        "   - Kèm kế hoạch",
        "2. Trình duyệt",
        "",
        "2 \\* 3 = 6 \\<script\\>alert(1)\\</script\\>",
        "",
      ].join("\n"),
    );
    const { title, doc } = markdownToDoc(markdown);
    expect(title).toBe("Quy chế công tác phí");
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "heading", "table", "orderedList", "paragraph"]);
    expect(doc.content[3].content![0].content!.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
    expect(doc.content[4].content![0].text).toBe("2 * 3 = 6 <script>alert(1)</script>");
    expect(doc.content[2].content![1].content![1].content![0].content![0].text).toBe("Theo thực tế | có hoá đơn");
  });
});
