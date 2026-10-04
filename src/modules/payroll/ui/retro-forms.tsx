"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { TableAddRow } from "@/components/ui/table";
import { addRetroItemAction, cancelRetroItemAction, deriveRetroItemsAction } from "../retro-actions";

/**
 * The row that closes the retro table: an item entered by hand (FR-PAY-17). The amount is signed
 * — money owed to the person, or money to recover — and the reason is required: it is what the
 * payslip line will say.
 */
export function AddRetroItemRow({ entityId, runId, people, lastMonth }: { entityId: string; runId?: string | null; people: { personId: string; fullName: string }[]; /** The latest month an item may belong to. */ lastMonth: string }) {
  const t = useTranslations("payroll.retro");
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(addRetroItemAction, {
    extra: { entityId, runId: runId ?? null },
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
      router.refresh();
    },
  });

  return (
    <TableAddRow label={t("add.label")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("add.hint")}</p>
        <FieldErrors value={fieldErrors}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field name="retro-personId" label={t("person")}>
              <Select id="retro-personId" name="personId" required>
                {people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name="retro-sourceMonth" label={t("sourceMonth")}>
              <MonthPicker id="retro-sourceMonth" name="sourceMonth" required max={lastMonth} />
            </Field>
            <Field name="retro-amount" label={t("amount")}>
              <MoneyInput id="retro-amount" name="amount" required allowNegative className="text-right" />
            </Field>
            <Field name="retro-reason" label={t("reason")}>
              <Input id="retro-reason" name="reason" required maxLength={300} />
            </Field>
          </div>
        </FieldErrors>
        <FormError namespace="payroll.retro.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending || people.length === 0} className="w-full md:w-auto">
            {pending ? `${t("add.save")}…` : t("add.save")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}

/** Cancelling an item asks why: the reason stays on the item, which is never deleted. */
export function CancelRetroItemButton({ id, runId, name }: { id: string; runId?: string | null; /** Whose item, for the dialog's title. */ name: string }) {
  const t = useTranslations("payroll.retro");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(cancelRetroItemAction, {
    extra: { id, runId: runId ?? null },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-destructive" />}>{t("cancel.label")}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cancel.title", { name })}</DialogTitle>
          <DialogDescription>{t("cancel.hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FieldErrors value={fieldErrors}>
            <Field name={`cancel-reason-${id}`} label={t("cancel.reason")}>
              <Input id={`cancel-reason-${id}`} name="reason" required maxLength={150} autoComplete="off" />
            </Field>
          </FieldErrors>
          <FormError namespace="payroll.retro.errors" errorKey={errorKey} />
          <div>
            <Button type="submit" variant="destructive" disabled={pending} className="w-full md:w-auto">
              {pending ? `${t("cancel.confirm")}…` : t("cancel.confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Looks for differences now — late salary decisions, corrections to locked timesheets — instead of at the next calculation. */
export function DeriveRetroButton({ entityId, runId }: { entityId: string; runId?: string | null }) {
  const t = useTranslations("payroll.retro");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved } = useActionForm(deriveRetroItemsAction, { extra: { entityId, runId: runId ?? null }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      {saved ? <span className="text-xs text-muted-foreground">{t("derive.done")}</span> : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? `${t("derive.label")}…` : t("derive.label")}
      </Button>
      <FormError namespace="payroll.retro.errors" errorKey={errorKey} />
    </form>
  );
}

/**
 * A correction the system could not price (its month was never run here), entered by hand: the
 * person, the month and the reason are the correction's own; C&B supply the amount.
 */
export function UnpricedAdjustmentForm({ entityId, runId, adjustmentId, personId, sourceMonth, reason }: { entityId: string; runId?: string | null; adjustmentId: string; personId: string; sourceMonth: string; reason: string }) {
  const t = useTranslations("payroll.retro");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(addRetroItemAction, { extra: { entityId, runId: runId ?? null, adjustmentId, personId, sourceMonth, reason }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={fieldErrors}>
        <div className="flex flex-wrap items-end gap-2">
          <Field name={`amount-${adjustmentId}`} label={t("amount")}>
            <MoneyInput id={`amount-${adjustmentId}`} name="amount" required allowNegative className="w-40 text-right" />
          </Field>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? `${t("unpriced.enter")}…` : t("unpriced.enter")}
          </Button>
        </div>
      </FieldErrors>
      <FormError namespace="payroll.retro.errors" errorKey={errorKey} />
    </form>
  );
}
