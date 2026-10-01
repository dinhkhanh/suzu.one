// The editor's schema, shared by the knowledge-base page editor and the note editor. Every node and
// mark here is one the validator (engine/doc.ts) stores and the reading view (render-doc.tsx)
// renders; editor-schema.test.ts holds the three to the same list.
import { mergeAttributes, Node, type AnyExtension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
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

/**
 * A task's box belongs to no form. The editor usually sits inside one, and a form's reset would
 * otherwise untick every box while the document still says ticked.
 */
const FormlessTaskItem = TaskItem.extend({
  addNodeView() {
    const render = this.parent?.();
    if (!render) return null;
    return (props) => {
      const view = render(props);
      if (view.dom instanceof HTMLElement) view.dom.querySelector("input")?.setAttribute("form", "");
      return view;
    };
  },
});

const LINK = { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"] };

/**
 * The text blocks and marks both editors know. A note reads the same documents a page does (minus
 * uploads and embeds), so a note pasted from a page, or written in Markdown, loses nothing it can
 * show.
 */
export function textExtensions({ placeholder }: { placeholder?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: LINK }),
    TaskList,
    FormlessTaskItem.configure({ nested: true }),
    Highlight,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit.configure({ table: { resizable: false } }),
    Callout,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}
