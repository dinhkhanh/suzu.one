"use client";
// The pipeline's stages (FR-CRM-12) and the rate card (FR-CRM-20): `crm:manage` over the group, an
// entity's own price over that entity.
import { useTranslations } from "next-intl";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CHANNELS, CONTENT_FORMATS } from "../../work/client";
import { SERVICE_LINES, SERVICE_UNITS, STAGE_CATEGORIES, STAGE_GATES } from "../enums";
import { saveServiceAction, saveStageAction, setPriceAction } from "../quote-actions";
import { CrmForm, type Named } from "./common";

type StageValues = { id: string; name: string; nameEn: string | null; category: string; probability: number; gates: string[]; allowsPitch: boolean; sortOrder: number; isActive: boolean };

export function StageForm({ stage, nextOrder }: { stage?: StageValues; nextOrder: number }) {
  const t = useTranslations("crm.settings");
  const tEnums = useTranslations("crm.enums");
  const id = stage?.id ?? "new";
  return (
    <CrmForm action={saveStageAction} extra={{ stageId: stage?.id ?? "" }} submit={stage ? t("save") : t("addStage")}>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field name="name" label={t("fields.name")}>
          <Input id={`s-name-${id}`} name="name" required maxLength={80} defaultValue={stage?.name ?? ""} />
        </Field>
        <Field name="nameEn" label={t("fields.nameEn")}>
          <Input id={`s-name-en-${id}`} name="nameEn" maxLength={80} defaultValue={stage?.nameEn ?? ""} />
        </Field>
        <Field name="category" label={t("fields.category")}>
          <Select id={`s-cat-${id}`} name="category" defaultValue={stage?.category ?? "open"}>
            {STAGE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {tEnums(`stageCategory.${category}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="probability" label={t("fields.probability")}>
          <Input id={`s-prob-${id}`} name="probability" type="number" min={0} max={100} required defaultValue={stage?.probability ?? 50} />
        </Field>
        <Field name="sortOrder" label={t("fields.sortOrder")}>
          <Input id={`s-order-${id}`} name="sortOrder" type="number" min={0} max={10000} required defaultValue={stage?.sortOrder ?? nextOrder} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="mb-1 text-sm font-medium">{t("fields.gates")}</legend>
        {STAGE_GATES.map((gate) => (
          <label key={gate} className="flex items-center gap-1.5">
            <Checkbox name="gates[]" value={gate} defaultChecked={stage?.gates.includes(gate)} /> {tEnums(`gate.${gate}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox name="allowsPitch" defaultChecked={stage?.allowsPitch} /> {t("fields.allowsPitch")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox name="isActive" defaultChecked={stage?.isActive ?? true} /> {t("fields.isActive")}
        </label>
      </div>
    </CrmForm>
  );
}

type ServiceValues = { id: string; code: string; name: string; nameEn: string | null; category: string; unit: string; isRecurring: boolean; format: string | null; channel: string | null; roleMinutes: { role: string; minutes: number }[]; description: string | null; isActive: boolean };

export function ServiceForm({ service }: { service?: ServiceValues }) {
  const t = useTranslations("crm.rateCard");
  const tEnums = useTranslations("crm.enums");
  const tFormats = useTranslations("work.formats");
  const tChannels = useTranslations("work.channels");
  const id = service?.id ?? "new";
  const roles = [...(service?.roleMinutes ?? []), { role: "", minutes: 0 }, { role: "", minutes: 0 }];
  return (
    <CrmForm action={saveServiceAction} extra={{ serviceId: service?.id ?? "" }} submit={service ? t("save") : t("addService")}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="code" label={t("fields.code")}>
          <Input id={`sv-code-${id}`} name="code" required maxLength={30} className="uppercase" defaultValue={service?.code ?? ""} />
        </Field>
        <Field name="name" label={t("fields.name")}>
          <Input id={`sv-name-${id}`} name="name" required maxLength={200} defaultValue={service?.name ?? ""} />
        </Field>
        <Field name="nameEn" label={t("fields.nameEn")}>
          <Input id={`sv-name-en-${id}`} name="nameEn" maxLength={200} defaultValue={service?.nameEn ?? ""} />
        </Field>
        <Field name="category" label={t("fields.category")}>
          <Select id={`sv-cat-${id}`} name="category" defaultValue={service?.category ?? "social"}>
            {SERVICE_LINES.map((line) => (
              <option key={line} value={line}>
                {tEnums(`serviceLine.${line}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="unit" label={t("fields.unit")}>
          <Select id={`sv-unit-${id}`} name="unit" defaultValue={service?.unit ?? "item"}>
            {SERVICE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {tEnums(`unit.${unit}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="format" label={t("fields.format")}>
          <Select id={`sv-format-${id}`} name="format" defaultValue={service?.format ?? ""}>
            <option value="">—</option>
            {CONTENT_FORMATS.map((value) => (
              <option key={value} value={value}>
                {tFormats(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="channel" label={t("fields.channel")}>
          <Select id={`sv-channel-${id}`} name="channel" defaultValue={service?.channel ?? ""}>
            <option value="">—</option>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {tChannels(value)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-2 pt-6 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox name="isRecurring" defaultChecked={service?.isRecurring} /> {t("fields.isRecurring")}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox name="isActive" defaultChecked={service?.isActive ?? true} /> {t("fields.isActive")}
          </label>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("fields.hoursPerUnit")}</legend>
        {roles.map((role, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-2">
            <Input name={`roles.${index}.role`} maxLength={80} defaultValue={role.role} placeholder={t("fields.role")} aria-label={t("fields.role")} />
            <Input name={`roles.${index}.hours`} inputMode="decimal" defaultValue={role.minutes ? String(Math.round((role.minutes / 60) * 100) / 100) : ""} placeholder={t("fields.hours")} aria-label={t("fields.hours")} />
          </div>
        ))}
      </fieldset>
      <Field name="description" label={t("fields.description")}>
        <Input id={`sv-desc-${id}`} name="description" maxLength={1000} defaultValue={service?.description ?? ""} />
      </Field>
    </CrmForm>
  );
}

export function PriceForm({ serviceId, entities, today }: { serviceId: string; entities: Named[]; today: string }) {
  const t = useTranslations("crm.rateCard");
  return (
    <CrmForm action={setPriceAction} extra={{ serviceId }} submit={t("setPrice")} className="flex flex-wrap items-end gap-3">
      <Field name="priceVnd" label={t("fields.price")}>
        <MoneyInput id={`price-${serviceId}`} name="priceVnd" required />
      </Field>
      <Field name="validFrom" label={t("fields.validFrom")}>
        <DatePicker id={`price-from-${serviceId}`} name="validFrom" required defaultValue={today} />
      </Field>
      <Field name="entityId" label={t("fields.priceScope")}>
        <Select id={`price-entity-${serviceId}`} name="entityId" defaultValue="">
          <option value="">{t("groupPrice")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}
