"use client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { StatutoryExportKey } from "../statutory-export-actions";
import { exportStatutoryDataAction, withholdingCertificateAction } from "../statutory-export-actions";

function save(file: { fileName: string; content: string; contentType: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Entity, and the period the filings are built for, both in the URL so a page can be linked to. */
export function StatutoryFilters({ entities, entityId, year, month }: { entities: { id: string; code: string; shortName: string }[]; entityId: string; year: string; month: string }) {
  const t = useTranslations("payroll.statutory");
  const router = useRouter();
  const search = useSearchParams();
  const go = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(key, value);
    router.push(`?${next.toString()}`);
  };
  const years = [...new Set([Number(year), new Date().getFullYear(), new Date().getFullYear() - 1])].sort((left, right) => right - left);

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
          {Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("year")}</span>
        <Select value={year} onChange={(event) => go("year", event.target.value)} aria-label={t("year")}>
          {years.map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/**
 * Builds one filing's data and hands it to the browser. What comes back carries the format's own
 * caveats, which are shown after the download — every layout here is unverified against the
 * official template, and the accountant has to be told so at the moment they take the file.
 */
export function StatutoryExportButton({ kind, entityId, period, label }: { kind: StatutoryExportKey; entityId: string; period: string; label: string }) {
  const t = useTranslations("payroll.statutory");
  const [caveats, setCaveats] = useState<string[]>([]);
  const { onSubmit, pending, errorKey } = useActionForm(exportStatutoryDataAction, {
    extra: { kind, entityId, period },
    onSuccess: (data) => {
      const file = data as { fileName: string; content: string; contentType: string; caveats: string[] };
      save(file);
      setCaveats(file.caveats);
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? `${label}…` : label}
      </Button>
      <FormError namespace="payroll.statutory.errors" errorKey={errorKey} />
      {caveats.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}
      <span className="sr-only">{t("unverified")}</span>
    </form>
  );
}

/** A person's own withholding certificate for a year (FR-PAY-35). */
export function WithholdingCertificateButton({ personId, entityId, year, label }: { personId: string; entityId: string; year: number; label: string }) {
  const { onSubmit, pending, errorKey } = useActionForm(withholdingCertificateAction, {
    extra: { personId, entityId, year },
    onSuccess: (data) => save(data as { fileName: string; content: string; contentType: string }),
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? `${label}…` : label}
      </Button>
      <FormError namespace="payroll.statutory.errors" errorKey={errorKey} />
    </form>
  );
}
