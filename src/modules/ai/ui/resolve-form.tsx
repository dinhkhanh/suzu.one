"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { resolveUnansweredAction } from "../actions";

/** "We have written the page" — closes every copy of the same question at once. */
export function ResolveUnansweredForm({ id }: { id: string }) {
  const t = useTranslations("assistant.unanswered");
  const router = useRouter();
  const form = useActionForm(resolveUnansweredAction, { extra: { id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`note-${id}`} className="sr-only">
        {t("note")}
      </label>
      <input id={`note-${id}`} name="note" maxLength={300} placeholder={t("notePlaceholder")} className="h-7 min-w-48 flex-1 rounded-lg border bg-background px-2 text-xs" />
      <Button type="submit" variant="outline" size="sm" disabled={form.pending}>
        {t("resolve")}
      </Button>
    </form>
  );
}
