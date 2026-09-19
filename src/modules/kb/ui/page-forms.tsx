"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { archivePageAction, createPageAction, deletePageAction, movePageAction, publishPageAction, restoreVersionAction, setPageMetaAction, unpublishPageAction } from "../actions";

type ParentOption = { id: string; title: string; depth: number };
const indent = (option: ParentOption) => `${"— ".repeat(option.depth)}${option.title}`;

export function NewPageForm({ spaceId, parents, defaultParentId }: { spaceId: string; parents: ParentOption[]; defaultParentId: string }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const form = useActionForm(createPageAction, { extra: { spaceId }, onSuccess: (data) => router.push(`/kb/pages/${data.id}/edit`) });
  return (
    <form onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("fields.title")}>
          <Input id="title" name="title" required maxLength={200} autoFocus />
        </Field>
        <Field name="parentId" label={t("fields.parent")}>
          <Select id="parentId" name="parentId" defaultValue={defaultParentId}>
            <option value="">{t("page.topLevel")}</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {indent(parent)}
              </option>
            ))}
          </Select>
        </Field>
      </FieldErrors>
      <FormError namespace="kb.errors" errorKey={form.errorKey} />
      <Button type="submit" disabled={form.pending} className="w-fit">
        {t("page.create")}
      </Button>
    </form>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (work: () => Promise<ActionResult<unknown>>, done?: () => void) =>
    startTransition(async () => {
      const result = await work();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) (done ?? (() => router.refresh()))();
    });
  return { run, pending, errorKey };
}

function RunError({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("kb");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

/** Publish the working copy from the reading view (the editor has its own button). */
export function PublishDraftButton({ pageId }: { pageId: string }) {
  const t = useTranslations("kb");
  const { run, pending, errorKey } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => publishPageAction({ pageId }))}>
        {t("editor.publish")}
      </Button>
      <RunError errorKey={errorKey} />
    </span>
  );
}

export function MovePageForm({ pageId, parents, parentId, siblingCount }: { pageId: string; parents: ParentOption[]; parentId: string | null; siblingCount: number }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const form = useActionForm(movePageAction, { extra: { pageId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
      <Field name="parentId" label={t("fields.parent")}>
        <Select id="move-parentId" name="parentId" defaultValue={parentId ?? ""}>
          <option value="">{t("page.topLevel")}</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {indent(parent)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="position" label={t("fields.position")}>
        <Input id="position" name="position" type="number" min={1} max={siblingCount + 1} placeholder={t("page.last")} />
      </Field>
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("page.move")}
      </Button>
      <div className="sm:col-span-3">
        <FormError namespace="kb.errors" errorKey={form.errorKey} />
      </div>
    </form>
  );
}

export function PageMetaForm({ pageId, ownerPersonId, reviewBy, people }: { pageId: string; ownerPersonId: string | null; reviewBy: string | null; people: { id: string; name: string }[] }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const form = useActionForm(setPageMetaAction, { extra: { pageId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <Field name="ownerPersonId" label={t("fields.owner")}>
        <Select id="ownerPersonId" name="ownerPersonId" defaultValue={ownerPersonId ?? ""}>
          <option value="">—</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="reviewBy" label={t("fields.reviewBy")}>
        <Input id="reviewBy" name="reviewBy" type="date" defaultValue={reviewBy ?? ""} />
      </Field>
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("save")}
      </Button>
      <div className="sm:col-span-3">
        <FormError namespace="kb.errors" errorKey={form.errorKey} />
      </div>
    </form>
  );
}

export function PageLifecycleButtons({ pageId, spaceKey, status, published, canPublish, canDelete }: { pageId: string; spaceKey: string; status: string; published: boolean; canPublish: boolean; canDelete: boolean }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canPublish && published && status !== "archived" ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => window.confirm(t("page.unpublishConfirm")) && run(() => unpublishPageAction({ pageId }))}>
            {t("page.unpublish")}
          </Button>
        ) : null}
        {canPublish || !published ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => archivePageAction({ pageId, archived: status !== "archived" }))}>
            {status === "archived" ? t("page.unarchive") : t("page.archive")}
          </Button>
        ) : null}
        {canDelete ? (
          <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => window.confirm(t("page.deleteConfirm")) && run(() => deletePageAction({ pageId }), () => router.push(`/kb/spaces/${spaceKey}`))}>
            {t("page.delete")}
          </Button>
        ) : null}
      </div>
      <RunError errorKey={errorKey} />
    </div>
  );
}

export function RestoreVersionButton({ pageId, versionNo }: { pageId: string; versionNo: number }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const { run, pending, errorKey } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={() => window.confirm(t("history.restoreConfirm", { n: versionNo })) && run(() => restoreVersionAction({ pageId, versionNo }), () => router.push(`/kb/pages/${pageId}?draft=1`))}>
        {t("history.restore")}
      </Button>
      <RunError errorKey={errorKey} />
    </span>
  );
}
