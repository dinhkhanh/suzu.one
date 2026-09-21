import { describe, expect, it } from "vitest";
import { bulletList, callout, doc, heading, paragraph, table } from "./build";
import { chunkDoc, chunkEmbeddingText } from "./chunk";
import { cosine, FAKE_EMBEDDING_DIMS, fakeEmbedding } from "./fake-embedding";

const policy = doc(
  paragraph("Áp dụng cho toàn bộ nhân viên."),
  heading(1, "Nghỉ phép năm"),
  paragraph("Mỗi nhân viên có 12 ngày phép năm."),
  bulletList("Đăng ký trước ba ngày", "Quản lý duyệt"),
  heading(2, "Nghỉ việc riêng"),
  table(["Trường hợp", "Số ngày"], ["Kết hôn", "3"], ["Con kết hôn", "1"]),
  heading(2, "Nghỉ không lương"),
  callout("warning", "Cần thoả thuận với quản lý."),
  heading(1, "Nghỉ ốm"),
  heading(2, "Hồ sơ"),
  paragraph("Giấy ra viện hoặc giấy nghỉ hưởng BHXH."),
);

describe("chunkDoc", () => {
  it("cuts at headings and names each chunk by its heading path", () => {
    expect(chunkDoc(policy, "Quy định nghỉ phép").map(({ index, headingPath, anchor, content }) => [index, headingPath, anchor, content])).toEqual([
      [0, "Quy định nghỉ phép", null, "Áp dụng cho toàn bộ nhân viên."],
      [1, "Quy định nghỉ phép › Nghỉ phép năm", "h-1", "Mỗi nhân viên có 12 ngày phép năm.\n\n- Đăng ký trước ba ngày\n- Quản lý duyệt"],
      [2, "Quy định nghỉ phép › Nghỉ phép năm › Nghỉ việc riêng", "h-2", "| Trường hợp | Số ngày |\n| --- | --- |\n| Kết hôn | 3 |\n| Con kết hôn | 1 |"],
      [3, "Quy định nghỉ phép › Nghỉ phép năm › Nghỉ không lương", "h-3", "> ⚠️ Cần thoả thuận với quản lý."],
      // A new level-1 heading forgets the level-2 heading above it. "Nghỉ ốm" (h-4) has no text of its own.
      [4, "Quy định nghỉ phép › Nghỉ ốm › Hồ sơ", "h-5", "Giấy ra viện hoặc giấy nghỉ hưởng BHXH."],
    ]);
  });

  it("keeps a long table's header on every piece, and counts headings nested in a block", () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`Trường hợp số ${index + 1}`, `${index + 1} ngày`]);
    const long = doc(heading(1, "Bảng"), table(["Trường hợp", "Số ngày"], ...rows), callout("info", "Ghi chú"), heading(1, "Sau"), paragraph("Hết."));
    const chunks = chunkDoc(long, "Trang", { maxChars: 300 });
    const tables = chunks.filter((chunk) => chunk.content.startsWith("|"));
    expect(tables.length).toBeGreaterThan(1);
    for (const piece of tables) expect(piece.content.split("\n").slice(0, 2)).toEqual(["| Trường hợp | Số ngày |", "| --- | --- |"]);
    expect(tables.flatMap((piece) => piece.content.split("\n\n")[0].split("\n").slice(2))).toEqual(rows.map(([a, b]) => `| ${a} | ${b} |`));
    expect(chunks.at(-1)).toMatchObject({ headingPath: "Trang › Sau", anchor: "h-2", content: "Hết." });
    const nested = doc(callout("info", "x"), { type: "blockquote", content: [heading(2, "Trong trích dẫn")] }, heading(1, "Ngoài"), paragraph("y"));
    expect(chunkDoc(nested, "T").at(-1)?.anchor).toBe("h-2");
  });

  it("writes marks and links as Markdown and escapes what would change the structure", () => {
    const marked = doc({ type: "paragraph", content: [{ type: "text", text: "Nộp " }, { type: "text", text: "trước ngày 5", marks: [{ type: "bold" }] }, { type: "text", text: " tại " }, { type: "text", text: "mục Nghỉ phép", marks: [{ type: "link", attrs: { href: "/leave" } }] }, { type: "text", text: " (a*b_c)." }] }, paragraph("1. Không phải danh sách"), paragraph("# Không phải tiêu đề"));
    expect(chunkDoc(marked, "T")[0].content).toBe("Nộp **trước ngày 5** tại [mục Nghỉ phép](/leave) (a\\*b\\_c).\n\n1\\. Không phải danh sách\n\n\\# Không phải tiêu đề");
  });

  it("packs blocks up to the limit, splits what is longer at line and sentence ends, and is deterministic", () => {
    const sentence = "Nhân viên phải tuân thủ quy định bảo mật thông tin của công ty.";
    const long = doc(heading(1, "Bảo mật"), ...Array.from({ length: 10 }, (_, index) => paragraph(`${index + 1}. ${sentence}`)), paragraph(Array.from({ length: 12 }, () => sentence).join(" ")));
    const chunks = chunkDoc(long, "Chính sách", { maxChars: 300 });
    expect(chunks.every((chunk) => chunk.content.length <= 300)).toBe(true);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.map((chunk) => chunk.content).join("\n").replace(/\\(.)/g, "$1").replace(/\s+/g, " ")).toBe(long.content.slice(1).map((node) => node.content![0].text).join(" "));
    expect(chunks.every((chunk) => chunk.headingPath === "Chính sách › Bảo mật")).toBe(true);
    expect(chunkDoc(long, "Chính sách", { maxChars: 300 })).toEqual(chunks);
    expect(chunks[0].tokenEstimate).toBe(Math.ceil(chunkEmbeddingText(chunks[0]).length / 3));
  });

  it("keeps an empty page findable by its title", () => {
    expect(chunkDoc(doc(), "Trang trống")).toEqual([{ index: 0, headingPath: "Trang trống", anchor: null, content: "Trang trống", tokenEstimate: 8 }]);
    expect(chunkDoc(doc(), "  ")).toEqual([]);
  });
});

describe("the fake embedding", () => {
  it("is deterministic, unit length, accent-blind — and closer for texts that share words", () => {
    const leave = fakeEmbedding("Quy định nghỉ phép năm của nhân viên");
    expect(leave).toHaveLength(FAKE_EMBEDDING_DIMS);
    expect(fakeEmbedding("Quy định nghỉ phép năm của nhân viên")).toEqual(leave);
    expect(Math.sqrt(leave.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 4);
    expect(cosine(leave, fakeEmbedding("quy dinh nghi phep nam cua nhan vien"))).toBeCloseTo(1, 5);
    expect(cosine(leave, fakeEmbedding("nghỉ phép năm được bao nhiêu ngày"))).toBeGreaterThan(cosine(leave, fakeEmbedding("quy trình tạm ứng công tác phí")));
    expect(fakeEmbedding("")).toEqual(new Array(FAKE_EMBEDDING_DIMS).fill(0));
    expect(cosine(leave, fakeEmbedding(""))).toBe(0);
  });
});
