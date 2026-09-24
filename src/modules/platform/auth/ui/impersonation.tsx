"use client";
import { Eye, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { startImpersonationAction, stopImpersonationAction } from "../impersonation-actions";

/** On a person's page: from here on, the session sees the app as them (FR-PLT-40). */
export function ImpersonateButton({ personId }: { personId: string }) {
  const t = useTranslations("impersonation");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(startImpersonationAction, {
    extra: { personId },
    // Their day, as they see it — and the shell re-renders with their sidebar and the banner.
    onSuccess: () => {
      router.push("/today");
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Eye />
        {t("start")}
      </Button>
      <FormError namespace="impersonation.errors" errorKey={errorKey} />
    </form>
  );
}

/** Across the top of every page while a session sees the app as somebody else: who, and the way back. */
export function ImpersonationBanner({ name, personId }: { name: string; personId: string }) {
  const t = useTranslations("impersonation");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(stopImpersonationAction, {
    // Back where the borrowing started: the page of the person just seen as.
    onSuccess: () => {
      router.push(`/people/${encodeURIComponent(personId)}`);
      router.refresh();
    },
  });
  return (
    <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t("banner", { name })}</span> <span className="text-muted-foreground">{t("note")}</span>
      </span>
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <FormError namespace="impersonation.errors" errorKey={errorKey} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <LogOut />
          {t("stop")}
        </Button>
      </form>
    </Alert>
  );
}
