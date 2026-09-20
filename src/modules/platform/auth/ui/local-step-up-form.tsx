"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { confirmLocalStepUpAction } from "../step-up-actions";

// Development machines only: the action behind this button refuses unless the local driver is on,
// and the environment loader refuses the local driver in any production build.
export function LocalStepUpForm({ next }: { next: string }) {
  const t = useTranslations("stepUp");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(confirmLocalStepUpAction, { onSuccess: () => router.replace(next) });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("localNotice")}</p>
      <Button type="submit" disabled={pending} className="self-start">
        {t("localConfirm")}
      </Button>
      <FormError namespace="stepUp.errors" errorKey={errorKey} />
    </form>
  );
}
