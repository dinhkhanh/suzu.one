// Pure rules for showing a file in the preview dialog: which viewer a file gets, and what is inside
// a .zip. Shared by every screen that opens an attachment; no I/O.

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "document" | "spreadsheet" | "csv" | "text" | "archive" | "none";

const KINDS: Record<Exclude<PreviewKind, "none">, readonly string[]> = {
  // An SVG is shown through <img>, which runs none of its script (only a brand kit stores one).
  image: ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "m4v", "mov", "webm"],
  audio: ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"],
  pdf: ["pdf"],
  document: ["docx"],
  spreadsheet: ["xlsx"],
  csv: ["csv", "tsv"],
  text: ["txt", "md", "json", "log"],
  archive: ["zip"],
};

const extensionOf = (name: string) => {
  const base = name.split(/[\\/?#]/)[0] ?? "";
  return base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
};

/**
 * The viewer for a file, by its name — and when the screen only knows a label (a leave request's
 * "Open attachment"), by the storage link, whose path always ends in the stored file's extension.
 */
export function previewKindOf(fileName: string | null | undefined, url?: string | null): PreviewKind {
  const fromName = fileName ? extensionOf(fileName) : "";
  let fromUrl = "";
  if (url) {
    try {
      fromUrl = extensionOf(new URL(url).pathname.split("/").pop() ?? "");
    } catch {
      fromUrl = "";
    }
  }
  for (const extension of [fromName, fromUrl]) {
    if (!extension) continue;
    const kind = (Object.keys(KINDS) as (keyof typeof KINDS)[]).find((key) => KINDS[key].includes(extension));
    if (kind) return kind;
  }
  return "none";
}

/** Viewers that read the bytes themselves (as opposed to handing the link to an <img> or <video>). */
export const readsBytes = (kind: PreviewKind) => kind === "pdf" || kind === "document" || kind === "spreadsheet" || kind === "csv" || kind === "text" || kind === "archive";

export type ZipEntry = { name: string; sizeBytes: number; directory: boolean };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * The entries of a .zip, read from its central directory (the index at the end of the file), so
 * nothing is inflated. Null when the bytes are not a readable zip. Zip64 archives, whose counts
 * sit in another record, are read as far as the ordinary record allows.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is 22 bytes plus a comment of at most 65 535.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) break;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > bytes.length) break;
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const directory = name.endsWith("/");
    entries.push({ name, sizeBytes: directory ? 0 : view.getUint32(at + 24, true), directory });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Bytes as people read them: "824 KB", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
