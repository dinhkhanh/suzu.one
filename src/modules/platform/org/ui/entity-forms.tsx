"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createBranchAction, createEntityAction, updateBranchAction, updateEntityAction } from "../actions";
import type { BranchRow, EntityRow } from "../service";

const WAGE_REGIONS = [1, 2, 3, 4] as const;

function WageRegionSelect({ defaultValue }: { defaultValue?: number | null }) {
  const t = useTranslations("entities");
  return (
    <Select id="wageRegion" name="wageRegion" defaultValue={defaultValue ?? ""}>
      <option value="">—</option>
      {WAGE_REGIONS.map((region) => (
        <option key={region} value={region}>
          {t("wageRegionValue", { region })}
        </option>
      ))}
    </Select>
  );
}

export function ActiveCheckbox({ defaultChecked, label }: { defaultChecked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="isActive" defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function CreateEntityForm() {
  const t = useTranslations("entities");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(createEntityAction, { onSuccess: () => form.current?.reset() });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("add")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field name="code" label={t("code")}>
          <Input id="code" name="code" required minLength={2} maxLength={12} pattern="[A-Za-z0-9_-]+" />
        </Field>
        <Field name="shortName" label={t("shortName")}>
          <Input id="shortName" name="shortName" required maxLength={60} />
        </Field>
        <Field name="legalName" label={t("legalName")}>
          <Input id="legalName" name="legalName" required minLength={2} maxLength={200} />
        </Field>
        <Field name="taxCode" label={t("taxCode")}>
          <Input id="taxCode" name="taxCode" maxLength={20} />
        </Field>
        <Field name="wageRegion" label={t("wageRegion")}>
          <WageRegionSelect />
        </Field>
      </div>
      <FormError namespace="entities.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("creating") : t("create")}
        </Button>
      </div>
    </form>
  );
}

export function EditEntityForm({ entity }: { entity: EntityRow }) {
  const t = useTranslations("entities");
  const { onSubmit, pending, errorKey, saved } = useActionForm(updateEntityAction, { extra: { id: entity.id } });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="shortName" label={t("shortName")}>
          <Input id="shortName" name="shortName" required maxLength={60} defaultValue={entity.shortName} />
        </Field>
        <Field name="legalName" label={t("legalName")}>
          <Input id="legalName" name="legalName" required minLength={2} maxLength={200} defaultValue={entity.legalName} />
        </Field>
        <Field name="legalRepresentative" label={t("legalRepresentative")}>
          <Input id="legalRepresentative" name="legalRepresentative" maxLength={120} defaultValue={entity.legalRepresentative ?? ""} />
        </Field>
        <Field name="taxCode" label={t("taxCode")}>
          <Input id="taxCode" name="taxCode" maxLength={20} defaultValue={entity.taxCode ?? ""} />
        </Field>
        <Field name="insuranceUnitCode" label={t("insuranceUnitCode")}>
          <Input id="insuranceUnitCode" name="insuranceUnitCode" maxLength={30} defaultValue={entity.insuranceUnitCode ?? ""} />
        </Field>
        <Field name="wageRegion" label={t("wageRegion")}>
          <WageRegionSelect defaultValue={entity.wageRegion} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field name="address" label={t("address")}>
            <Input id="address" name="address" maxLength={300} defaultValue={entity.address ?? ""} />
          </Field>
        </div>
      </div>
      <ActiveCheckbox defaultChecked={entity.isActive} label={t("active")} />
      <FormError namespace="entities.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export function BranchForm({ entityId, branch }: { entityId: string; branch?: BranchRow }) {
  const t = useTranslations("entities");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(branch ? updateBranchAction : createBranchAction, {
    extra: branch ? { id: branch.id } : { entityId },
    onSuccess: () => (branch ? undefined : form.current?.reset()),
  });
  const suffix = branch?.id ?? "new";

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
        <Field name={`branch-name-${suffix}`} label={t("branchName")}>
          <Input id={`branch-name-${suffix}`} name="name" required maxLength={120} defaultValue={branch?.name} />
        </Field>
        <Field name={`branch-address-${suffix}`} label={t("address")}>
          <Input id={`branch-address-${suffix}`} name="address" maxLength={300} defaultValue={branch?.address ?? ""} />
        </Field>
        {branch ? <ActiveCheckbox defaultChecked={branch.isActive} label={t("active")} /> : null}
        <Button type="submit" variant={branch ? "outline" : "default"} disabled={pending}>
          {branch ? t("save") : t("addBranch")}
        </Button>
      </div>
      <FormError namespace="entities.errors" errorKey={errorKey} />
    </form>
  );
}
