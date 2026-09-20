"use client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { classifyParallelDifferenceAction, setParallelReferenceAction } from "../parallel-actions";
import type { ComparedField, DifferenceLine, FindingClass } from "../parallel";
import { formatVnd } from "./money";

const CLASSES: FindingClass[] = ["system_bug", "spreadsheet_error", "rule_gap", "accepted_rounding"];

/** Entity and month in the URL, so a reconciliation can be linked to and returned to. */
export function ParallelFilters({ entities, entityId, month, months }: { entities: { id: string; code: string; shortName: string }[]; entityId: string; month: string; months: string[] }) {
  const t = useTranslations("payroll.parallel");
  const router = useRouter();
  const search = useSearchParams();
  const go = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(key, value);
    router.push(`?${next.toString()}`);
  };
  const offered = [...new Set([month, ...months])].sort((left, right) => right.localeCompare(left));

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
        <Input type="month" value={month} onChange={(event) => go("month", event.target.value)} aria-label={t("month")} className="w-40" />
      </label>
      {offered.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {t("otherMonths")}:{" "}
          {offered
            .filter((value) => value !== month)
            .slice(0, 6)
            .map((value) => (
              <button key={value} type="button" onClick={() => go("month", value)} className="mr-2 underline">
                {value}
              </button>
            ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Explaining one difference (FR-PAY-38). The signed difference is sent with the explanation, so
 * an explanation written today stops covering the line if the run is recalculated tomorrow.
 */
export function ClassifyForm({ entityId, month, personId, line }: { entityId: string; month: string; personId: string; line: DifferenceLine }) {
  const t = useTranslations("payroll.parallel");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(classifyParallelDifferenceAction, {
    extra: { entityId, month, personId, field: line.field, delta: line.delta },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {line.classification ? t("reexplain") : t("explain")}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg border p-3">
      <FieldErrors value={fieldErrors}>
        <Field name="classification" label={t("classification")}>
          <Select id="classification" name="classification" defaultValue={line.classification ?? "spreadsheet_error"} required>
            {CLASSES.map((value) => (
              <option key={value} value={value}>
                {t(`classes.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" defaultValue={line.note ?? ""} minLength={3} maxLength={1000} required />
        </Field>
      </FieldErrors>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? `${t("save")}…` : t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      <FormError namespace="payroll.parallel.errors" errorKey={errorKey} />
    </form>
  );
}

const FIELDS: ComparedField[] = ["gross", "employeeInsurance", "unionDues", "pit", "otherDeductions", "net"];

/** Typing one person's figures from the other method, for a small entity or a late correction. */
export function ReferenceForm({ entityId, month, people }: { entityId: string; month: string; people: { personId: string; fullName: string; employeeCode: string | null }[] }) {
  const t = useTranslations("payroll.parallel");
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(setParallelReferenceAction, {
    extra: { entityId, month },
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-medium">{t("entry.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("entry.hint")}</p>
      </div>
      <FieldErrors value={fieldErrors}>
        <Field name="personId" label={t("person")}>
          <Select id="personId" name="personId" required>
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.employeeCode ? `${person.employeeCode} — ` : ""}
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {FIELDS.map((field) => (
            <Field key={field} name={field} label={t(`fields.${field}`)}>
              <Input id={field} name={field} type="number" min={0} step={1} defaultValue={0} required />
            </Field>
          ))}
        </div>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={300} />
        </Field>
      </FieldErrors>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? `${t("save")}…` : t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("entry.saved")}</span> : null}
      </div>
      <FormError namespace="payroll.parallel.errors" errorKey={errorKey} />
    </form>
  );
}

/** One line of the report: what each side said, the gap, and whether anybody has explained it. */
export function DifferenceCell({ line }: { line: DifferenceLine }) {
  const t = useTranslations("payroll.parallel");
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">
        {t(`fields.${line.field}`)}: <span className="tabular-nums">{formatVnd(line.system)}</span> / <span className="tabular-nums text-muted-foreground">{formatVnd(line.reference)}</span>
      </span>
      <span className={`text-xs tabular-nums ${line.classification ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
        {line.delta > 0 ? "+" : ""}
        {formatVnd(line.delta)}
        {line.classification ? ` · ${t(`classes.${line.classification}`)}` : ` · ${t("unexplained")}`}
        {line.stale ? ` · ${t("stale")}` : ""}
      </span>
      {line.note ? <span className="text-xs text-muted-foreground">{line.note}</span> : null}
    </div>
  );
}
