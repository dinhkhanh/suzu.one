"use client";
// The note editor: the small formatting editor that stands where a plain <textarea> stood — a task's
// description, a comment, a meeting's minutes. It is a form control like the textarea was: give it
// a `name` and the form posts the note (Markdown, engine/note.ts) under it; give it `value` and
// `onChange` to hold it yourself. `required` and `maxLength` hold as they did, and the form's reset
// empties it. What is being written is kept as a draft on this device (drafts.ts) until the form is
// sent, and offered back when the form opens again.
import { Extension } from "@tiptap/core";
import { EditorContent, type Editor, useEditor, useEditorState } from "@tiptap/react";
import { cn } from "cn";
import { Bold, Code, Italic, List, ListOrdered, ListTodo, Quote, RemoveFormatting, SquareCode, Strikethrough } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { type FocusEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { docToNote, noteToDoc } from "../engine/note";
import type { Doc } from "../engine/doc";
import { useDraftOwner } from "./draft-owner";
import { DRAFT_SAVED_EVENT, draftKey, readDraft, removeDraft, writeDraft } from "./drafts";
import { clearSelectionFormatting, textExtensions } from "./extensions";
import { LinkControl, MOD, Toolbar, ToolButton, ToolSeparator } from "./toolbar";

type NoteEditorProps = {
  id?: string;
  name?: string;
  /** The id of the form the note belongs to, when the editor is not inside it. */
  form?: string;
  defaultValue?: string | null;
  value?: string;
  onChange?: (note: string) => void;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  /** The height it opens at, in lines; it grows with what is written. */
  rows?: number;
  autoFocus?: boolean;
  /**
   * Where the draft is kept. By default one per page and field (`id`, else `name`); a string keeps
   * one wherever the form opens (the feedback dialog on every page); `false` keeps none.
   */
  draft?: string | false;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
};

function NoteToolbar({ editor, linkOpen, setLinkOpen }: { editor: Editor; linkOpen: boolean; setLinkOpen: (open: boolean) => void }) {
  const t = useTranslations("richText");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      task: current.isActive("taskList"),
      quote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <Toolbar label={t("toolbar")} className="border-b px-1 py-0.5">
      <ToolButton label={t("bold")} shortcut={`${MOD}B`} icon={Bold} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton label={t("italic")} shortcut={`${MOD}I`} icon={Italic} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton label={t("strike")} icon={Strikethrough} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <ToolButton label={t("inlineCode")} icon={Code} active={state.code} onClick={() => chain().toggleCode().run()} />
      <LinkControl editor={editor} active={state.link} open={linkOpen} onOpenChange={setLinkOpen} />
      <ToolSeparator />
      <ToolButton label={t("bulletList")} icon={List} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton label={t("orderedList")} icon={ListOrdered} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton label={t("taskList")} icon={ListTodo} active={state.task} onClick={() => chain().toggleTaskList().run()} />
      <ToolSeparator />
      <ToolButton label={t("quote")} icon={Quote} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton label={t("codeBlock")} icon={SquareCode} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()} />
      <ToolSeparator />
      <ToolButton label={t("clearFormatting")} shortcut={`${MOD}\\`} icon={RemoveFormatting} onClick={() => clearSelectionFormatting(editor)} />
    </Toolbar>
  );
}

/**
 * Mod-K opens the link box; Mod-Enter sends the form, as it does in a chat box. The extension is
 * made once with the editor, so it says so on the editor's element and the component answers.
 */
const NoteKeys = Extension.create({
  name: "noteKeys",
  addKeyboardShortcuts() {
    const say = (name: string) => () => {
      this.editor.view.dom.dispatchEvent(new CustomEvent(name));
      return true;
    };
    return { "Mod-k": say("note-link"), "Mod-Enter": say("note-submit") };
  },
});

