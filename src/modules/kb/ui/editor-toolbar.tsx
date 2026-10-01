"use client";
// The page editor's toolbar: the shared text controls (platform/rich-text/ui/toolbar) and the
// page's own — paragraph styles, alignment, callouts, tables, embeds, pictures and uploads.
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ChevronDown,
  CircleCheck,
  Code,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  OctagonX,
  Paperclip,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  SquareCode,
  SquarePlay,
  SquareX,
  Strikethrough,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  TriangleAlert,
  Underline,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { CALLOUT_KINDS, type CalloutKind } from "@/modules/platform/rich-text/engine/callouts";
import { normalizeEmbed, safeHref } from "@/modules/platform/rich-text/engine/embed";
import { keepSelection, LinkControl, MOD, Toolbar, ToolButton, toolClass, ToolSeparator } from "@/modules/platform/rich-text/ui/toolbar";
import { cn } from "cn";

export const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = { info: Info, warning: TriangleAlert, success: CircleCheck, danger: OctagonX };
export const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
const ALIGN_LABELS = { left: "alignLeft", center: "alignCenter", right: "alignRight", justify: "alignJustify" } as const;

/** Which of the toolbar's boxes is open. The slash menu and the bubble menu open them too. */
export type Panels = { link: boolean; embed: boolean; image: boolean };
export type SetPanel = (panel: keyof Panels, open: boolean) => void;

