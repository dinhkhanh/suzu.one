// Which addresses a page may link to or embed (FR-KB-02). Pure. Nothing a reader's browser opens
// or frames comes from anywhere but these rules: links are http(s), mailto or an in-app path;
// frames are one of a handful of known services, rewritten to that service's own embed address.

export const EMBED_PROVIDERS = ["youtube", "google_drive", "google_docs", "figma", "canva"] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

/** The address as it may be put into an `href`, or null. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 2000 || /[\u0000-\u001f\u007f]/.test(href)) return null;
  // In-app path: "/kb/pages/…". "//host" and "/\host" are other sites in disguise.
  if (href.startsWith("/")) return /^\/(?![/\\])/.test(href) ? href : null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? href : null;
}

export const isInternalHref = (href: string): boolean => href.startsWith("/");

const ID = /^[A-Za-z0-9_-]{6,120}$/;

/** What to frame for a pasted address: the provider and its embed URL, or null when it is not one we frame. */
export function normalizeEmbed(value: unknown): { provider: EmbedProvider; src: string } | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v") : parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" ? parts[1] : null;
    return id && ID.test(id) ? { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === "drive.google.com") {
    const id = parts[0] === "file" && parts[1] === "d" ? parts[2] : null;
    return id && ID.test(id) ? { provider: "google_drive", src: `https://drive.google.com/file/d/${id}/preview` } : null;
  }
  if (host === "docs.google.com") {
    const kind = parts[0];
    const id = parts[1] === "d" ? parts[2] : null;
    if (!id || !ID.test(id) || (kind !== "document" && kind !== "spreadsheets" && kind !== "presentation")) return null;
    return { provider: "google_docs", src: `https://docs.google.com/${kind}/d/${id}/preview` };
  }
  if (host === "figma.com") {
    if (!["file", "design", "proto", "board", "slides"].includes(parts[0] ?? "") || !parts[1] || !ID.test(parts[1])) return null;
    const clean = `https://www.figma.com/${parts.slice(0, 3).map(encodeURIComponent).join("/")}${url.searchParams.get("node-id") ? `?node-id=${encodeURIComponent(url.searchParams.get("node-id")!)}` : ""}`;
    return { provider: "figma", src: `https://www.figma.com/embed?embed_host=suzu-one&url=${encodeURIComponent(clean)}` };
  }
  if (host === "canva.com") {
    if (parts[0] !== "design" || !parts[1] || !ID.test(parts[1]) || !parts[2] || !ID.test(parts[2])) return null;
    return { provider: "canva", src: `https://www.canva.com/design/${parts[1]}/${parts[2]}/view?embed` };
  }
  return null;
}
