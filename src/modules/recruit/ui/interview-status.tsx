"use client";
// Marking an interview done, cancelled or a no-show. Three buttons and one form: the reason is
// only asked for on a cancellation, because that is the only one anybody later wants explained.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setInterviewStatusAction } from "../interview-actions";

export function InterviewStatusActions({ interviewId, status }: { interviewId: string; status: string }) {
  const t = useTranslations("recruit.interview");
  const router = useRouter();
  const form = useActionForm(setInterviewStatusAction, { extra: { interviewId }, onSuccess: () => router.refresh() });

  if (status !== "scheduled") return null;

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("outcome")}</h3>
      <Input name="reason" maxLength={500} placeholder={t("cancelReason")} />
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" name="status" value="completed" disabled={form.pending}>
          {t("statuses.completed")}
        </Button>
        <Button type="submit" size="sm" variant="outline" name="status" value="no_show" disabled={form.pending}>
          {t("statuses.no_show")}
        </Button>
        <Button type="submit" size="sm" variant="destructive" name="status" value="cancelled" disabled={form.pending}>
          {t("statuses.cancelled")}
        </Button>
      </div>
    </form>
  );
}