export const insertTable = (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

export function setCallout(editor: Editor, kind: CalloutKind | null) {
  const chain = editor.chain().focus();
  if (kind === null) return void chain.lift("callout").run();
  if (editor.isActive("callout")) chain.updateAttributes("callout", { kind }).run();
  else chain.wrapIn("callout", { kind }).run();
}

/** A toolbar menu: an icon (and a label, for the paragraph style) with a caret. */
function Menu({ label, icon: Icon, text, active, disabled, children }: { label: string; icon?: LucideIcon; text?: string; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger title={label} aria-label={label} disabled={disabled} onMouseDown={keepSelection} className={cn(toolClass, "gap-0.5", active && "bg-muted text-foreground", text && "min-w-28 justify-between px-2 text-foreground")}>
        {Icon ? <Icon /> : null}
        {text ? <span className="truncate text-[0.8125rem]">{text}</span> : null}
        <ChevronDown className="size-3! opacity-60" />
      </DropdownMenuTrigger>
      {/* Focus goes back to the text by the command itself, not to this trigger. */}
      <DropdownMenuContent finalFocus={false} className="w-auto min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ icon: Icon, label, onClick, active, destructive }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; destructive?: boolean }) {
  return (
    <DropdownMenuItem onClick={onClick} variant={destructive ? "destructive" : "default"} className={cn(active && "font-medium text-foreground")}>
      <Icon />
      {label}
    </DropdownMenuItem>
  );
}

/** A box that asks for one address: the embed and the picture-from-the-web. */
function AddressBox({ icon: Icon, label, placeholder, applyLabel, refusedLabel, accept, onApply, open, onOpenChange, children }: { icon: LucideIcon; label: string; placeholder: string; applyLabel: string; refusedLabel: string; accept: (value: string) => boolean; onApply: (value: string) => void; open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }) {
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState(false);
  function apply() {
    const typed = value.trim();
    if (!typed) return;
    if (!accept(typed)) return setRefused(true);
    onApply(typed);
    onOpenChange(false);
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setValue("");
          setRefused(false);
        }
        onOpenChange(next);
      }}
    >
      <PopoverTrigger title={label} aria-label={label} onMouseDown={keepSelection} className={toolClass}>
        <Icon />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {children}
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={refused || undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        {refused ? (
          <p role="alert" className="text-xs text-destructive">
            {refusedLabel}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={apply}>
            {applyLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PageToolbar({ editor, panels, setPanel, onPickFile, uploading }: { editor: Editor; panels: Panels; setPanel: SetPanel; onPickFile: (accept: string) => void; uploading: boolean }) {
  const t = useTranslations("richText");
  const tk = useTranslations("kb.editor");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      level: ([1, 2, 3] as const).find((level) => current.isActive("heading", { level })) ?? 0,
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      highlight: current.isActive("highlight"),
      link: current.isActive("link"),
      align: (["center", "right", "justify"] as const).find((align) => current.isActive({ textAlign: align })) ?? ("left" as const),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      task: current.isActive("taskList"),
      canSink: current.can().sinkListItem("listItem") || current.can().sinkListItem("taskItem"),
      canLift: current.can().liftListItem("listItem") || current.can().liftListItem("taskItem"),
      quote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      callout: CALLOUT_KINDS.find((kind) => current.isActive("callout", { kind })) ?? null,
      table: current.isActive("table"),
      canMerge: current.can().mergeCells(),
      canSplit: current.can().splitCell(),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const listItem = state.task ? "taskItem" : "listItem";
  const styles = [
    { level: 0, label: t("paragraph") },
    { level: 1, label: t("h1") },
    { level: 2, label: t("h2") },
    { level: 3, label: t("h3") },
  ] as const;
  const AlignIcon = ALIGN_ICONS[state.align];
  const CalloutIcon = CALLOUT_ICONS[state.callout ?? "info"];

  return (
    <Toolbar label={t("toolbar")} className="sticky top-0 z-10 rounded-t-md border-b bg-background/95 px-1.5 py-1 backdrop-blur supports-backdrop-filter:bg-background/80">
      <ToolButton label={t("undo")} shortcut={`${MOD}Z`} icon={Undo2} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <ToolButton label={t("redo")} shortcut={`${MOD}⇧Z`} icon={Redo2} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      <ToolSeparator />
      <Menu label={t("textStyle")} text={styles[state.level].label}>
        {styles.map((style) => (
          <DropdownMenuItem key={style.level} onClick={() => (style.level === 0 ? chain().setParagraph().run() : chain().setHeading({ level: style.level }).run())} className={cn(state.level === style.level && "bg-accent/60")}>
            <span className={cn(style.level === 1 && "text-lg font-semibold", style.level === 2 && "text-base font-semibold", style.level === 3 && "font-semibold")}>{style.label}</span>
          </DropdownMenuItem>
        ))}
      </Menu>
      <ToolSeparator />
      <ToolButton label={t("bold")} shortcut={`${MOD}B`} icon={Bold} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton label={t("italic")} shortcut={`${MOD}I`} icon={Italic} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton label={t("underline")} shortcut={`${MOD}U`} icon={Underline} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <ToolButton label={t("strike")} shortcut={`${MOD}⇧S`} icon={Strikethrough} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <ToolButton label={t("highlight")} shortcut={`${MOD}⇧H`} icon={Highlighter} active={state.highlight} onClick={() => chain().toggleHighlight().run()} />
      <ToolButton label={t("inlineCode")} shortcut={`${MOD}E`} icon={Code} active={state.code} onClick={() => chain().toggleCode().run()} />
      <LinkControl editor={editor} active={state.link} open={panels.link} onOpenChange={(open) => setPanel("link", open)} />
      <ToolButton label={t("clearFormatting")} icon={RemoveFormatting} onClick={() => chain().unsetAllMarks().clearNodes().run()} />
      <ToolSeparator />
      <Menu label={t("align")} icon={AlignIcon}>
        {(["left", "center", "right", "justify"] as const).map((align) => (
          <Item key={align} icon={ALIGN_ICONS[align]} label={t(ALIGN_LABELS[align])} active={state.align === align} onClick={() => (align === "left" ? chain().unsetTextAlign().run() : chain().setTextAlign(align).run())} />
        ))}
      </Menu>
      <ToolButton label={t("bulletList")} shortcut={`${MOD}⇧8`} icon={List} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton label={t("orderedList")} shortcut={`${MOD}⇧7`} icon={ListOrdered} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton label={t("taskList")} shortcut={`${MOD}⇧9`} icon={ListTodo} active={state.task} onClick={() => chain().toggleTaskList().run()} />
      <ToolButton label={t("outdent")} shortcut="⇧Tab" icon={IndentDecrease} disabled={!state.canLift} onClick={() => chain().liftListItem(listItem).run()} />
      <ToolButton label={t("indent")} shortcut="Tab" icon={IndentIncrease} disabled={!state.canSink} onClick={() => chain().sinkListItem(listItem).run()} />
      <ToolSeparator />
      <ToolButton label={t("quote")} shortcut={`${MOD}⇧B`} icon={Quote} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton label={t("codeBlock")} shortcut={`${MOD}⌥C`} icon={SquareCode} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()} />
      <ToolButton label={t("rule")} icon={Minus} onClick={() => chain().setHorizontalRule().run()} />
      <Menu label={tk("calloutMenu")} icon={CalloutIcon} active={state.callout !== null}>
        {CALLOUT_KINDS.map((kind) => (
          <Item key={kind} icon={CALLOUT_ICONS[kind]} label={tk(`callout.${kind}`)} active={state.callout === kind} onClick={() => setCallout(editor, kind)} />
        ))}
        {state.callout ? (
          <>
            <DropdownMenuSeparator />
            <Item icon={SquareX} label={tk("calloutNone")} onClick={() => setCallout(editor, null)} />
          </>
        ) : null}
      </Menu>
      <ToolSeparator />
      {state.table ? (
        <Menu label={tk("tableMenu")} icon={Table} active>
          <Item icon={BetweenHorizontalStart} label={tk("addRowBefore")} onClick={() => chain().addRowBefore().run()} />
          <Item icon={BetweenHorizontalEnd} label={tk("addRow")} onClick={() => chain().addRowAfter().run()} />
          <Item icon={BetweenVerticalStart} label={tk("addColumnBefore")} onClick={() => chain().addColumnBefore().run()} />
          <Item icon={BetweenVerticalEnd} label={tk("addColumn")} onClick={() => chain().addColumnAfter().run()} />
          <DropdownMenuSeparator />
          <Item icon={Rows3} label={tk("toggleHeaderRow")} onClick={() => chain().toggleHeaderRow().run()} />
          {state.canMerge ? <Item icon={TableCellsMerge} label={tk("mergeCells")} onClick={() => chain().mergeCells().run()} /> : null}
          {state.canSplit ? <Item icon={TableCellsSplit} label={tk("splitCell")} onClick={() => chain().splitCell().run()} /> : null}
          <DropdownMenuSeparator />
          <Item icon={Trash2} label={tk("deleteRow")} destructive onClick={() => chain().deleteRow().run()} />
          <Item icon={Trash2} label={tk("deleteColumn")} destructive onClick={() => chain().deleteColumn().run()} />
          <Item icon={Trash2} label={tk("deleteTable")} destructive onClick={() => chain().deleteTable().run()} />
        </Menu>
      ) : (
        <ToolButton label={tk("table")} icon={Table} onClick={() => insertTable(editor)} />
      )}
      <AddressBox
        icon={SquarePlay}
        label={tk("embed")}
        placeholder="https://youtu.be/…"
        applyLabel={tk("embedApply")}
        refusedLabel={tk("embedRefused")}
        accept={(value) => normalizeEmbed(value) !== null}
        onApply={(url) => chain().insertContent({ type: "embed", attrs: { url, provider: normalizeEmbed(url)!.provider } }).run()}
        open={panels.embed}
        onOpenChange={(open) => setPanel("embed", open)}
      >
        <p className="text-xs text-muted-foreground">{tk("embedPrompt")}</p>
      </AddressBox>
      <AddressBox
        icon={ImagePlus}
        label={tk("imageUrl")}
        placeholder={tk("imageUrlPlaceholder")}
        applyLabel={tk("imageApply")}
        refusedLabel={tk("imageRefused")}
        accept={(value) => /^https:\/\/[^\s@]+$/i.test(value) && safeHref(value) !== null}
        onApply={(src) => chain().insertContent({ type: "image", attrs: { src } }).run()}
        open={panels.image}
        onOpenChange={(open) => setPanel("image", open)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => {
            setPanel("image", false);
            onPickFile("image/*");
          }}
        >
          <ImagePlus />
          {tk("upload")}
        </Button>
      </AddressBox>
      <ToolButton label={tk("upload")} icon={Paperclip} disabled={uploading} onClick={() => onPickFile(ACCEPT_ATTRIBUTE)} />
    </Toolbar>
  );
}

/** The hidden file picker the toolbar, the picture box and the slash menu open. */
export function useFilePicker(onFile: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null);
  const pick = (accept: string) => {
    if (!input.current) return;
    input.current.accept = accept;
    input.current.click();
  };
  const element = (
    <input
      ref={input}
      type="file"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = "";
        files.forEach(onFile);
      }}
    />
  );
  return { pick, element };
}
