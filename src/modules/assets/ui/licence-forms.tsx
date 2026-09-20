"use client";
// Registering a licence or subscription (FR-AST-05). The renewal date is the field that matters:
// it is what the OPS tracker turns into an obligation, and the form says so.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveLicenceAction } from "../actions";
import { BILLING_CYCLES, type BillingCycle, LICENCE_STATUSES, type LicenceStatus } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export type LicenceFormValue = {
  id: string | null;
  name: string;
  vendor: string | null;
  entityId: string;
  seats: number | null;
  costPerCycle: number | null;
  billingCycle: BillingCycle;
  renewalDate: string | null;
  autoRenews: boolean;
  ownerPersonId: string | null;
  accountRef: string | null;
  notes: string | null;
  status: LicenceStatus;
};

export function LicenceForm({
  value,
  entities,
  people,
  canSeeMoney,
}: {
  value: LicenceFormValue | null;
  entities: { id: string; code: string; shortName: string | null }[];
  people: { id: string; fullName: string }[];
  canSeeMoney: boolean;
}) {
  const t = useTranslations("assets.licences");
  const cycles = useTranslations("assets.licences.cycle");
  const statuses = useTranslations("assets.licences.status");
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>(value?.billingCycle ?? "annual");
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(saveLicenceAction, {
    extra: value?.id ? { licenceId: value.id } : {},
    onSuccess: () => router.push("/assets/licences"),
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label={t("form.name")}>
            <Input id="name" name="name" required maxLength={200} defaultValue={value?.name ?? ""} placeholder="Adobe Creative Cloud" />
          </Field>
          <Field name="vendor" label={t("form.vendor")}>
            <Input id="vendor" name="vendor" maxLength={120} defaultValue={value?.vendor ?? ""} placeholder="Adobe" />
          </Field>
          <Field name="entityId" label={t("form.entity")}>
            <Select id="entityId" name="entityId" required defaultValue={value?.entityId ?? ""}>
              <option value="" disabled>
                —
              </option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.shortName ?? entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="ownerPersonId" label={t("form.owner")}>
            <Select id="ownerPersonId" name="ownerPersonId" defaultValue={value?.ownerPersonId ?? ""}>
              <option value="">{t("form.noOwner")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="seats" label={t("form.seats")}>
            <Input id="seats" name="seats" type="number" min={0} max={100000} defaultValue={value?.seats ?? ""} />
          </Field>
          <Field name="billingCycle" label={t("form.cycle")}>
            <Select id="billingCycle" name="billingCycle" required value={cycle} onChange={(event) => setCycle(event.target.value as BillingCycle)}>
              {BILLING_CYCLES.map((option) => (
                <option key={option} value={option}>
                  {cycles(option)}
                </option>
              ))}
            </Select>
          </Field>
          {cycle === "perpetual" ? null : (
            <Field name="renewalDate" label={t("form.renewalDate")}>
              <Input id="renewalDate" name="renewalDate" type="date" required defaultValue={value?.renewalDate ?? ""} />
            </Field>
          )}
          {canSeeMoney ? (
            <Field name="costPerCycle" label={t("form.cost")}>
              <Input id="costPerCycle" name="costPerCycle" inputMode="numeric" defaultValue={value?.costPerCycle ?? ""} placeholder="12.500.000" />
            </Field>
          ) : null}
          <Field name="accountRef" label={t("form.accountRef")}>
            <Input id="accountRef" name="accountRef" maxLength={200} defaultValue={value?.accountRef ?? ""} />
          </Field>
          <Field name="status" label={t("form.status")}>
            <Select id="status" name="status" defaultValue={value?.status ?? "active"}>
              {LICENCE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {statuses(option)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoRenews" defaultChecked={value?.autoRenews ?? true} className="size-4" />
          {t("form.autoRenews")}
        </label>

        <Field name="notes" label={t("form.notes")}>
          <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={value?.notes ?? ""} className={textarea} />
        </Field>
      </FieldErrors>

      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("form.tracker")}</p>
      <FormError namespace="assets.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("form.submit")}
        </Button>
        {saved ? <span className="text-sm text-emerald-600">{t("form.saved")}</span> : null}
      </div>
    </form>
  );
}
