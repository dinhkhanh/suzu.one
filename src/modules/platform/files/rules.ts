// Pure rules for what may be uploaded (FR-PLT-32, NFR-SEC-03). Shared by server and forms.

// The caps are ours, not the storage's: an R2 upload may be up to 5 GB in one request.

/** A document or picture: a scanned contract, a high-resolution mock-up, a photographed receipt. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/**
 * A cut for review on a work task — a TVC or social video, 4K included — not a master (masters stay
 * in the production pipeline). A browser upload is one request that cannot resume, so a much larger
 * file mostly means a longer wait before a dropped connection starts it all over.
 */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
/** The largest file any owner may take. */
export const MAX_UPLOAD_BYTES = Math.max(MAX_FILE_BYTES, MAX_VIDEO_BYTES);
/**
 * A file that travels inside a request to the app instead of straight to storage — the public
 * careers forms and a referral's CV. The hosting platform takes at most 4.5 MB per request body, and
 * the form's other fields ride along with the file.
 */
export const MAX_REQUEST_FILE_BYTES = 4 * 1024 * 1024;

type FileType = {
  extensions: readonly string[];
  contentType: string;
  /** Bytes every real file of this type has, at `signatureOffset` (0 = the very start). */
  signatures: readonly (readonly number[])[];
  signatureOffset?: number;
  /**
   * A text format with no magic bytes but a fixed opening (an SVG's `<`): the head must be text
   * and, past a byte-order mark and white space, begin with this. Checked instead of `signatures`.
   */
  textOpening?: string;
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

/**
 * A person's profile picture (FR-CHR-01): shown on every screen that lists them, so pictures only.
 * The browser crops and shrinks it before upload (`PHOTO_EDGE_PX`); the cap is a guard on what is
 * stored, not on what the person may pick from their phone.
 */
export const PHOTO_OWNER_TYPE = "person_photo";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** The side of the square picture the browser uploads. */
export const PHOTO_EDGE_PX = 1024;
const PHOTO_FILE_TYPES: readonly FileType[] = ALLOWED_FILE_TYPES.filter((type) => type.contentType.startsWith("image/")).map((type) => ({ ...type, maxBytes: MAX_PHOTO_BYTES }));

/**
 * A project's poster or key visual, shown beside its name in lists and headers. Pictures only; like
 * a profile picture, the browser crops it to a square from the centre and shrinks it before upload.
 */
export const POSTER_OWNER_TYPE = "work_project_poster";
/** The side of the square poster the browser uploads. */
export const POSTER_EDGE_PX = 1024;

/**
 * A file of a brand kit (FR-BRD-02): what a designer hands a partner — the logo as a vector (SVG,
 * AI, EPS) and as pictures, the brochure, the guideline, a packed set, a brand film. Taken here and
 * nowhere else, because these are the formats the rest of the product keeps out: an SVG can carry
 * script and a PostScript file is a program. They are safe in this one place because a kit's files
 * are only reached through a signed link on the storage's own domain, stored as attachments, and
 * shown on a page through `<img>` — which runs no script — never inline on ours.
 */
export const BRAND_OWNER_TYPE = "brand_asset";
/** A packed set of every logo, or a brand film: larger than a document, smaller than a master. */
export const MAX_BRAND_FILE_BYTES = 500 * 1024 * 1024;
const POSTSCRIPT = ascii("%!PS");
// Illustrator has saved PDF-compatible files since version 9, and PostScript before; an EPS is
// PostScript, or the same behind the binary header Windows tools write.
const BRAND_FILE_TYPES: readonly FileType[] = [
  ...ALLOWED_FILE_TYPES.filter((type) => ["pdf", "jpg", "png", "webp"].includes(type.extensions[0])),
  { extensions: ["svg"], contentType: "image/svg+xml", signatures: [], textOpening: "<" },
  { extensions: ["ai"], contentType: "application/postscript", signatures: [[0x25, 0x50, 0x44, 0x46], POSTSCRIPT] },
  { extensions: ["eps"], contentType: "application/postscript", signatures: [POSTSCRIPT, [0xc5, 0xd0, 0xd3, 0xc6]] },
  { extensions: ["psd"], contentType: "image/vnd.adobe.photoshop", signatures: [ascii("8BPS")] },
  { extensions: ["zip"], contentType: "application/zip", signatures: [ZIP] },
  ...VIDEO_FILE_TYPES,
].map((type) => ({ ...type, maxBytes: MAX_BRAND_FILE_BYTES }));

const typesFor = (ownerType?: string): readonly FileType[] =>
  ownerType === PHOTO_OWNER_TYPE || ownerType === POSTER_OWNER_TYPE
    ? PHOTO_FILE_TYPES
    : ownerType === BRAND_OWNER_TYPE
      ? BRAND_FILE_TYPES
      : ownerType && VIDEO_OWNER_TYPES.includes(ownerType)
        ? [...ALLOWED_FILE_TYPES, ...VIDEO_FILE_TYPES]
        : ALLOWED_FILE_TYPES;

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
  if (type.textOpening !== undefined) {
    const text = head.slice(0, 512);
    if (text.includes(0)) return false;
    return new TextDecoder("utf-8").decode(text).replace(/^﻿/, "").trimStart().startsWith(type.textOpening);
  }
  if (type.signatures.length === 0) return !head.slice(0, 512).includes(0);
  const offset = type.signatureOffset ?? 0;
  return type.signatures.some((signature) => signature.every((byte, index) => head[offset + index] === byte));
}
