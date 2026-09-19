// Pure rules for what may be uploaded (FR-PLT-32, NFR-SEC-03). Shared by server and forms.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

type FileType = { extensions: readonly string[]; contentType: string; /** Leading bytes every real file of this type has. */ signatures: readonly (readonly number[])[] };

const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;

// Documents HR actually handles. No executables, scripts, HTML or SVG: nothing a browser would run.
export const ALLOWED_FILE_TYPES: readonly FileType[] = [
  { extensions: ["pdf"], contentType: "application/pdf", signatures: [[0x25, 0x50, 0x44, 0x46]] },
  { extensions: ["jpg", "jpeg"], contentType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  { extensions: ["png"], contentType: "image/png", signatures: [[0x89, 0x50, 0x4e, 0x47]] },
  { extensions: ["webp"], contentType: "image/webp", signatures: [[0x52, 0x49, 0x46, 0x46]] },
  { extensions: ["docx"], contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signatures: [ZIP] },
  { extensions: ["xlsx"], contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signatures: [ZIP] },
  { extensions: ["csv"], contentType: "text/csv", signatures: [] },
];

export const ACCEPT_ATTRIBUTE = ALLOWED_FILE_TYPES.flatMap((type) => type.extensions.map((extension) => `.${extension}`)).join(",");

export type UploadProblem = "file_empty" | "file_too_large" | "file_type_not_allowed" | "file_name_invalid";

/** Keeps the name readable (Vietnamese included) but drops paths and control characters. */
export function cleanFileName(name: string): string {
  const base = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
}

function typeOf(fileName: string): FileType | undefined {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return ALLOWED_FILE_TYPES.find((type) => type.extensions.includes(extension));
}

/** The type is decided by the extension; the browser's claimed content type is never trusted. */
export function checkUpload(file: { fileName: string; sizeBytes: number }): { ok: true; fileName: string; contentType: string } | { ok: false; problem: UploadProblem } {
  const fileName = cleanFileName(file.fileName);
  if (!fileName || fileName.startsWith(".")) return { ok: false, problem: "file_name_invalid" };
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) return { ok: false, problem: "file_empty" };
  if (file.sizeBytes > MAX_FILE_BYTES) return { ok: false, problem: "file_too_large" };
  const type = typeOf(fileName);
  if (!type) return { ok: false, problem: "file_type_not_allowed" };
  return { ok: true, fileName, contentType: type.contentType };
}

/** Do the first bytes look like the type the name promises? A renamed .exe fails here. */
export function matchesSignature(fileName: string, head: Uint8Array): boolean {
  const type = typeOf(fileName);
  if (!type) return false;
  if (type.signatures.length === 0) return !head.slice(0, 512).includes(0);
  return type.signatures.some((signature) => signature.every((byte, index) => head[index] === byte));
}
