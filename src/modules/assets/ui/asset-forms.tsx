"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { assignAssetAction, confirmHandoverAction, registerAssetAction, returnAssetAction, saveAssetCategoryAction, setAssetStatusAction, updateAssetAction } from "../actions";
import { ASSET_CONDITIONS, ASSET_KINDS, ASSET_STATUSES, type AssetCondition, type HolderType } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export type AssetFormValue = {
  id: string | null;
  categoryId: string;
  entityId: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: string | null;
  condition: AssetCondition;
  location: string | null;
  notes: string | null;
};

export type RegisterOptions = {
  entities: { id: string; code: string; shortName: string | null }[];
  categories: { id: string; code: string; name: string; requiresSerial: boolean }[];
  people: { id: string; fullName: string }[];
  teams: { id: string; name: string }[];
  /** False when the viewer may not read the money: the price and supplier fields are not shown at all. */
  canSeeMoney: boolean;
};

export function AssetForm({ value, options }: { value: AssetFormValue; options: RegisterOptions }) {
  const t = useTranslations("assets.form");
  const tEnum = useTranslations("assets.enums");
  const router = useRouter();
  const action = value.id ? updateAssetAction : registerAssetAction;
  const form = useActionForm(action, { extra: value.id ? { assetId: value.id } : {}, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t("name")}>
          <Input id="name" name="name" defaultValue={value.name} required maxLength={200} />
        </Field>
        <Field name="categoryId" label={t("category")}>
          <Select id="categoryId" name="categoryId" defaultValue={value.categoryId} required>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} — {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="entityId" label={t("entity")}>
          <Select id="entityId" name="entityId" defaultValue={value.entityId} required>
            {options.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.shortName ?? entity.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="condition" label={t("condition")}>
          <Select id="condition" name="condition" defaultValue={value.condition}>
            {ASSET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {tEnum(`condition.${condition}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="brand" label={t("brand")}>
          <Input id="brand" name="brand" defaultValue={value.brand ?? ""} maxLength={80} />
        </Field>
        <Field name="model" label={t("model")}>
          <Input id="model" name="model" defaultValue={value.model ?? ""} maxLength={120} />
        </Field>
        <Field name="serial" label={t("serial")}>
          <Input id="serial" name="serial" defaultValue={value.serial ?? ""} maxLength={120} />
        </Field>
        <Field name="location" label={t("location")}>
          <Input id="location" name="location" defaultValue={value.location ?? ""} maxLength={200} />
        </Field>
        <Field name="purchaseDate" label={t("purchaseDate")}>
          <Input id="purchaseDate" name="purchaseDate" type="date" defaultValue={value.purchaseDate ?? ""} />
        </Field>
        <Field name="warrantyUntil" label={t("warrantyUntil")}>
          <Input id="warrantyUntil" name="warrantyUntil" type="date" defaultValue={value.warrantyUntil ?? ""} />
        </Field>
        {options.canSeeMoney ? (
          <>
            <Field name="purchasePrice" label={t("purchasePrice")}>
              <Input id="purchasePrice" name="purchasePrice" inputMode="numeric" defaultValue={value.purchasePrice ?? ""} />
            </Field>
            <Field name="supplier" label={t("supplier")}>
              <Input id="supplier" name="supplier" defaultValue={value.supplier ?? ""} maxLength={200} />
            </Field>
          </>
        ) : null}
      </div>
      <Field name="notes" label={t("notes")}>
        <textarea id="notes" name="notes" defaultValue={value.notes ?? ""} rows={3} maxLength={2000} className={textarea} />
      </Field>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {value.id ? t("save") : t("register")}
        </Button>
      </div>
      </FieldErrors>
    </form>
  );
}

export function AssignForm({ assetId, options }: { assetId: string; options: Pick<RegisterOptions, "people" | "teams" | "entities"> }) {
  const t = useTranslations("assets.assign");
  const tEnum = useTranslations("assets.enums");
  const router = useRouter();
  const [holderType, setHolderType] = useState<HolderType>("person");
  const form = useActionForm(assignAssetAction, { extra: { assetId }, onSuccess: () => router.refresh() });
  const holders = holderType === "person" ? options.people.map((row) => ({ id: row.id, label: row.fullName })) : holderType === "team" ? options.teams.map((row) => ({ id: row.id, label: row.name })) : options.entities.map((row) => ({ id: row.id, label: row.shortName ?? row.code }));

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="holderType" label={t("holderType")}>
          <Select id="holderType" name="holderType" value={holderType} onChange={(event) => setHolderType(event.target.value as HolderType)}>
            {(["person", "team", "entity"] as const).map((option) => (
              <option key={option} value={option}>
                {tEnum(`holder.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="holderId" label={t("holder")}>
          <Select id="holderId" name="holderId" required>
            <option value="">—</option>
            {holders.map((holder) => (
              <option key={holder.id} value={holder.id}>
                {holder.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="conditionOut" label={t("conditionOut")}>
          <Select id="conditionOut" name="conditionOut" defaultValue="good">
            {ASSET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {tEnum(`condition.${condition}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="dueBack" label={t("dueBack")}>
          <Input id="dueBack" name="dueBack" type="date" />
        </Field>
      </div>
      <Field name="purpose" label={t("purpose")}>
        <Input id="purpose" name="purpose" maxLength={500} />
      </Field>
      <Field name="accessories" label={t("accessories")}>
        <textarea id="accessories" name="accessories" rows={3} className={textarea} />
      </Field>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {t("submit")}
        </Button>
      </div>
      </FieldErrors>
    </form>
  );
}

/** The holder's own acknowledgement. It appears on their screen and nobody else's. */
export function ConfirmHandoverForm({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("assets.handover");
  const router = useRouter();
  const form = useActionForm(confirmHandoverAction, { extra: { assignmentId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
      <p className="text-sm text-muted-foreground">{t("declaration")}</p>
      <Field name="note" label={t("note")}>
        <Input id="note" name="note" maxLength={1000} />
      </Field>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {t("confirm")}
        </Button>
      </div>
      </FieldErrors>
    </form>
  );
}

export function ReturnForm({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("assets.return");
  const tEnum = useTranslations("assets.enums");
  const router = useRouter();
  const form = useActionForm(returnAssetAction, { extra: { assignmentId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="conditionIn" label={t("conditionIn")}>
          <Select id="conditionIn" name="conditionIn" defaultValue="good">
            {ASSET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {tEnum(`condition.${condition}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="location" label={t("location")}>
          <Input id="location" name="location" maxLength={200} />
        </Field>
      </div>
      <Field name="returnNote" label={t("note")}>
        <textarea id="returnNote" name="returnNote" rows={2} maxLength={1000} className={textarea} />
      </Field>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {t("submit")}
        </Button>
      </div>
      </FieldErrors>
    </form>
  );
}

export function StatusForm({ assetId, status }: { assetId: string; status: string }) {
  const t = useTranslations("assets.status");
  const tEnum = useTranslations("assets.enums");
  const router = useRouter();
  const form = useActionForm(setAssetStatusAction, { extra: { assetId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-end gap-3">
      <FieldErrors value={form.fieldErrors}>
      <Field name="status" label={t("status")}>
        <Select id="status" name="status" defaultValue={status}>
          {ASSET_STATUSES.filter((option) => option !== "assigned").map((option) => (
            <option key={option} value={option}>
              {tEnum(`status.${option}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="note" label={t("note")}>
        <Input id="note" name="note" maxLength={1000} />
      </Field>
      <Button type="submit" disabled={form.pending}>
        {t("submit")}
      </Button>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      </FieldErrors>
    </form>
  );
}

export type CategoryFormValue = { id: string | null; code: string; name: string; kind: string; requiresSerial: boolean; defaultWarrantyMonths: number | null; bookable: boolean; sortOrder: number; isActive: boolean };

export function CategoryForm({ value }: { value: CategoryFormValue }) {
  const t = useTranslations("assets.categories");
  const tEnum = useTranslations("assets.enums");
  const router = useRouter();
  const form = useActionForm(saveAssetCategoryAction, { extra: { categoryId: value.id ?? "" }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-md border p-4">
      <FieldErrors value={form.fieldErrors}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="code" label={t("code")}>
          <Input id={`code-${value.id ?? "new"}`} name="code" defaultValue={value.code} required maxLength={12} />
        </Field>
        <Field name="name" label={t("name")}>
          <Input id={`name-${value.id ?? "new"}`} name="name" defaultValue={value.name} required maxLength={120} />
        </Field>
        <Field name="kind" label={t("kind")}>
          <Select id={`kind-${value.id ?? "new"}`} name="kind" defaultValue={value.kind}>
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {tEnum(`kind.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="defaultWarrantyMonths" label={t("warrantyMonths")}>
          <Input id={`warranty-${value.id ?? "new"}`} name="defaultWarrantyMonths" inputMode="numeric" defaultValue={value.defaultWarrantyMonths ?? ""} />
        </Field>
        <Field name="sortOrder" label={t("sortOrder")}>
          <Input id={`sort-${value.id ?? "new"}`} name="sortOrder" inputMode="numeric" defaultValue={value.sortOrder} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="requiresSerial" defaultChecked={value.requiresSerial} /> {t("requiresSerial")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="bookable" defaultChecked={value.bookable} /> {t("bookable")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isActive" defaultChecked={value.isActive} /> {t("isActive")}
        </label>
      </div>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" disabled={form.pending}>
          {t("save")}
        </Button>
      </div>
      </FieldErrors>
    </form>
  );
}
