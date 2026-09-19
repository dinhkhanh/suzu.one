"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { importDocxAction, importMarkdownAction } from "../actions";

type ParentOption = { id: string; title: string; depth: number };
const DOCX_MAX_BYTES = 3_500_000;

/**
 * Paste Markdown, or choose a file: a .md / .txt file is read here and fills the box (so it can be
 * checked before importing); a .docx goes to the server as it is. Either way the result is a draft.
 */
export function ImportPageForm({ spaceId, parents, defaultParentId }: { spaceId: string; parents: ParentOption[]; defaultParentId: string }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [parentId, setParentId] = useState(defaultParentId);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [docx, setDocx] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function choose(file: File | undefined) {
    setErrorKey(null);
    setDocx(null);
    if (!file) return;
    setFileName(file.name);
    if (/\.docx$/i.test(file.name)) return file.size > DOCX_MAX_BYTES ? setErrorKey("file_too_large") : setDocx(file);
    if (!/\.(md|markdown|txt)$/i.test(file.name)) return setErrorKey("file_type_not_allowed");
    void file.text().then(setMarkdown);
  }

  function submit() {
    startTransition(async () => {
      let result: ActionResult<{ id: string }>;
      if (docx) {
        const form = new FormData();
        form.set("file", docx);
        form.set("spaceId", spaceId);
        form.set("parentId", parentId);
        form.set("title", title);
        result = await importDocxAction(form);
      } else result = await importMarkdownAction({ spaceId, parentId, title, markdown, fileName });
      if (result.ok) return router.push(`/kb/pages/${result.data.id}/edit`);
      setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-file">{t("import.file")}</Label>
        <Input id="import-file" type="file" accept=".md,.markdown,.txt,.docx" onChange={(event) => choose(event.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">{t("import.fileHelp")}</p>
      </div>
      {docx ? (
        <p className="rounded-md border p-3 text-sm">{t("import.docxChosen", { name: docx.name })}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-markdown">{t("import.markdown")}</Label>
          <textarea id="import-markdown" value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={14} maxLength={400000} className="rounded-md border bg-transparent p-3 font-mono text-xs" placeholder={"# Tiêu đề\n\nNội dung…"} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-title">{t("import.titleField")}</Label>
        <Input id="import-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder={t("import.titleHint")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-parent">{t("fields.parent")}</Label>
        <Select id="import-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">{t("page.topLevel")}</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {`${"— ".repeat(parent.depth)}${parent.title}`}
            </option>
          ))}
        </Select>
      </div>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      <Button type="button" disabled={pending || (!docx && !markdown.trim())} onClick={submit} className="w-fit">
        {t("import.submit")}
      </Button>
    </div>
  );
}
