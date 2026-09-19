// Markdown → the page document (FR-KB-10). Pure: `marked` only tokenises; nothing is ever turned
// into HTML. This is also the Google Docs path (File → Download → Markdown) and what the demo
// seed and the page templates are written in.
//
// What has no place in the document is degraded, never smuggled in: headings deeper than 3 become
// level 3, a link the allow-list refuses becomes its text, raw HTML becomes literal text, an image
// that is not plain https becomes its alt text. A quote that starts with [!NOTE], [!TIP],
// [!IMPORTANT], [!WARNING] or [!CAUTION] becomes a callout.
import { marked, type Token, type Tokens } from "marked";
import type { CalloutKind } from "./callouts";
import { type Doc, type DocMark, type DocNode, validateDoc } from "./doc";
import { normalizeEmbed, safeHref } from "./embed";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (value: string): string => value.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);

const CALLOUTS: Record<string, CalloutKind> = { NOTE: "info", INFO: "info", TIP: "success", SUCCESS: "success", IMPORTANT: "warning", WARNING: "warning", CAUTION: "danger", DANGER: "danger" };
const HTTPS_IMAGE = /^https:\/\/[^\s@]+$/i;

const textNode = (value: string, marks: readonly DocMark[]): DocNode[] => (value === "" ? [] : [{ type: "text", text: value, ...(marks.length ? { marks: [...marks] } : {}) }]);
const withMark = (marks: readonly DocMark[], mark: DocMark): DocMark[] => (marks.some((existing) => existing.type === mark.type) ? [...marks] : [...marks, mark]);

function inlines(tokens: readonly Token[] | undefined, marks: readonly DocMark[] = []): DocNode[] {
  const out: DocNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const nested = (token as Tokens.Text).tokens;
        if (nested?.length) out.push(...inlines(nested, marks));
        else out.push(...textNode(decode((token as Tokens.Text).text), marks));
        break;
      }
      case "escape":
        out.push(...textNode(decode((token as Tokens.Escape).text), marks));
        break;
      case "strong":
        out.push(...inlines((token as Tokens.Strong).tokens, withMark(marks, { type: "bold" })));
        break;
      case "em":
        out.push(...inlines((token as Tokens.Em).tokens, withMark(marks, { type: "italic" })));
        break;
      case "del":
        out.push(...inlines((token as Tokens.Del).tokens, withMark(marks, { type: "strike" })));
        break;
      case "codespan":
        // Inline code carries no other mark in the editor's schema.
        out.push(...textNode(decode((token as Tokens.Codespan).text), [{ type: "code" }]));
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        out.push(...inlines(link.tokens, href ? withMark(marks, { type: "link", attrs: { href } }) : marks));
        break;
      }
      case "image": {
        // Images are blocks in the document: inside a line of text one becomes a link to the picture.
        const image = token as Tokens.Image;
        const href = HTTPS_IMAGE.test(image.href) ? safeHref(image.href) : null;
        out.push(...textNode(image.text || image.href, href ? withMark(marks, { type: "link", attrs: { href } }) : marks));
        break;
      }
      case "html": {
        const raw = (token as Tokens.HTML).text;
        if (/^<br\s*\/?>$/i.test(raw.trim())) out.push({ type: "hardBreak" });
        else out.push(...textNode(raw, marks));
        break;
      }
      default:
        if ("text" in token && typeof token.text === "string") out.push(...textNode(decode(token.text), marks));
    }
  }
  // Adjacent text with the same marks is one node, as the editor would have it.
  const merged: DocNode[] = [];
  for (const node of out) {
    const last = merged.at(-1);
    if (last && last.type === "text" && node.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) last.text = `${last.text}${node.text}`;
    else merged.push(node);
  }
  return merged;
}

const paragraphOf = (content: DocNode[]): DocNode => ({ type: "paragraph", ...(content.length ? { content } : {}) });

/** A paragraph that is nothing but one https picture is an image block; one that is a lone embeddable URL is an embed. */
function paragraphBlocks(token: Tokens.Paragraph | Tokens.Text): DocNode[] {
  const tokens = (token.tokens ?? []).filter((child) => !(child.type === "text" && (child as Tokens.Text).text.trim() === ""));
  if (tokens.length === 1 && tokens[0].type === "image") {
    const image = tokens[0] as Tokens.Image;
    if (HTTPS_IMAGE.test(image.href) && safeHref(image.href)) return [{ type: "image", attrs: { src: image.href, ...(image.text ? { alt: image.text.slice(0, 300) } : {}) } }];
  }
  if (tokens.length === 1 && tokens[0].type === "link") {
    const link = tokens[0] as Tokens.Link;
    if (link.text === link.href && normalizeEmbed(link.href)) return [{ type: "embed", attrs: { url: link.href } }];
  }
  const content = inlines(token.tokens ?? [{ type: "text", raw: token.text, text: token.text } as Tokens.Text]);
  return content.length ? [paragraphOf(content)] : [];
}

