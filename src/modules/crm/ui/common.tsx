"use client";
// The CRM's form plumbing: a form that posts to one action and speaks the CRM's own error words,
// and a one-tap button. Mobile first: fields stack on a phone and sit in a row from `sm`.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";

export type Action = (input: unknown) => Promise<ActionResult<unknown>>;
export type Person = { id: string; fullName: string };
export type Named = { id: string; name: string };

export const textarea = "min-h-20 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm";

/** A form that posts to an action and shows what went wrong in the CRM's words. `children` may be a function of the refusal's details. */
export function CrmForm({ action, extra, children, submit, className, onDone, navigateTo, footer }: { action: Action; extra?: Record<string, unknown>; children: ReactNode | ((details: unknown) => ReactNode); submit: string; className?: string; onDone?: (data: unknown) => void; navigateTo?: (data: unknown) => string | null; footer?: ReactNode }) {
  const t = useTranslations("crm");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors, details } = useActionForm(action, {
    extra,
    onSuccess: (data) => {
      onDone?.(data);
      const to = navigateTo?.(data);
      if (to) router.push(to);
      else router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className={className ?? "flex flex-col gap-3"}>
      <FieldErrors value={fieldErrors}>{typeof children === "function" ? children(details) : children}</FieldErrors>
      <FormError namespace="crm.errors" errorKey={errorKey} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {submit}
        </Button>
        {footer}
        {saved && !errorKey ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

/** One tap, one action. A refusal is shown beside the button in the CRM's words. */
export function CrmButton({ action, input, label, confirm, variant = "outline", navigateTo }: { action: Action; input: unknown; label: string; confirm?: string; variant?: "outline" | "ghost" | "default" | "destructive"; navigateTo?: (data: unknown) => string | null }) {
  const t = useTranslations("crm.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action(input);
            const key = result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic");
            setError(key);
            if (!result.ok) return;
            const to = navigateTo?.(result.data);
            if (to) router.push(to);
            else router.refresh();
          });
        }}
      >
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t.has(error) ? t(error) : t("generic")}
        </span>
      ) : null}
    </span>
  );
}
