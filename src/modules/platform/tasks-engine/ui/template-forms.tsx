"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addTemplateItemAction, removeTemplateItemAction, saveTemplateAction } from "../actions";
import { ASSIGNEE_RULES } from "../engine/checklist";

type Option = { id: string; name: string };
export type TemplateOptions = { entities: Option[]; departments: Option[]; positions: Option[]; people: { id: string; fullName: string }[]; canShare: boolean };
type Template = { id: string; purpose: string; name: string; entityId: string | null; departmentId: string | null; positionId: string | null; isActive: boolean };

const PURPOSES = ["onboarding", "offboarding"] as const;

export function TemplateForm({ template, options }: { template?: Template; options: TemplateOptions }) {
  const t = useTranslations("checklists");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, saved } = useActionForm(saveTemplateAction, { extra: { templateId: template?.id ?? "" }, onSuccess: () => (template ? undefined : form.current?.reset()) });
  const pick = (name: "entityId" | "departmentId" | "positionId", list: Option[], allowAll: boolean) => (
    <Field name={name} label={t(`fields.${name}`)}>
      <Select id={name} name={name} defaultValue={template?.[name] ?? ""} required={!allowAll}>
        {allowAll ? <option value="">{t("everyone")}</option> : null}
        {list.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label={t("fields.name")}>
          <Input id="name" name="name" required maxLength={120} defaultValue={template?.name} />
        </Field>
        <Field name="purpose" label={t("fields.purpose")}>
          <Select id="purpose" name="purpose" defaultValue={template?.purpose ?? "onboarding"}>
            {PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {t(`purpose.${purpose}`)}
              </option>
            ))}
          </Select>
        </Field>
        {pick("entityId", options.entities, options.canShare)}
        {pick("departmentId", options.departments, true)}
        {pick("positionId", options.positions, true)}
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" name="isActive" defaultChecked={template?.isActive ?? true} /> {t("fields.isActive")}
        </label>
      </div>
      <FormError namespace="checklists.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {template ? t("save") : t("create")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export function TemplateItemForm({ templateId, people, nextOrder }: { templateId: string; people: TemplateOptions["people"]; nextOrder: number }) {
  const t = useTranslations("checklists");
  const form = useRef<HTMLFormElement>(null);
  const [rule, setRule] = useState<string>("permission");
  const { onSubmit, pending, errorKey } = useActionForm(addTemplateItemAction, { extra: { templateId, sortOrder: nextOrder }, onSuccess: () => form.current?.reset() });
  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Field name="title" label={t("fields.title")}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
        </div>
        <Field name="rule" label={t("fields.rule")}>
          <Select id="rule" name="rule" value={rule} onChange={(event) => setRule(event.target.value)}>
            {ASSIGNEE_RULES.map((value) => (
              <option key={value} value={value}>
                {t(`rule.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {rule === "person" ? (
          <Field name="assigneePersonId" label={t("fields.assigneePersonId")}>
            <Select id="assigneePersonId" name="assigneePersonId" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field name="dueOffsetDays" label={t("fields.dueOffsetDays")}>
          <Input id="dueOffsetDays" name="dueOffsetDays" type="number" required defaultValue={0} min={-365} max={365} />
        </Field>
        <div className="lg:col-span-3">
          <Field name="description" label={t("fields.description")}>
            <Input id="description" name="description" maxLength={1000} />
          </Field>
        </div>
      </div>
      <FormError namespace="checklists.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {t("addItem")}
        </Button>
      </div>
    </form>
  );
}

export function RemoveItemButton({ itemId }: { itemId: string }) {
  const t = useTranslations("checklists");
  const { onSubmit, pending } = useActionForm(removeTemplateItemAction, { extra: { itemId } });
  return (
    <form onSubmit={onSubmit}>
      <Button type="submit" size="xs" variant="ghost" disabled={pending}>
        {t("removeItem")}
      </Button>
    </form>
  );
}
