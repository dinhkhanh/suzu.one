import { describe, expect, it } from "vitest";
import { formatBytes, listZipEntries, previewKindOf, readsBytes } from "./preview";

// A small archive of stored (not deflated) entries, written by hand.
function zipOf(entries: { name: string; data: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
  for (const entry of entries) {
    const name = [...encoder.encode(entry.name)];
    const data = [...encoder.encode(entry.data)];
    const offset = locals.length;
    locals.push(...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(locals.length), ...u16(0)];
  return new Uint8Array([...locals, ...central, ...end]);
}

describe("previewKindOf", () => {
  it("picks the viewer from the file name, whatever its case", () => {
    expect(previewKindOf("Hợp đồng.PDF")).toBe("pdf");
    expect(previewKindOf("receipt.jpeg")).toBe("image");
    expect(previewKindOf("cut-v2.mov")).toBe("video");
    expect(previewKindOf("memo.m4a")).toBe("audio");
    expect(previewKindOf("offer.docx")).toBe("document");
    expect(previewKindOf("salary.xlsx")).toBe("spreadsheet");
    expect(previewKindOf("export.csv")).toBe("csv");
    expect(previewKindOf("assets.zip")).toBe("archive");
  });

  it("falls back to the storage link when the screen only knows a label", () => {
    expect(previewKindOf("Mở tệp đính kèm", "https://r2.example/bucket/leave/2026/0a1b.png?X-Amz-Expires=60")).toBe("image");
    expect(previewKindOf(null, "https://r2.example/bucket/x/2026/id.pdf?X-Amz-Signature=abc")).toBe("pdf");
  });

  it("has no viewer for what a browser cannot show", () => {
    expect(previewKindOf("old.doc")).toBe("none");
    expect(previewKindOf("setup.exe")).toBe("none");
    expect(previewKindOf("README")).toBe("none");
    expect(previewKindOf(null, "not a url")).toBe("none");
  });

  it("knows which viewers read the bytes themselves", () => {
    expect(readsBytes("pdf")).toBe(true);
    expect(readsBytes("archive")).toBe(true);
    expect(readsBytes("video")).toBe(false);
    expect(readsBytes("image")).toBe(false);
  });
});

describe("listZipEntries", () => {
  it("lists files and folders from the central directory, Vietnamese names included", () => {
    expect(
      listZipEntries(
        zipOf([
          { name: "docs/", data: "" },
          { name: "docs/Bảng lương.txt", data: "hi" },
        ]),
      ),
    ).toEqual([
      { name: "docs/", sizeBytes: 0, directory: true },
      { name: "docs/Bảng lương.txt", sizeBytes: 2, directory: false },
    ]);
  });

  it("returns null for bytes that are not a zip", () => {
    expect(listZipEntries(new TextEncoder().encode("just some text, long enough to scan"))).toBeNull();
    expect(listZipEntries(new Uint8Array(0))).toBeNull();
  });
});

describe("formatBytes", () => {
  it("reads like a person would say it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });
});
