"use client";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deletePeopleViewAction, savePeopleViewAction } from "../actions";
import { FormError } from "./fields";
import { useActionForm } from "./use-action-form";

type View = { id: string; name: string; filters: Record<string, string> };

export function SavedViews({ views, currentFilters }: { views: View[]; currentFilters: Record<string, string> }) {
  const t = useTranslations("people.views");
  const form = useRef<HTMLFormElement>(null);
  const [deleting, startDelete] = useTransition();
  const { onSubmit, pending, errorKey } = useActionForm(savePeopleViewAction, {
    extra: { filters: currentFilters },
    onSuccess: () => form.current?.reset(),
  });
  const hasFilters = Object.keys(currentFilters).length > 0;
  if (views.length === 0 && !hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((view) => (
        <span key={view.id} className="inline-flex items-center rounded-full border text-sm">
          <Link href={`/people?${new URLSearchParams(view.filters)}`} className="rounded-l-full py-1 pr-1 pl-3 hover:bg-muted">
            {view.name}
          </Link>
          <button
            type="button"
            aria-label={t("delete", { name: view.name })}
            disabled={deleting}
            onClick={() => startDelete(async () => void (await deletePeopleViewAction({ id: view.id })))}
            className="rounded-r-full py-1 pr-2 pl-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {hasFilters ? (
        <form ref={form} onSubmit={onSubmit} className="flex items-center gap-2">
          <Input name="name" required maxLength={60} placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} className="h-7 w-44" />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {t("save")}
          </Button>
          <FormError errorKey={errorKey} />
        </form>
      ) : null}
    </div>
  );
}
