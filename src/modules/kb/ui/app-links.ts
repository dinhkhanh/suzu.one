// The links in a page that lead back into the app (a form, a request, a person): the reading
// pane's right rail lists them, so a policy page is one click from the thing it describes.
import type { Doc, DocNode } from "@/modules/platform/rich-text/engine/doc";

export type AppLink = { href: string; text: string };

const textOf = (node: DocNode): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join(""));

/** Every distinct in-app link of a document, in reading order, labelled by the text it is on. */
export function appLinksOf(doc: Doc): AppLink[] {
  const seen = new Map<string, string>();
  const walk = (node: DocNode) => {
    const href = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
    if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
      const text = textOf(node).trim();
      if (!seen.has(href)) seen.set(href, text || href);
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of doc.content) walk(node);
  return [...seen.entries()].map(([href, text]) => ({ href, text }));
}
