"use client";
// The pieces both editors' toolbars are built from. A toolbar control never takes focus on
// pointer-down, so the selection stays in the document while the author clicks around it.
import type { Editor } from "@tiptap/react";
import { cn } from "cn";
import { ExternalLink, Link2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { toggleVariants } from "@/components/ui/toggle";
import { safeHref } from "../engine/embed";

export const keepSelection = (event: MouseEvent) => event.preventDefault();

/** The control classes: a 28px square that reads as pressed while its format is on. */
export const toolClass = cn(toggleVariants({ size: "sm" }), "h-7 min-w-7 px-1.5 text-muted-foreground aria-pressed:text-foreground aria-expanded:bg-muted");

const titleOf = (label: string, shortcut?: string) => (shortcut ? `${label} (${shortcut})` : label);

/** A toolbar button. `active` makes it a toggle that shows whether its format is on. */
export function ToolButton({ label, shortcut, icon: Icon, active, disabled, onClick }: { label: string; shortcut?: string; icon: LucideIcon; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={titleOf(label, shortcut)} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={keepSelection} onClick={onClick} className={toolClass}>
      <Icon />
    </button>
  );
}

export function ToolSeparator() {
  return <Separator orientation="vertical" className="mx-0.5 h-5 self-center" />;
}

export function Toolbar({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={label} className={cn("flex flex-wrap items-center gap-0.5", className)}>
      {children}
    </div>
  );
}

/** Mod-K, shown the way this platform writes it. */
export const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl+";

/**
 * Adds, changes or removes the link on the selection. Opens from its button or from Mod-K (the
 * editor calls `onOpenChange(true)`). An address the reading view would refuse is refused here
 * first, with the reason.
 */
export function LinkControl({ editor, active, open, onOpenChange }: { editor: Editor; active: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("richText");
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState(false);
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";

  function changeOpen(next: boolean) {
    if (next) {
      setValue(current);
      setRefused(false);
    }
    onOpenChange(next);
  }

  function apply() {
    const typed = value.trim();
    if (typed === "") return remove();
    const href = safeHref(typed) ?? (/^[\w-]+(\.[\w-]+)+/.test(typed) ? safeHref(`https://${typed}`) : null);
    if (!href) return setRefused(true);
    const chain = editor.chain().focus().extendMarkRange("link");
    // With nothing selected and no link to extend, the address is written in as its own text.
    if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: typed, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onOpenChange(false);
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger title={titleOf(t("link"), `${MOD}K`)} aria-label={t("link")} aria-pressed={active} onMouseDown={keepSelection} className={toolClass}>
        <Link2 />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Input
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
          onKeyDown={(event) => {
            // Not a <form>: the editor usually sits inside one, and a portal still bubbles to it.
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          placeholder={t("linkPlaceholder")}
          aria-label={t("link")}
          aria-invalid={refused || undefined}
        />
        {refused ? (
          <p role="alert" className="text-xs text-destructive">
            {t("linkRefused")}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {current ? (
            <>
              <a href={safeHref(current) ?? undefined} target="_blank" rel="noopener noreferrer" title={t("linkOpen")} aria-label={t("linkOpen")} className="mr-auto inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
                <ExternalLink className="size-4" />
              </a>
              <Button type="button" variant="ghost" size="sm" onClick={remove}>
                {t("linkRemove")}
              </Button>
            </>
          ) : null}
          <Button type="button" size="sm" onClick={apply}>
            {t("linkApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
