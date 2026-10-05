"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { approveProfileImportAction, approveSalaryImportAction } from "../import-actions";

/**
 * The owner approves the import they are looking at (PAY-14). Only the ids on the screen are sent:
 * a request added to the import after the page was opened is never approved unread.
 */
export function ApproveImportButton({ kind, batchId, ids }: { kind: "salary" | "profile"; batchId: string; ids: string[] }) {
  const t = useTranslations("payroll.imports");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved } = useActionForm(kind === "salary" ? approveSalaryImportAction : approveProfileImportAction, { extra: { batchId, ids }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {saved ? <Alert variant="success">{t("approved")}</Alert> : null}
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant="accent" size="lg" disabled={pending || ids.length === 0} className="w-full md:w-auto">
          {pending ? `${t("approveAll", { count: ids.length })}…` : t("approveAll", { count: ids.length })}
        </Button>
      </div>
    </form>
  );
}
