"use client";
// The page editor (FR-KB-02): a full WYSIWYG over the page document. A toolbar and a bubble menu over
// the selection for formatting, "/" to insert any block, Markdown shortcuts as one types (## , - ,
// [ ] , > , ```), pictures and files uploaded by picking, pasting or dropping them, Mod-S to save
// the draft, and a warning before leaving with unsaved changes.
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  SquareCode,
  SquarePlay,
  Strikethrough,
  Table,
  Underline,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Extension } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { CALLOUT_KINDS } from "@/modules/platform/rich-text/engine/callouts";
import { MOD, ToolButton, Toolbar, ToolSeparator } from "@/modules/platform/rich-text/ui/toolbar";
import { beginPageUploadAction, completePageUploadAction, publishPageAction, savePageDraftAction, submitPageReviewAction } from "../actions";
import { pageExtensions } from "./editor-nodes";
import { matchSlash, SlashCommands, type SlashItem, SlashMenu } from "./editor-slash";
import { CALLOUT_ICONS, insertTable, PageToolbar, type Panels, setCallout, useFilePicker } from "./editor-toolbar";

type Failure = { ok: boolean; error?: string; message?: string };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

// What the editor's own handlers ask of the page around it. They are made once, with the editor;
// they say what happened on the editor's element and the page answers with its current state.
type Signals = { "kb-save": undefined; "kb-panel": keyof Panels; "kb-pick": string; "kb-upload": { files: File[]; at?: number } };
const signal = <K extends keyof Signals>(element: HTMLElement, name: K, detail: Signals[K]) => element.dispatchEvent(new CustomEvent(name, { detail }));

/** Mod-S saves the draft. */
const SaveKey = Extension.create({
  name: "saveKey",
  addKeyboardShortcuts() {
    return {
      "Mod-s": () => {
        signal(this.editor.view.dom, "kb-save", undefined);
        return true;
      },
    };
  },
});

type Translate = (key: string) => string;

