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
    expect(chunkDoc(policy, "Quy định nghỉ phép").map(({ index, headingPath, content }) => [index, headingPath, content])).toEqual([
      [0, "Quy định nghỉ phép", "Áp dụng cho toàn bộ nhân viên."],
      [1, "Quy định nghỉ phép › Nghỉ phép năm", "Mỗi nhân viên có 12 ngày phép năm.\nĐăng ký trước ba ngày\nQuản lý duyệt"],
      [2, "Quy định nghỉ phép › Nghỉ phép năm › Nghỉ việc riêng", "Trường hợp | Số ngày\nKết hôn | 3\nCon kết hôn | 1"],
      [3, "Quy định nghỉ phép › Nghỉ phép năm › Nghỉ không lương", "Cần thoả thuận với quản lý."],
      // A new level-1 heading forgets the level-2 heading above it.
      [4, "Quy định nghỉ phép › Nghỉ ốm › Hồ sơ", "Giấy ra viện hoặc giấy nghỉ hưởng BHXH."],
    ]);
  });

  it("packs blocks up to the limit, splits what is longer at line and sentence ends, and is deterministic", () => {
    const sentence = "Nhân viên phải tuân thủ quy định bảo mật thông tin của công ty.";
    const long = doc(heading(1, "Bảo mật"), ...Array.from({ length: 10 }, (_, index) => paragraph(`${index + 1}. ${sentence}`)), paragraph(Array.from({ length: 12 }, () => sentence).join(" ")));
    const chunks = chunkDoc(long, "Chính sách", { maxChars: 300 });
    expect(chunks.every((chunk) => chunk.content.length <= 300)).toBe(true);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.map((chunk) => chunk.content).join("\n").replace(/\s+/g, " ")).toBe(long.content.slice(1).map((node) => node.content![0].text).join(" "));
    expect(chunks.every((chunk) => chunk.headingPath === "Chính sách › Bảo mật")).toBe(true);
    expect(chunkDoc(long, "Chính sách", { maxChars: 300 })).toEqual(chunks);
    expect(chunks[0].tokenEstimate).toBe(Math.ceil(chunkEmbeddingText(chunks[0]).length / 3));
  });

  it("keeps an empty page findable by its title", () => {
    expect(chunkDoc(doc(), "Trang trống")).toEqual([{ index: 0, headingPath: "Trang trống", content: "Trang trống", tokenEstimate: 8 }]);
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
