"use client";
import { TableKit } from "@tiptap/extension-table";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { beginPageUploadAction, completePageUploadAction, publishPageAction, savePageDraftAction } from "../actions";
import { CALLOUT_KINDS, type CalloutKind } from "../engine/callouts";
import { normalizeEmbed, safeHref } from "../engine/embed";
import { Attachment, Callout, Embed, KbImage } from "./editor-nodes";

type Failure = { ok: boolean; error?: string; message?: string };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the selection in the document: the button must not take focus.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`h-7 min-w-7 rounded px-1.5 text-sm hover:bg-muted disabled:opacity-40 ${active ? "bg-muted font-semibold" : ""}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

function Toolbar({ editor, onUpload, uploading }: { editor: Editor; onUpload: (file: File) => void; uploading: boolean }) {
  const t = useTranslations("kb.editor");
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      quote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      table: current.isActive("table"),
      callout: current.isActive("callout"),
    }),
  });
  const chain = () => editor.chain().focus();

  function askLink() {
    const current = (editor.getAttributes("link").href as string | undefined) ?? "";
    const answer = window.prompt(t("linkPrompt"), current);
    if (answer === null) return;
    if (answer.trim() === "") return void chain().extendMarkRange("link").unsetLink().run();
    const href = safeHref(answer) ?? safeHref(`https://${answer.trim()}`);
    if (!href) return void window.alert(t("linkRefused"));
    chain().extendMarkRange("link").setLink({ href }).run();
  }

  function askEmbed() {
    const answer = window.prompt(t("embedPrompt"));
    if (!answer) return;
    const embed = normalizeEmbed(answer);
    if (!embed) return void window.alert(t("embedRefused"));
    chain().insertContent({ type: "embed", attrs: { url: answer.trim(), provider: embed.provider } }).run();
  }

  function setCallout(kind: CalloutKind) {
    if (editor.isActive("callout")) {
      if (editor.isActive("callout", { kind })) chain().lift("callout").run();
      else chain().updateAttributes("callout", { kind }).run();
    } else chain().wrapIn("callout", { kind }).run();
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b bg-background px-2 py-1">
      <ToolButton label={t("h1")} active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
      <ToolButton label={t("h2")} active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
      <ToolButton label={t("h3")} active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
      <Divider />
      <ToolButton label={t("bold")} active={state.bold} onClick={() => chain().toggleBold().run()}><b>B</b></ToolButton>
      <ToolButton label={t("italic")} active={state.italic} onClick={() => chain().toggleItalic().run()}><i>I</i></ToolButton>
      <ToolButton label={t("strike")} active={state.strike} onClick={() => chain().toggleStrike().run()}><s>S</s></ToolButton>
      <ToolButton label={t("inlineCode")} active={state.code} onClick={() => chain().toggleCode().run()}>{"</>"}</ToolButton>
      <ToolButton label={t("link")} active={state.link} onClick={askLink}>🔗</ToolButton>
      <Divider />
      <ToolButton label={t("bulletList")} active={state.bullet} onClick={() => chain().toggleBulletList().run()}>•</ToolButton>
      <ToolButton label={t("orderedList")} active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>1.</ToolButton>
      <ToolButton label={t("quote")} active={state.quote} onClick={() => chain().toggleBlockquote().run()}>❝</ToolButton>
      <ToolButton label={t("codeBlock")} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>{"{ }"}</ToolButton>
      <ToolButton label={t("rule")} onClick={() => chain().setHorizontalRule().run()}>―</ToolButton>
      <Divider />
      {CALLOUT_KINDS.map((kind) => (
        <ToolButton key={kind} label={t(`callout.${kind}`)} active={state.callout && editor.isActive("callout", { kind })} onClick={() => setCallout(kind)}>
          {{ info: "ℹ️", warning: "⚠️", success: "✅", danger: "⛔" }[kind]}
        </ToolButton>
      ))}
      <Divider />
      <ToolButton label={t("table")} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</ToolButton>
      {state.table ? (
        <>
          <ToolButton label={t("addRow")} onClick={() => chain().addRowAfter().run()}>+↓</ToolButton>
          <ToolButton label={t("addColumn")} onClick={() => chain().addColumnAfter().run()}>+→</ToolButton>
          <ToolButton label={t("deleteRow")} onClick={() => chain().deleteRow().run()}>−↓</ToolButton>
          <ToolButton label={t("deleteColumn")} onClick={() => chain().deleteColumn().run()}>−→</ToolButton>
          <ToolButton label={t("deleteTable")} onClick={() => chain().deleteTable().run()}>✕▦</ToolButton>
        </>
      ) : null}
      <Divider />
      <ToolButton label={t("embed")} onClick={askEmbed}>▶</ToolButton>
      <ToolButton label={t("upload")} disabled={uploading} onClick={() => fileInput.current?.click()}>📎</ToolButton>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onUpload(file);
        }}
      />
      <Divider />
      <ToolButton label={t("undo")} onClick={() => chain().undo().run()}>↶</ToolButton>
      <ToolButton label={t("redo")} onClick={() => chain().redo().run()}>↷</ToolButton>
    </div>
  );
}

