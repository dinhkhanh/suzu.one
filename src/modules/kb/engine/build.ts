// Small builders for documents written in code: the demo seed, templates, importers, tests. Pure.
import type { CalloutKind } from "./callouts";
import type { Doc, DocMark, DocNode } from "./doc";

type Inline = string | DocNode;
const inline = (parts: readonly Inline[]): DocNode[] => parts.filter((part) => part !== "").map((part) => (typeof part === "string" ? { type: "text", text: part } : part));

export const text = (value: string, ...marks: DocMark[]): DocNode => (marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });
export const bold = (value: string): DocNode => text(value, { type: "bold" });
export const italic = (value: string): DocNode => text(value, { type: "italic" });
export const link = (value: string, href: string): DocNode => text(value, { type: "link", attrs: { href } });
export const paragraph = (...parts: Inline[]): DocNode => ({ type: "paragraph", ...(parts.length ? { content: inline(parts) } : {}) });
export const heading = (level: 1 | 2 | 3, ...parts: Inline[]): DocNode => ({ type: "heading", attrs: { level }, content: inline(parts) });
const item = (entry: Inline | DocNode[]): DocNode => ({ type: "listItem", content: Array.isArray(entry) ? entry : [paragraph(entry)] });
export const bulletList = (...items: (Inline | DocNode[])[]): DocNode => ({ type: "bulletList", content: items.map(item) });
export const orderedList = (...items: (Inline | DocNode[])[]): DocNode => ({ type: "orderedList", content: items.map(item) });
export const callout = (kind: CalloutKind, ...blocks: (DocNode | string)[]): DocNode => ({ type: "callout", attrs: { kind }, content: blocks.map((block) => (typeof block === "string" ? paragraph(block) : block)) });
export const codeBlock = (code: string, language?: string): DocNode => ({ type: "codeBlock", ...(language ? { attrs: { language } } : {}), content: [text(code)] });
export const embed = (url: string): DocNode => ({ type: "embed", attrs: { url } });
export const rule = (): DocNode => ({ type: "horizontalRule" });
/** First row = headers. */
export const table = (head: readonly string[], ...rows: readonly (readonly Inline[])[]): DocNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: head.map((cell) => ({ type: "tableHeader", content: [paragraph(cell)] })) },
    ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => ({ type: "tableCell", content: [paragraph(cell)] })) })),
  ],
});
export const doc = (...blocks: DocNode[]): Doc => ({ type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] });
