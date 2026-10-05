"use client";
// Recording what the candidate said about being kept (FR-REC-04, 13): one button, whichever way
// round they want it. Leaving is also theirs to do themselves, from the link in their letters.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { setTalentPoolAction } from "../actions";

export function TalentPoolControl({ candidateId, inPool }: { candidateId: string; inPool: boolean }) {
  const t = useTranslations("recruit.pool");
  const router = useRouter();
  const form = useActionForm(setTalentPoolAction, { extra: { candidateId, inPool: !inPool }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={form.pending}>
        {inPool ? t("recordLeave") : t("recordJoin")}
      </Button>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
    </form>
  );
}