export function PageEditor({ pageId, initialTitle, initialContent, canPublish, controlled }: { pageId: string; initialTitle: string; initialContent: unknown; canPublish: boolean; controlled: boolean }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [changeNote, setChangeNote] = useState("");
  const [isMajor, setIsMajor] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const editor = useEditor({
    // Rendered in the browser only: the server has no DOM for ProseMirror.
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"] } }), TableKit.configure({ table: { resizable: false } }), Callout, Embed, Attachment, KbImage],
    content: initialContent as object,
    editorProps: { attributes: { "aria-label": t("editor.body"), "data-placeholder": t("editor.placeholder") } },
  });

  function upload(file: File) {
    if (!editor) return;
    setUploading(true);
    setErrorKey(null);
    void uploadThroughSignedUrl(file, (meta) => beginPageUploadAction({ pageId, ...meta }), (fileId) => completePageUploadAction({ fileId }))
      .then((result) => {
        if (!result.ok) return setErrorKey(result.errorKey);
        const { fileId, fileName, sizeBytes, contentType } = result.data;
        editor.chain().focus().insertContent(contentType.startsWith("image/") ? { type: "image", attrs: { fileId, alt: fileName } } : { type: "attachment", attrs: { fileId, fileName, sizeBytes } }).run();
      })
      .finally(() => setUploading(false));
  }

  function save(publish: boolean) {
    if (!editor) return;
    startTransition(async () => {
      const content = editor.getJSON();
      const result = publish ? await publishPageAction({ pageId, title, content, changeNote, isMajor }) : await savePageDraftAction({ pageId, title, content });
      setErrorKey(keyOf(result));
      if (!result.ok) return;
      if (publish) router.push(`/kb/pages/${pageId}`);
      else {
        setSavedAt(new Date().toLocaleTimeString());
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Input aria-label={t("fields.title")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder={t("fields.title")} className="h-11 text-xl font-semibold md:text-xl" />
      <div className="kb-editor rounded-md border">
        {editor ? <Toolbar editor={editor} onUpload={upload} uploading={uploading} /> : null}
        <EditorContent editor={editor} />
      </div>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 rounded-md border p-3">
        {canPublish ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <Input aria-label={t("fields.changeNote")} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={300} placeholder={t("fields.changeNote")} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isMajor} onChange={(event) => setIsMajor(event.target.checked)} />
              {t("fields.isMajor")}
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{controlled ? t("editor.controlledNote") : t("editor.cannotPublish")}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={pending || uploading || !editor} onClick={() => save(false)}>
            {t("editor.saveDraft")}
          </Button>
          {canPublish ? (
            <Button type="button" disabled={pending || uploading || !editor} onClick={() => save(true)}>
              {t("editor.publish")}
            </Button>
          ) : null}
          {savedAt ? <span className="text-xs text-muted-foreground">{t("editor.savedAt", { time: savedAt })}</span> : null}
          {uploading ? <span className="text-xs text-muted-foreground">{t("editor.uploading")}</span> : null}
        </div>
      </div>
    </div>
  );
}
