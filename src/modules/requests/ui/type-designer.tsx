"use client";
// The form designer (FR-REQ-01): a request type's name, its fields and their validation, and the
// conditions that decide which field is shown. The *flow* is edited on the same screen by the
// approval engine's own `FlowEditor` — one idea, one editor, no second flow store.
//
// Everything is checked here by the very engine the server uses, so "save" is refused for the same
// reasons in both places and the designer sees why before a round trip.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Condition } from "@/modules/platform/approvals/engine/flow";
import { FIELD_TYPES, type FieldType, type FormDefinition, type FormField, formProblems } from "../engine/form";
import { REQUEST_CATEGORIES } from "../enums";
import { saveRequestTypeAction, setRequestTypeActiveAction } from "../actions";

type Editable = FormField & { options: NonNullable<FormField["options"]> };
const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const;

const needsOptions = (type: FieldType) => type === "select" || type === "multi_select";
const blankField = (index: number): Editable => ({ key: `field_${index + 1}`, type: "text", labelVi: "", labelEn: "", options: [], required: false });

export type TypeDraft = {
  id: string | null;
  code: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
  category: string;
  entityId: string | null;
  icon: string | null;
  sortOrder: number;
  active: boolean;
  slaRemindAfterDays: number;
  slaEscalateAfterDays: number;
  slaEscalateTo: Record<string, unknown> | null;
  form: FormDefinition;
};

