import { describe, expect, it } from "vitest";
import { bold, bulletList, callout, doc, heading, link, paragraph, text } from "./build";
import { docToNote, noteToDoc, noteToPlainText } from "./note";

describe("notes", () => {
  it("read plain text written before the editor as it was written", () => {
    const old = "Gọi khách lúc 9h\nGửi báo giá\n\nGhi chú: file_name_v2.pdf, 2 * 3";
    expect(noteToDoc(old)).toEqual(doc(paragraph("Gọi khách lúc 9h", { type: "hardBreak" }, "Gửi báo giá"), paragraph("Ghi chú: file_name_v2.pdf, 2 * 3")));
    expect(noteToPlainText(old)).toBe("Gọi khách lúc 9h\nGửi báo giá\nGhi chú: file_name_v2.pdf, 2 * 3");
    expect(noteToPlainText(null)).toBe("");
  });

  it("write what the editor holds as Markdown and read it back unchanged", () => {
    const written = doc(
      heading(2, "Mục tiêu"),
      paragraph("Hoàn thành ", bold("bản nháp"), " trước thứ Sáu, xem ", link("brief", "https://example.com/a"), ".", { type: "hardBreak" }, "snake_case giữ nguyên, _nghiêng_ thì không."),
      bulletList("Một", [paragraph("Hai", { type: "hardBreak" }, "dòng hai"), bulletList("Hai rưỡi")]),
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [paragraph("Đã gửi")] },
          { type: "taskItem", content: [paragraph("Chờ duyệt")] },
        ],
      },
      callout("warning", "Hạn chót cứng.", "Không dời."),
      { type: "blockquote", content: [paragraph("Trích 1"), paragraph("Trích 2")] },
    );
    const note = docToNote(written);
    // Straight after another bulleted list, the boxes take the other marker so the two stay apart.
    expect(note).toContain("* [x] Đã gửi\n* [ ] Chờ duyệt");
    expect(note).toContain("snake_case giữ nguyên, \\_nghiêng\\_ thì không.");
    expect(noteToDoc(note)).toEqual(written);
  });

  it("keep pictures and embeddable addresses as links, and never run markup", () => {
    const shown = noteToDoc("https://youtu.be/dQw4w9WgXcQ\n\n![x](https://example.com/a.png)\n\n<script>alert(1)</script>");
    expect(shown.content.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(shown.content[2]).toEqual(paragraph(text("<script>alert(1)</script>")));
  });

  it("store nothing for an empty editor", () => {
    expect(docToNote(doc(paragraph(), paragraph()))).toBe("");
  });
});