export function NoteEditor({ id, name, form, defaultValue, value, onChange, placeholder, maxLength, required, disabled, rows = 3, autoFocus, draft, className, "aria-label": ariaLabel, "aria-invalid": ariaInvalid }: NoteEditorProps) {
  const t = useTranslations("richText");
  const format = useFormatter();
  const controlled = value !== undefined;
  const [note, setNote] = useState(() => (controlled ? value : (defaultValue ?? "")));
  const [problem, setProblem] = useState<"required" | "tooLong" | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const proxy = useRef<HTMLTextAreaElement>(null);
  // The editor keeps the callbacks it was made with: it reaches the caller's latest through this.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);
  // The note this editor last wrote, so a `value` coming back unchanged is not loaded again.
  const written = useRef(note);
  const initial = useMemo<Doc>(() => noteToDoc(note), []); // eslint-disable-line react-hooks/exhaustive-deps -- the first content only

  const owner = useDraftOwner();
  const pathname = usePathname();
  const scope = draft === false ? null : (draft ?? (id || name ? `${pathname}#${id || name}` : null));
  const storeKey = owner && scope ? draftKey(owner, scope) : null;
  // The note as it stands when nothing is being drafted: what the field opened with, or what was
  // last sent or set from outside. A note equal to it is no draft.
  const base = useRef(note);
  // Drafts are written only once the stored one has been offered back, never over it.
  const offered = useRef(false);
  const [restored, setRestored] = useState<{ at: number; now: number } | null>(null);

  const editor = useEditor({
    // Rendered in the browser only: the server has no DOM for ProseMirror.
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    extensions: [...textExtensions({ placeholder: placeholder ?? t("placeholder") }), NoteKeys],
    content: initial,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        style: `min-height: ${rows * 1.7 + 1}em`,
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = docToNote(current.getJSON() as Doc);
      if (next === written.current) return;
      written.current = next;
      setNote(next);
      setProblem(null);
      changed.current?.(next);
    },
  });

  useEffect(() => editor?.setEditable(!disabled), [editor, disabled]);

  // The draft left here last time, offered back once the editor is up.
  useEffect(() => {
    if (!editor || offered.current) return;
    offered.current = true;
    if (!storeKey || disabled) return;
    const kept = readDraft(storeKey);
    if (!kept) return;
    if (kept.text === written.current) return removeDraft(storeKey);
    load(kept.text);
    setRestored({ at: kept.at, now: Date.now() });
  }, [editor, storeKey]); // eslint-disable-line react-hooks/exhaustive-deps -- `load` is this render's; the draft is offered once

  // Every change is kept until the form is sent; a note back to where it started keeps nothing.
  useEffect(() => {
    if (!storeKey || !offered.current) return;
    if (note === base.current) removeDraft(storeKey);
    else writeDraft(storeKey, note);
  }, [note, storeKey]);

  // Sent (useActionForm says so, or the form's own code) or reset: what is shown is no draft now.
  useEffect(() => {
    const sent = proxy.current?.form;
    if (!sent || !storeKey) return;
    const settle = () => {
      base.current = written.current;
      removeDraft(storeKey);
      setRestored(null);
    };
    sent.addEventListener(DRAFT_SAVED_EVENT, settle);
    return () => sent.removeEventListener(DRAFT_SAVED_EVENT, settle);
  }, [storeKey, editor]);

  useEffect(() => {
    if (!editor) return;
    const element = editor.view.dom;
    const openLink = () => setLinkOpen(true);
    const submit = () => proxy.current?.form?.requestSubmit();
    element.addEventListener("note-link", openLink);
    element.addEventListener("note-submit", submit);
    return () => {
      element.removeEventListener("note-link", openLink);
      element.removeEventListener("note-submit", submit);
    };
  }, [editor]);

  // Name the text box after the field's <Label>, when the caller gave it no name of its own.
  useEffect(() => {
    if (!editor || ariaLabel || !id) return;
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim();
    if (label) editor.view.dom.setAttribute("aria-label", label);
  }, [editor, ariaLabel, id]);

  // A note set from outside — the caller cleared it, or loaded another — replaces what is shown.
  useEffect(() => {
    if (!controlled || !editor || value === written.current) return;
    written.current = value;
    base.current = value;
    setRestored(null);
    setNote(value);
    editor.commands.setContent(noteToDoc(value), { emitUpdate: false });
  }, [controlled, editor, value]);

  // The form's reset puts the note back to how it opened.
  useEffect(() => {
    const owner = proxy.current?.form;
    if (!owner || controlled || !editor) return;
    const reset = () => {
      const original = defaultValue ?? "";
      written.current = original;
      base.current = original;
      setNote(original);
      setProblem(null);
      setRestored(null);
      editor.commands.setContent(noteToDoc(original), { emitUpdate: false });
    };
    owner.addEventListener("reset", reset);
    return () => owner.removeEventListener("reset", reset);
  }, [controlled, editor, defaultValue]);

  function load(next: string) {
    if (!editor || next === written.current) return;
    written.current = next;
    setNote(next);
    setProblem(null);
    editor.commands.setContent(noteToDoc(next), { emitUpdate: false });
    changed.current?.(next);
  }

  function discard() {
    setRestored(null);
    load(base.current);
  }

  const tooLong = maxLength !== undefined && note.length > maxLength;
  useEffect(() => proxy.current?.setCustomValidity(tooLong ? t("tooLong", { max: maxLength! }) : ""), [tooLong, maxLength, t]);

  const shown = problem ?? (tooLong ? "tooLong" : null);
  const nearLimit = maxLength !== undefined && note.length > maxLength * 0.8;

  return (
    <div
      data-slot="note-editor"
      aria-invalid={ariaInvalid || shown !== null || undefined}
      className={cn(
        "rich-editor note-editor flex w-full min-w-0 flex-col rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
        disabled && "cursor-not-allowed bg-input/50 opacity-70 dark:bg-input/80",
        className,
      )}
    >
      {/* What the form posts, and what the browser checks `required` and the length against. First,
          so a <label> wrapped around the editor names this — and focuses the text — rather than
          clicking the first toolbar button. */}
      <textarea
        ref={proxy}
        id={id}
        name={name}
        form={form}
        value={note}
        // Typing happens in the editor. A value set on this copy from outside (the assistant's
        // draft button sets it and fires `input`) is loaded into the editor.
        onChange={(event) => load(event.currentTarget.value)}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onFocus={(event: FocusEvent) => {
          event.preventDefault();
          editor?.commands.focus();
        }}
        onInvalid={(event) => {
          // Say it beside the editor: the browser's bubble would point at this hidden copy.
          event.preventDefault();
          setProblem(event.currentTarget.validity.valueMissing ? "required" : "tooLong");
          editor?.commands.focus();
        }}
      />
      {editor && !disabled ? <NoteToolbar editor={editor} linkOpen={linkOpen} setLinkOpen={setLinkOpen} /> : null}
      <EditorContent editor={editor} className="max-h-[60vh] overflow-y-auto" />
      {restored ? (
        <div className="flex items-center justify-between gap-2 border-t px-2.5 py-1 text-xs text-muted-foreground">
          <span className="min-w-0">{t("draftRestored", { when: format.relativeTime(restored.at, restored.now) })}</span>
          <Button type="button" variant="ghost" size="xs" onClick={discard}>
            {t("draftDiscard")}
          </Button>
        </div>
      ) : null}
      {shown || nearLimit ? (
        <div className="flex items-center justify-between gap-2 border-t px-2.5 py-1 text-xs">
          <span role={shown ? "alert" : undefined} className="text-destructive">
            {shown === "required" ? t("required") : shown === "tooLong" ? t("tooLong", { max: maxLength! }) : null}
          </span>
          {maxLength !== undefined ? <span className={cn("tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>{t("length", { count: note.length, max: maxLength })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