export function TypeDesigner({ draft, entities, canGroup }: { draft: TypeDraft; entities: { id: string; name: string }[]; canGroup: boolean }) {
  const t = useTranslations("requests.designer");
  const tErrors = useTranslations("requests.errors");
  const router = useRouter();
  const [type, setType] = useState(draft);
  const [fields, setFields] = useState<Editable[]>(() => draft.form.fields.map((field) => ({ ...field, options: [...(field.options ?? [])] })));
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const problems = formProblems({ fields });
  const patch = (index: number, change: Partial<Editable>) => setFields((current) => current.map((field, position) => (position === index ? { ...field, ...change } : field)));
  const move = (index: number, by: number) =>
    setFields((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const set = <Key extends keyof TypeDraft>(key: Key, value: TypeDraft[Key]) => setType((current) => ({ ...current, [key]: value }));
  // A condition may only name a field above it, so the picker offers exactly those.
  const sourcesFor = (index: number) => fields.slice(0, index).map((field) => field.key);

  function save() {
    setSaved(false);
    startTransition(async () => {
      const result = await saveRequestTypeAction({
        ...type,
        id: type.id ?? "",
        entityId: type.entityId ?? "",
        icon: type.icon ?? "",
        descriptionVi: type.descriptionVi ?? "",
        descriptionEn: type.descriptionEn ?? "",
        active: type.active,
        slaEscalateTo: JSON.stringify(type.slaEscalateTo),
        form: JSON.stringify({ fields: fields.map(({ options, ...field }) => (needsOptions(field.type) ? { ...field, options } : field)) }),
      });
      if (result.ok) {
        setErrorKey(null);
        setSaved(true);
        if (!type.id) router.push(`/admin/request-types/${result.data.id}`);
        else router.refresh();
      } else setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{t("basics")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="code">{t("code")}</Label>
            <Input id="code" value={type.code} disabled={!!type.id} onChange={(event) => set("code", event.target.value)} placeholder="purchase" />
            {type.id ? <span className="text-xs text-muted-foreground">{t("codeFixed")}</span> : null}
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="category">{t("category")}</Label>
            <Select id="category" value={type.category} onChange={(event) => set("category", event.target.value)}>
              {REQUEST_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`categories.${category}` as "categories.other")}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="nameVi">{t("nameVi")}</Label>
            <Input id="nameVi" value={type.nameVi} onChange={(event) => set("nameVi", event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="nameEn">{t("nameEn")}</Label>
            <Input id="nameEn" value={type.nameEn} onChange={(event) => set("nameEn", event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="descriptionVi">{t("descriptionVi")}</Label>
            <Input id="descriptionVi" value={type.descriptionVi ?? ""} onChange={(event) => set("descriptionVi", event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="descriptionEn">{t("descriptionEn")}</Label>
            <Input id="descriptionEn" value={type.descriptionEn ?? ""} onChange={(event) => set("descriptionEn", event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="entityId">{t("entity")}</Label>
            <Select id="entityId" value={type.entityId ?? ""} onChange={(event) => set("entityId", event.target.value || null)}>
              {canGroup ? <option value="">{t("wholeGroup")}</option> : null}
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="sortOrder">{t("sortOrder")}</Label>
            <Input id="sortOrder" type="number" min={0} max={999} value={type.sortOrder} onChange={(event) => set("sortOrder", Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <div>
          <h2 className="text-sm font-medium">{t("sla")}</h2>
          <p className="text-xs text-muted-foreground">{t("slaHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="remind">{t("remindAfter")}</Label>
            <Input id="remind" type="number" min={0} max={90} value={type.slaRemindAfterDays} onChange={(event) => set("slaRemindAfterDays", Number(event.target.value))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="escalate">{t("escalateAfter")}</Label>
            <Input id="escalate" type="number" min={0} max={180} value={type.slaEscalateAfterDays} onChange={(event) => set("slaEscalateAfterDays", Number(event.target.value))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label htmlFor="escalateTo">{t("escalateTo")}</Label>
            <Select
              id="escalateTo"
              value={typeof type.slaEscalateTo?.rule === "string" ? String(type.slaEscalateTo.rule) : ""}
              onChange={(event) => set("slaEscalateTo", event.target.value === "" ? null : event.target.value === "manager_level" ? { rule: "manager_level", level: 2 } : { rule: event.target.value })}
            >
              <option value="">{t("escalateNobody")}</option>
              <option value="manager_level">{t("escalateManagerLevel")}</option>
              <option value="department_head">{t("escalateDepartmentHead")}</option>
            </Select>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("fields", { count: fields.length })}</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setFields((current) => [...current, blankField(current.length)])}>
            {t("addField")}
          </Button>
        </div>
        {fields.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFields")}</p> : null}
        <ul className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <li key={index} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("moveUp")}>
                  ↑
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={index === fields.length - 1} onClick={() => move(index, 1)} aria-label={t("moveDown")}>
                  ↓
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setFields((current) => current.filter((_, position) => position !== index))}>
                  {t("removeField")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="flex flex-col gap-1.5">
                  <Label htmlFor={`key-${index}`}>{t("fieldKey")}</Label>
                  <Input id={`key-${index}`} value={field.key} onChange={(event) => patch(index, { key: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <Label htmlFor={`type-${index}`}>{t("fieldType")}</Label>
                  <Select id={`type-${index}`} value={field.type} onChange={(event) => patch(index, { type: event.target.value as FieldType })}>
                    {FIELD_TYPES.map((fieldType) => (
                      <option key={fieldType} value={fieldType}>
                        {t(`types.${fieldType}` as "types.text")}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <Label htmlFor={`labelVi-${index}`}>{t("fieldLabelVi")}</Label>
                  <Input id={`labelVi-${index}`} value={field.labelVi} onChange={(event) => patch(index, { labelVi: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <Label htmlFor={`labelEn-${index}`}>{t("fieldLabelEn")}</Label>
                  <Input id={`labelEn-${index}`} value={field.labelEn} onChange={(event) => patch(index, { labelEn: event.target.value })} />
                </label>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Label className="flex items-center gap-1.5 text-sm font-normal">
                  <input type="checkbox" className="size-4" checked={!!field.required} onChange={(event) => patch(index, { required: event.target.checked })} />
                  {t("required")}
                </Label>
                {field.type === "number" || field.type === "money" || field.type === "multi_select" ? (
                  <>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`min-${index}`}>{t("min")}</Label>
                      <Input id={`min-${index}`} className="w-28" type="number" value={field.min ?? ""} onChange={(event) => patch(index, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`max-${index}`}>{t("max")}</Label>
                      <Input id={`max-${index}`} className="w-28" type="number" value={field.max ?? ""} onChange={(event) => patch(index, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                    </label>
                  </>
                ) : null}
                {field.type === "date" ? (
                  <>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`minDate-${index}`}>{t("minDate")}</Label>
                      <Input id={`minDate-${index}`} type="date" value={field.minDate ?? ""} onChange={(event) => patch(index, { minDate: event.target.value || null })} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`maxDate-${index}`}>{t("maxDate")}</Label>
                      <Input id={`maxDate-${index}`} type="date" value={field.maxDate ?? ""} onChange={(event) => patch(index, { maxDate: event.target.value || null })} />
                    </label>
                  </>
                ) : null}
                {field.type === "text" || field.type === "textarea" ? (
                  <>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`minLength-${index}`}>{t("minLength")}</Label>
                      <Input id={`minLength-${index}`} className="w-28" type="number" min={0} value={field.minLength ?? ""} onChange={(event) => patch(index, { minLength: event.target.value === "" ? null : Number(event.target.value) })} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <Label htmlFor={`maxLength-${index}`}>{t("maxLength")}</Label>
                      <Input id={`maxLength-${index}`} className="w-28" type="number" min={1} value={field.maxLength ?? ""} onChange={(event) => patch(index, { maxLength: event.target.value === "" ? null : Number(event.target.value) })} />
                    </label>
                  </>
                ) : null}
                {field.type === "text" ? (
                  <label className="flex flex-col gap-1.5">
                    <Label htmlFor={`pattern-${index}`}>{t("pattern")}</Label>
                    <Input id={`pattern-${index}`} className="w-48 font-mono" value={field.pattern ?? ""} onChange={(event) => patch(index, { pattern: event.target.value || null })} placeholder="\d{4}" />
                  </label>
                ) : null}
              </div>

              {needsOptions(field.type) ? (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{t("options")}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => patch(index, { options: [...field.options, { value: `option_${field.options.length + 1}`, labelVi: "", labelEn: "" }] })}>
                      {t("addOption")}
                    </Button>
                  </div>
                  {field.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="grid gap-2 sm:grid-cols-4">
                      <Input aria-label={t("optionValue")} value={option.value} onChange={(event) => patch(index, { options: field.options.map((entry, position) => (position === optionIndex ? { ...entry, value: event.target.value } : entry)) })} />
                      <Input aria-label={t("optionLabelVi")} value={option.labelVi} onChange={(event) => patch(index, { options: field.options.map((entry, position) => (position === optionIndex ? { ...entry, labelVi: event.target.value } : entry)) })} />
                      <Input aria-label={t("optionLabelEn")} value={option.labelEn} onChange={(event) => patch(index, { options: field.options.map((entry, position) => (position === optionIndex ? { ...entry, labelEn: event.target.value } : entry)) })} />
                      <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => patch(index, { options: field.options.filter((_, position) => position !== optionIndex) })}>
                        {t("removeOption")}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="toolbar">
                <label className="flex flex-col gap-1.5">
                  <Label htmlFor={`when-${index}`}>{t("shownWhen")}</Label>
                  <Select
                    id={`when-${index}`}
                    value={field.visibleWhen?.field ?? ""}
                    onChange={(event) => patch(index, { visibleWhen: event.target.value === "" ? null : { field: event.target.value, op: field.visibleWhen?.op ?? "eq", value: field.visibleWhen?.value ?? "" } })}
                  >
                    <option value="">{t("alwaysShown")}</option>
                    {sourcesFor(index).map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </Select>
                </label>
                {field.visibleWhen ? (
                  <>
                    <Select className="w-24" aria-label={t("operator")} value={field.visibleWhen.op} onChange={(event) => patch(index, { visibleWhen: { ...field.visibleWhen!, op: event.target.value as Condition["op"] } })}>
                      {OPS.map((op) => (
                        <option key={op} value={op}>
                          {t(`ops.${op}` as "ops.eq")}
                        </option>
                      ))}
                    </Select>
                    <Input
                      className="w-40"
                      aria-label={t("conditionValue")}
                      value={String(field.visibleWhen.value ?? "")}
                      onChange={(event) => patch(index, { visibleWhen: { ...field.visibleWhen!, value: conditionValue(field.visibleWhen!.op, event.target.value) } })}
                    />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {problems.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-destructive" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{tErrors.has(`form_${problem}`) ? tErrors(`form_${problem}` as "generic") : problem}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || problems.length > 0}>
          {t("save")}
        </Button>
        {type.id ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setRequestTypeActiveAction({ id: type.id, active: !type.active });
                set("active", !type.active);
                router.refresh();
              })
            }
          >
            {type.active ? t("switchOff") : t("switchOn")}
          </Button>
        ) : null}
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
        {errorKey ? (
          <span role="alert" className="text-sm text-destructive">
            {tErrors.has(errorKey) ? tErrors(errorKey as "generic") : tErrors("generic")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// What was typed as a condition's value, as the type the engine compares with — the same reading
// the flow editor uses, so "true" is a tick and "3" is a number in both places.
function conditionValue(op: Condition["op"], text: string): Condition["value"] {
  const one = (part: string) => (part.trim() !== "" && !Number.isNaN(Number(part)) ? Number(part) : part.trim());
  if (op === "in") return text.split(",").map(one);
  if (text === "true" || text === "false") return text === "true";
  return one(text);
}
