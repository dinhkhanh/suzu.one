// The editor's own blocks. Each stores exactly the attributes the server-side validator
// (engine/doc.ts) accepts; what they look like to a reader is render-doc.tsx's business.
import { mergeAttributes, Node } from "@tiptap/core";
import { CALLOUT_KINDS } from "../engine/callouts";

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "info", parseHTML: (element) => ((CALLOUT_KINDS as readonly string[]).includes(element.getAttribute("data-callout") ?? "") ? element.getAttribute("data-callout") : "info"), renderHTML: (attributes) => ({ "data-callout": attributes.kind }) } };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, provider: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-kb-embed]", getAttrs: (element) => ({ url: element.getAttribute("data-kb-embed") }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-kb-block": "embed", "data-kb-embed": node.attrs.url }, `▶ ${node.attrs.url ?? ""}`];
  },
});

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { fileId: { default: null }, fileName: { default: null }, sizeBytes: { default: null } };
  },
  // Never parsed from pasted HTML: an attachment exists only through an upload.
  renderHTML({ node }) {
    return ["div", { "data-kb-block": "attachment" }, `📎 ${node.attrs.fileName ?? ""}`];
  },
});

export const KbImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { fileId: { default: null }, src: { default: null }, alt: { default: null } };
  },
  parseHTML() {
    // A pasted picture keeps its address only when it is https; anything else is dropped by the rule returning false.
    return [{ tag: "img[src]", getAttrs: (element) => (/^https:\/\//i.test(element.getAttribute("src") ?? "") ? { src: element.getAttribute("src"), alt: element.getAttribute("alt") } : false) }];
  },
  renderHTML({ node }) {
    return ["img", { src: node.attrs.fileId ? `/api/kb/files/${node.attrs.fileId}` : node.attrs.src, alt: node.attrs.alt ?? "", referrerpolicy: "no-referrer" }];
  },
});