function listItem(item: Tokens.ListItem): DocNode {
  const content = blocks(item.tokens);
  // A list item starts with a paragraph in the editor's schema.
  if (content.length === 0 || (content[0].type !== "paragraph" && content[0].type !== "heading")) content.unshift(paragraphOf([]));
  // The document has no task lists: a ticked or empty box says the same in text.
  if (item.task) {
    const box = item.checked ? "☑ " : "☐ ";
    const [lead, ...rest] = content[0].content ?? [];
    content[0] = { ...content[0], content: lead?.type === "text" && !lead.marks ? [{ ...lead, text: `${box}${lead.text}` }, ...rest] : [...textNode(box, []), ...(content[0].content ?? [])] };
  }
  return { type: "listItem", content };
}

function tableOf(token: Tokens.Table): DocNode {
  const width = token.header.length;
  const row = (cells: readonly Tokens.TableCell[], type: "tableHeader" | "tableCell"): DocNode => ({
    type: "tableRow",
    content: Array.from({ length: width }, (_, index) => ({ type, content: [paragraphOf(inlines(cells[index]?.tokens))] })),
  });
  return { type: "table", content: [row(token.header, "tableHeader"), ...token.rows.map((cells) => row(cells, "tableCell"))] };
}

function quoteOf(token: Tokens.Blockquote): DocNode[] {
  const inner = blocks(token.tokens);
  const first = inner[0];
  const lead = first?.type === "paragraph" && first.content?.[0]?.type === "text" ? (first.content[0].text ?? "") : "";
  const marker = /^\[!([A-Za-z]+)\]\s*/.exec(lead);
  const kind = marker ? CALLOUTS[marker[1].toUpperCase()] : undefined;
  if (!kind) return inner.length ? [{ type: "blockquote", content: inner }] : [];
  // Drop the marker, and the line break that follows it.
  const rest = [...(first.content ?? [])];
  rest[0] = { ...rest[0], text: lead.slice(marker![0].length).replace(/^\n/, "") };
  if (rest[0].text === "") rest.shift();
  if (rest[0]?.type === "hardBreak") rest.shift();
  const content = [...(rest.length ? [paragraphOf(rest)] : []), ...inner.slice(1)];
  return [{ type: "callout", attrs: { kind }, content: content.length ? content : [paragraphOf([])] }];
}

function blocks(tokens: readonly Token[] | undefined): DocNode[] {
  const out: DocNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "space":
      case "def":
      case "checkbox":
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        const content = inlines(heading.tokens).filter((node) => node.type !== "hardBreak");
        if (content.length) out.push({ type: "heading", attrs: { level: Math.min(heading.depth, 3) }, content });
        break;
      }
      case "paragraph":
      case "text":
        out.push(...paragraphBlocks(token as Tokens.Paragraph));
        break;
      case "list": {
        const list = token as Tokens.List;
        if (list.items.length === 0) break;
        const start = typeof list.start === "number" && list.start !== 1 ? { attrs: { start: list.start } } : {};
        out.push({ type: list.ordered ? "orderedList" : "bulletList", ...(list.ordered ? start : {}), content: list.items.map(listItem) });
        break;
      }
      case "table":
        out.push(tableOf(token as Tokens.Table));
        break;
      case "code": {
        const code = token as Tokens.Code;
        const language = /^[A-Za-z0-9_+#.-]{1,30}$/.test(code.lang ?? "") ? { attrs: { language: code.lang } } : {};
        out.push({ type: "codeBlock", ...language, ...(code.text ? { content: [{ type: "text", text: code.text }] } : {}) });
        break;
      }
      case "blockquote":
        out.push(...quoteOf(token as Tokens.Blockquote));
        break;
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "html": {
        // Raw HTML is shown as the text it is. Comments (Google Docs leaves some) are dropped.
        const raw = (token as Tokens.HTML).text.replace(/<!--[\s\S]*?-->/g, "").trim();
        if (raw) out.push(paragraphOf(textNode(raw, [])));
        break;
      }
      default:
        if ("text" in token && typeof token.text === "string" && token.text.trim()) out.push(paragraphOf(textNode(decode(token.text), [])));
    }
  }
  return out;
}

export type MarkdownImport = { title: string | null; doc: Doc };

/**
 * The document for a Markdown text. `title` is the first level-1 heading when the text opens with
 * one — it is then left out of the body, the page title shows it. Always returns a document the
 * validator accepts; throws only if the result is too large.
 */
export function markdownToDoc(markdown: string, options: { liftTitle?: boolean } = {}): MarkdownImport {
  const source = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const tokens = marked.lexer(source, { gfm: true, breaks: false });
  let title: string | null = null;
  const first = tokens.find((token) => token.type !== "space");
  if (options.liftTitle !== false && first?.type === "heading" && (first as Tokens.Heading).depth === 1) {
    title = inlines((first as Tokens.Heading).tokens).map((node) => node.text ?? "").join("").replace(/\s+/g, " ").trim().slice(0, 200) || null;
    if (title) tokens.splice(tokens.indexOf(first), 1);
  }
  const content = blocks(tokens);
  const result = validateDoc({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] });
  if (!result.ok) throw new Error(`markdown import produced an invalid document: ${result.problem} at ${result.path}`);
  return { title, doc: result.doc };
}
