"use client";
// "/" in the page editor: a list of blocks to insert, narrowed as the author types after the slash,
// chosen with the arrow keys and Enter (or a click). The extension keeps the list and the
// highlighted row, and tells the editor's element what to show; <SlashMenu> only draws it.
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toSearchKey } from "@/lib/text";

export type SlashItem = { key: string; label: string; icon: LucideIcon; keywords?: string; run: (editor: Editor) => void };

type Shown = { items: SlashItem[]; active: number; rect: DOMRect | null; choose: (item: SlashItem) => void } | null;

const SHOW = "slash-menu";

export const matchSlash = (items: readonly SlashItem[], query: string): SlashItem[] => {
  const wanted = toSearchKey(query);
  return wanted ? items.filter((item) => toSearchKey(`${item.label} ${item.key} ${item.keywords ?? ""}`).includes(wanted)) : [...items];
};

export const SlashCommands = Extension.create<{ items: (query: string) => SlashItem[] }>({
  name: "slashCommands",
  addOptions: () => ({ items: () => [] }),
  addProseMirrorPlugins() {
    const show = (shown: Shown) => this.editor.view.dom.dispatchEvent(new CustomEvent<Shown>(SHOW, { detail: shown }));
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        // Not inside code, where a slash is only a slash.
        allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
        items: ({ query }) => this.options.items(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let open: SuggestionProps<SlashItem> | null = null;
          let active = 0;
          const publish = () => show(open && { items: open.items, active, rect: open.clientRect?.() ?? null, choose: (item) => open?.command(item) });
          return {
            onStart: (props) => {
              open = props;
              active = 0;
              publish();
            },
            onUpdate: (props) => {
              open = props;
              active = Math.min(active, Math.max(props.items.length - 1, 0));
              publish();
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (!open) return false;
              if (event.key === "Escape") {
                open = null;
                publish();
                return true;
              }
              const count = open.items.length;
              if (count === 0) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                active = (active + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
                publish();
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                open.command(open.items[active]);
                return true;
              }
              return false;
            },
            onExit: () => {
              open = null;
              publish();
            },
          };
        },
      }),
    ];
  },
});

/** The menu, placed under the slash (or above it when the window has no room underneath). */
export function SlashMenu({ editor }: { editor: Editor }) {
  const t = useTranslations("kb.editor");
  const [shown, setShown] = useState<Shown>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = editor.view.dom;
    const update = (event: Event) => setShown((event as CustomEvent<Shown>).detail);
    element.addEventListener(SHOW, update);
    return () => element.removeEventListener(SHOW, update);
  }, [editor]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${shown?.active ?? 0}"]`)?.scrollIntoView({ block: "nearest" });
  }, [shown]);

  if (!shown?.rect) return null;
  const below = shown.rect.bottom + 300 < window.innerHeight;
  const style = below ? { top: shown.rect.bottom + 6, left: shown.rect.left } : { bottom: window.innerHeight - shown.rect.top + 6, left: shown.rect.left };
  return createPortal(
    <div ref={list} role="listbox" aria-label={t("insert")} style={style} className="fixed z-50 max-h-72 w-60 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
      {shown.items.length === 0 ? <p className="px-2 py-1.5 text-muted-foreground">{t("slashEmpty")}</p> : null}
      {shown.items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={index === shown.active}
          data-index={index}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => shown.choose(item)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60", index === shown.active && "bg-accent text-accent-foreground")}
        >
          <item.icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
