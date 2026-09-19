import { describe, expect, it } from "vitest";
import { checkUpload, cleanFileName, matchesSignature, MAX_FILE_BYTES } from "./rules";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("checkUpload", () => {
  it("accepts office documents and images, deciding the content type itself", () => {
    expect(checkUpload({ fileName: "Hợp đồng lao động.PDF", sizeBytes: 1000 })).toEqual({ ok: true, fileName: "Hợp đồng lao động.PDF", contentType: "application/pdf" });
    expect(checkUpload({ fileName: "cccd.jpeg", sizeBytes: 1 })).toMatchObject({ ok: true, contentType: "image/jpeg" });
  });

  it("refuses anything a browser or a computer would run", () => {
    for (const fileName of ["invoice.exe", "page.html", "logo.svg", "macro.docm", "script.js", "noextension", "archive.pdf.zip"]) {
      expect(checkUpload({ fileName, sizeBytes: 10 }), fileName).toEqual({ ok: false, problem: "file_type_not_allowed" });
    }
  });

  it("refuses empty, oversized and nameless files", () => {
    expect(checkUpload({ fileName: "a.pdf", sizeBytes: 0 })).toEqual({ ok: false, problem: "file_empty" });
    expect(checkUpload({ fileName: "a.pdf", sizeBytes: MAX_FILE_BYTES + 1 })).toEqual({ ok: false, problem: "file_too_large" });
    expect(checkUpload({ fileName: ".pdf", sizeBytes: 5 })).toEqual({ ok: false, problem: "file_name_invalid" });
    expect(checkUpload({ fileName: "///", sizeBytes: 5 })).toEqual({ ok: false, problem: "file_name_invalid" });
  });
});

describe("cleanFileName", () => {
  it("drops directories and characters that break downloads, and keeps Vietnamese", () => {
    expect(cleanFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName("C:\\Users\\hr\\Sổ  hộ khẩu\u0000.png")).toBe("Sổ hộ khẩu.png");
    expect(cleanFileName('a<b>:"c".pdf')).toBe("abc.pdf");
  });
});

describe("matchesSignature", () => {
  it("compares the first bytes with what the name promises", () => {
    expect(matchesSignature("a.pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
    expect(matchesSignature("a.pdf", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(matchesSignature("a.docx", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(matchesSignature("a.png", bytes(0xff, 0xd8, 0xff))).toBe(false);
  });

  it("accepts text for csv and refuses binary", () => {
    expect(matchesSignature("a.csv", new TextEncoder().encode("họ tên,mã\n"))).toBe(true);
    expect(matchesSignature("a.csv", bytes(0x4d, 0x5a, 0x00, 0x01))).toBe(false);
  });
});
