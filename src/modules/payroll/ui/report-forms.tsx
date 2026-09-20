"use client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useActionForm } from "@/components/forms/use-action-form";
import { FormError } from "@/components/forms/field";
import { exportPayrollReportAction } from "../report-actions";

/** Entity and month are in the URL, so a report can be linked to and refreshed. */
export function ReportFilters({ entities, months, entityId, month }: { entities: { id: string; code: string; shortName: string }[]; months: string[]; entityId: string; month: string }) {
  const t = useTranslations("payroll.reports");
  const router = useRouter();
  const search = useSearchParams();
  const go = (key: "entityId" | "month", value: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(key, value);
    router.push(`?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("entity")}</span>
        <Select value={entityId} onChange={(event) => go("entityId", event.target.value)} aria-label={t("entity")}>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code} — {entity.shortName}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("month")}</span>
        <Select value={month} onChange={(event) => go("month", event.target.value)} aria-label={t("month")}>
          {months.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/** Takes a report out of the system as CSV. Audited server-side; the file never touches storage. */
export function ExportReportButton({ report, entityId, month }: { report: "register" | "insurance" | "pit" | "cost" | "union"; entityId: string; month: string }) {
  const t = useTranslations("payroll.reports");
  const { onSubmit, pending, errorKey } = useActionForm(exportPayrollReportAction, {
    extra: { report, entityId, month },
    onSuccess: (data) => {
      const file = data as { fileName: string; csv: string };
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? `${t("export")}…` : t("export")}
      </Button>
      <FormError namespace="payroll.reports.errors" errorKey={errorKey} />
    </form>
  );
}
