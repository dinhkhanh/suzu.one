import { describe, expect, it } from "vitest";
import { markdownToDoc } from "@/modules/platform/rich-text/engine/markdown";
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