/** What "/" offers. */
function slashItems(t: Translate, tr: Translate): SlashItem[] {
  return [
    { key: "text", label: tr("paragraph"), icon: Pilcrow, keywords: "paragraph p", run: (editor) => editor.chain().focus().setParagraph().run() },
    { key: "h1", label: tr("h1"), icon: Heading1, keywords: "heading title #", run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
    { key: "h2", label: tr("h2"), icon: Heading2, keywords: "heading ##", run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
    { key: "h3", label: tr("h3"), icon: Heading3, keywords: "heading ###", run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run() },
    { key: "bullet", label: tr("bulletList"), icon: List, keywords: "bullet list ul", run: (editor) => editor.chain().focus().toggleBulletList().run() },
    { key: "numbered", label: tr("orderedList"), icon: ListOrdered, keywords: "numbered ordered list ol", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
    { key: "todo", label: tr("taskList"), icon: ListTodo, keywords: "todo task checklist checkbox", run: (editor) => editor.chain().focus().toggleTaskList().run() },
    { key: "quote", label: tr("quote"), icon: Quote, keywords: "quote blockquote", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
    { key: "code", label: tr("codeBlock"), icon: SquareCode, keywords: "code pre", run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
    { key: "rule", label: tr("rule"), icon: Minus, keywords: "divider hr line", run: (editor) => editor.chain().focus().setHorizontalRule().run() },
    { key: "table", label: t("table"), icon: Table, keywords: "table grid", run: insertTable },
    ...CALLOUT_KINDS.map((kind) => ({ key: `callout-${kind}`, label: t(`callout.${kind}`), icon: CALLOUT_ICONS[kind], keywords: `callout ${kind}`, run: (editor: Editor) => setCallout(editor, kind) })),
    { key: "image", label: t("imageUrl"), icon: ImagePlus, keywords: "image picture photo img", run: (editor) => signal(editor.view.dom, "kb-panel", "image") },
    { key: "upload", label: t("upload"), icon: Paperclip, keywords: "upload file attachment image", run: (editor) => signal(editor.view.dom, "kb-pick", ACCEPT_ATTRIBUTE) },
    { key: "embed", label: t("embed"), icon: SquarePlay, keywords: "embed video youtube drive figma canva", run: (editor) => signal(editor.view.dom, "kb-panel", "embed") },
  ];
}

/** The formatting that follows a selection of text. */
function SelectionMenu({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const t = useTranslations("richText");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      highlight: current.isActive("highlight"),
      code: current.isActive("code"),
      link: current.isActive("link"),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top" }}
      // Text only: not a picked block, not a run of table cells, not inside code.
      shouldShow={({ state: view }) => !view.selection.empty && !(view.selection instanceof NodeSelection) && !(view.selection instanceof CellSelection) && !editor.isActive("codeBlock")}
      className="z-30 rounded-lg bg-popover p-0.5 shadow-md ring-1 ring-foreground/10"
    >
      <Toolbar label={t("toolbar")}>
        <ToolButton label={t("bold")} shortcut={`${MOD}B`} icon={Bold} active={state.bold} onClick={() => chain().toggleBold().run()} />
        <ToolButton label={t("italic")} shortcut={`${MOD}I`} icon={Italic} active={state.italic} onClick={() => chain().toggleItalic().run()} />
        <ToolButton label={t("underline")} shortcut={`${MOD}U`} icon={Underline} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
        <ToolButton label={t("strike")} icon={Strikethrough} active={state.strike} onClick={() => chain().toggleStrike().run()} />
        <ToolButton label={t("highlight")} icon={Highlighter} active={state.highlight} onClick={() => chain().toggleHighlight().run()} />
        <ToolButton label={t("inlineCode")} icon={Code} active={state.code} onClick={() => chain().toggleCode().run()} />
        <ToolSeparator />
        <ToolButton label={t("link")} shortcut={`${MOD}K`} icon={Link2} active={state.link} onClick={onLink} />
      </Toolbar>
    </BubbleMenu>
  );
}

function Counts({ editor }: { editor: Editor }) {
  const t = useTranslations("kb.editor");
  const counts = useEditorState({ editor, selector: ({ editor: current }) => ({ words: current.storage.characterCount.words() as number, characters: current.storage.characterCount.characters() as number }) });
  return (
    <span className="tabular-nums">
      {t("words", { count: counts.words })} · {t("characters", { count: counts.characters })}
    </span>
  );
}

export function PageEditor({ pageId, initialTitle, initialContent, canPublish, controlled }: { pageId: string; initialTitle: string; initialContent: unknown; canPublish: boolean; controlled: boolean }) {
  const t = useTranslations("kb");
  const tr = useTranslations("richText");
  const te = useTranslations("kb.editor");
  const format = useFormatter();
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [changeNote, setChangeNote] = useState("");
  const [isMajor, setIsMajor] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploads, setUploads] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [panels, setPanels] = useState<Panels>({ link: false, embed: false, image: false });
  const setPanel = useCallback((panel: keyof Panels, open: boolean) => setPanels((current) => ({ ...current, [panel]: open })), []);
  const uploading = uploads > 0;

  const editor = useEditor({
    // Rendered in the browser only: the server has no DOM for ProseMirror.
    immediatelyRender: false,
    extensions: [
      ...pageExtensions({ placeholder: t("editor.slashHint") }),
      SlashCommands.configure({ items: (query) => matchSlash(slashItems(te, tr), query) }),
      SaveKey,
    ],
    content: initialContent as object,
    editorProps: {
      attributes: { "aria-label": t("editor.body") },
      // A picture or file pasted or dropped into the page is uploaded and put where it landed.
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return false;
        signal(view.dom, "kb-upload", { files });
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || files.length === 0) return false;
        signal(view.dom, "kb-upload", { files, at: view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos });
        return true;
      },
    },
    onUpdate: () => setDirty(true),
  });

  function upload(file: File, at?: number) {
    if (!editor) return;
    setUploads((count) => count + 1);
    setErrorKey(null);
    void uploadThroughSignedUrl(file, (meta) => beginPageUploadAction({ pageId, ...meta }), (fileId) => completePageUploadAction({ fileId }))
      .then((result) => {
        if (!result.ok) return setErrorKey(result.errorKey);
        const { fileId, fileName, sizeBytes, contentType } = result.data;
        const node = contentType.startsWith("image/") ? { type: "image", attrs: { fileId, alt: fileName } } : { type: "attachment", attrs: { fileId, fileName, sizeBytes } };
        const chain = editor.chain().focus();
        (at === undefined ? chain.insertContent(node) : chain.insertContentAt(at, node)).run();
      })
      .finally(() => setUploads((count) => count - 1));
  }
  const picker = useFilePicker((file) => upload(file));

  function save(publish: boolean) {
    if (!editor || pending || uploading) return;
    startTransition(async () => {
      // Sent as a JSON string: passed as an object, React's action encoding delivered a node's
      // `attrs` to the server as a function, and every heading, callout and table was refused.
      const content = JSON.stringify(editor.getJSON());
      // In a controlled space an editor's "publish" is a request to the space's reviewers.
      const result = !publish ? await savePageDraftAction({ pageId, title, content }) : canPublish ? await publishPageAction({ pageId, title, content, changeNote, isMajor }) : await submitPageReviewAction({ pageId, title, content, changeNote, isMajor });
      setErrorKey(keyOf(result));
      if (!result.ok) return;
      setDirty(false);
      if (publish) router.push(`/kb/pages/${pageId}`);
      else {
        setSavedAt(format.dateTime(new Date(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        router.refresh();
      }
    });
  }

  // The editor's handlers' requests, answered with this render's state.
  const answer = useRef({ save: () => save(false), upload, pick: picker.pick, setPanel });
  useEffect(() => {
    answer.current = { save: () => save(false), upload, pick: picker.pick, setPanel };
  });
  useEffect(() => {
    if (!editor) return;
    const element = editor.view.dom;
    const handlers: { [K in keyof Signals]: (detail: Signals[K]) => void } = {
      "kb-save": () => answer.current.save(),
      "kb-panel": (panel) => answer.current.setPanel(panel, true),
      "kb-pick": (accept) => answer.current.pick(accept),
      "kb-upload": ({ files, at }) => files.forEach((file) => answer.current.upload(file, at)),
    };
    const listeners = Object.entries(handlers).map(([name, handle]) => [name, (event: Event) => (handle as (detail: unknown) => void)((event as CustomEvent).detail)] as const);
    listeners.forEach(([name, listener]) => element.addEventListener(name, listener));
    return () => listeners.forEach(([name, listener]) => element.removeEventListener(name, listener));
  }, [editor]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        aria-label={t("fields.title")}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          setDirty(true);
        }}
        maxLength={200}
        placeholder={t("fields.title")}
        className="h-11 text-xl font-semibold md:text-xl"
      />
      <div className="rich-editor kb-editor rounded-md border">
        {editor ? <PageToolbar editor={editor} panels={panels} setPanel={setPanel} onPickFile={picker.pick} uploading={uploading} /> : null}
        {editor ? <SelectionMenu editor={editor} onLink={() => setPanel("link", true)} /> : null}
        <EditorContent editor={editor} />
        {editor ? <SlashMenu editor={editor} /> : null}
        {picker.element}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {editor ? <Counts editor={editor} /> : <span />}
          <span>{t("editor.saveShortcut")}</span>
        </div>
      </div>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 rounded-md border p-3">
        {!canPublish ? <p className="text-sm text-muted-foreground">{controlled ? t("editor.controlledNote") : t("editor.cannotPublish")}</p> : null}
        {canPublish || controlled ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <Input aria-label={t("fields.changeNote")} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={300} placeholder={t("fields.changeNote")} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isMajor} onCheckedChange={(checked) => setIsMajor(checked === true)} />
              {t("fields.isMajor")}
            </label>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={pending || uploading || !editor} onClick={() => save(false)}>
            {t("editor.saveDraft")}
          </Button>
          {canPublish || controlled ? (
            <Button type="button" disabled={pending || uploading || !editor} onClick={() => save(true)}>
              {canPublish ? t("editor.publish") : t("editor.submitReview")}
            </Button>
          ) : null}
          {dirty ? <span className="text-xs text-warning">{t("editor.unsaved")}</span> : savedAt ? <span className="text-xs text-muted-foreground">{t("editor.savedAt", { time: savedAt })}</span> : null}
          {uploading ? <span className="text-xs text-muted-foreground">{t("editor.uploading")}</span> : null}
        </div>
      </div>
    </div>
  );
}
