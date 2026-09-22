// Pure rules for what may be uploaded (FR-PLT-32, NFR-SEC-03). Shared by server and forms.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Video is far bigger than a document: a cut for review runs to a couple of hundred megabytes. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** The largest file any owner may take: the storage bucket's own limit. */
export const MAX_UPLOAD_BYTES = Math.max(MAX_FILE_BYTES, MAX_VIDEO_BYTES);

type FileType = {
  extensions: readonly string[];
  contentType: string;
  /** Bytes every real file of this type has, at `signatureOffset` (0 = the very start). */
  signatures: readonly (readonly number[])[];
  signatureOffset?: number;
  maxBytes?: number;
};

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

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

// Video (FR-PJM-52: pins on a moment of a cut). Both are ISO media files: a box size, then the box
// type at byte 4 — "ftyp" for every MP4 and for QuickTime since 2001; older QuickTime files open
// straight on a movie, data or padding box.
export const VIDEO_FILE_TYPES: readonly FileType[] = [
  { extensions: ["mp4", "m4v"], contentType: "video/mp4", signatures: [ascii("ftyp")], signatureOffset: 4, maxBytes: MAX_VIDEO_BYTES },
  { extensions: ["mov"], contentType: "video/quicktime", signatures: [ascii("ftyp"), ascii("moov"), ascii("mdat"), ascii("wide"), ascii("free"), ascii("skip")], signatureOffset: 4, maxBytes: MAX_VIDEO_BYTES },
];

/**
 * The owners whose files may be video: a work task, where deliverables are handed in and reviewed.
 * Nowhere else — an HR record, a CV or a knowledge-base page has no business holding a film.
 */
export const VIDEO_OWNER_TYPES: readonly string[] = ["work_task"];

const typesFor = (ownerType?: string): readonly FileType[] => (ownerType && VIDEO_OWNER_TYPES.includes(ownerType) ? [...ALLOWED_FILE_TYPES, ...VIDEO_FILE_TYPES] : ALLOWED_FILE_TYPES);

/** The `accept` attribute of a file input for this owner's files. */
export const acceptAttributeFor = (ownerType?: string): string => typesFor(ownerType).flatMap((type) => type.extensions.map((extension) => `.${extension}`)).join(",");

export const ACCEPT_ATTRIBUTE = acceptAttributeFor();

export type UploadProblem = "file_empty" | "file_too_large" | "file_type_not_allowed" | "file_name_invalid";

/** Keeps the name readable (Vietnamese included) but drops paths and control characters. */
export function cleanFileName(name: string): string {
  const base = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
}

function typeOf(fileName: string, ownerType?: string): FileType | undefined {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return typesFor(ownerType).find((type) => type.extensions.includes(extension));
}

/** The most a file of this name may weigh for this owner; a type the owner does not take has the ordinary cap. */
export const maxBytesFor = (fileName: string, ownerType?: string): number => typeOf(fileName, ownerType)?.maxBytes ?? MAX_FILE_BYTES;

/**
 * The type is decided by the extension; the browser's claimed content type is never trusted. The
 * owner type decides which types are taken at all (video only where `VIDEO_OWNER_TYPES` says).
 */
export function checkUpload(file: { fileName: string; sizeBytes: number }, ownerType?: string): { ok: true; fileName: string; contentType: string } | { ok: false; problem: UploadProblem } {
  const fileName = cleanFileName(file.fileName);
  if (!fileName || fileName.startsWith(".")) return { ok: false, problem: "file_name_invalid" };
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) return { ok: false, problem: "file_empty" };
  const type = typeOf(fileName, ownerType);
  if (file.sizeBytes > (type?.maxBytes ?? MAX_FILE_BYTES)) return { ok: false, problem: "file_too_large" };
  if (!type) return { ok: false, problem: "file_type_not_allowed" };
  return { ok: true, fileName, contentType: type.contentType };
}

/** Do the first bytes look like the type the name promises? A renamed .exe fails here. */
export function matchesSignature(fileName: string, head: Uint8Array, ownerType?: string): boolean {
  const type = typeOf(fileName, ownerType);
  if (!type) return false;
  if (type.signatures.length === 0) return !head.slice(0, 512).includes(0);
  const offset = type.signatureOffset ?? 0;
  return type.signatures.some((signature) => signature.every((byte, index) => head[offset + index] === byte));
}
