"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
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
      <Alert variant="neutral">{t("localNotice")}</Alert>
      <Button type="submit" variant="accent" size="lg" disabled={pending} className="w-full md:w-auto md:self-start">
        {t("localConfirm")}
      </Button>
      <FormError namespace="stepUp.errors" errorKey={errorKey} />
    </form>
  );
}
