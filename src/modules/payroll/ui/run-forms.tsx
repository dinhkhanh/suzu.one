"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { RunStep } from "../lifecycle";
import { calculatePayrollRunAction, cancelPayrollRunAction, createPayrollRunAction, removePayrollRunInputAction, setPayrollRunInputAction, stepPayrollRunAction } from "../run-actions";

type EntityOption = { id: string; code: string; shortName: string };

/** A month whose timesheet is locked and which has no run yet (FR-PAY-10). */
export function NewRunForm({ entities, months }: { entities: EntityOption[]; months: { entityId: string; month: string; hasRun: boolean }[] }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createPayrollRunAction, { onSuccess: (data) => router.push(`/payroll/runs/${(data as { id: string }).id}`) });
  const open = months.filter((month) => month.entityId === entityId && !month.hasRun);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("new.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("new.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} — {entity.shortName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="month" label={t("month")}>
            <Select id="month" name="month" required>
              {open.map((month) => (
                <option key={month.month} value={month.month}>
                  {month.month}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>
      </FieldErrors>
      {open.length === 0 ? <p className="text-sm text-muted-foreground">{t("new.noMonths")}</p> : null}
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || open.length === 0}>
          {pending ? t("new.saving") : t("new.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Calculate (or recalculate) the run. The figures are worked out in the background (ADR-09). */
export function CalculateRunButton({ runId, label }: { runId: string; label: string }) {
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(calculatePayrollRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? `${label}…` : label}
      </Button>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
    </form>
  );
}

/**
 * One step of the lifecycle (SRS D17). A return to HR must carry a reason, so the comment box is
 * shown for it and required; the other steps take an optional note.
 */
export function RunStepForm({ runId, step, label, destructive }: { runId: string; step: RunStep; label: string; destructive?: boolean }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(stepPayrollRunAction, {
    extra: { runId, step },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });
  const needsReason = step === "return";

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={fieldErrors}>
        <Field name="comment" label={needsReason ? t("steps.reason") : t("steps.comment")}>
          <Input id="comment" name="comment" maxLength={1000} required={needsReason} placeholder={needsReason ? t("steps.reasonHint") : ""} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant={destructive ? "outline" : "default"} disabled={pending}>
          {pending ? `${label}…` : label}
        </Button>
      </div>
    </form>
  );
}

export function CancelRunButton({ runId }: { runId: string }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(cancelPayrollRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? `${t("cancel")}…` : t("cancel")}
      </Button>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
    </form>
  );
}

/** A figure typed into the run for one person: a bonus, a commission, an advance, a penalty. */
export function RunInputForm({ runId, people, codes }: { runId: string; people: { personId: string; fullName: string }[]; codes: { code: string; name: string }[] }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(setPayrollRunInputAction, {
    extra: { runId },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("inputs.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("inputs.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field name="personId" label={t("inputs.person")}>
            <Select id="personId" name="personId" required>
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="code" label={t("inputs.code")}>
            <Select id="code" name="code" required>
              {codes.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="amount" label={t("inputs.amount")}>
            <Input id="amount" name="amount" inputMode="numeric" required className="text-right tabular-nums" />
          </Field>
          <Field name="note" label={t("inputs.note")}>
            <Input id="note" name="note" maxLength={300} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? `${t("inputs.save")}…` : t("inputs.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("inputs.saved")}</span> : null}
      </div>
    </form>
  );
}

export function RemoveRunInputButton({ runId, personId, code }: { runId: string; personId: string; code: string }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const { onSubmit, pending } = useActionForm(removePayrollRunInputAction, { extra: { runId, personId, code }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit}>
      <button type="submit" disabled={pending} className="text-xs text-muted-foreground hover:text-destructive hover:underline">
        {t("inputs.remove")}
      </button>
    </form>
  );
}
