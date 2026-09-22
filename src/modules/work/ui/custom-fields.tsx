"use client";
// Custom fields in the browser (FR-PJM-35): one input per type, a read-only rendering, the
// list's filter controls, the task page's panel and the team's (or project's) field manager.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { updateTaskAction } from "../actions";
import { CUSTOM_FIELD_TYPES, type CustomFieldType, type CustomValue, currentValue, customKey, EMPTY, type FieldView, formatDuration, SET } from "../engine/custom-fields";
import type { TaskFilters } from "../engine/filter";
import { saveCustomFieldAction } from "../foundation-actions";

export type { FieldView };
type Person = { id: string; fullName: string };

const errorText = (t: ReturnType<typeof useTranslations<"work">>, key: string | null) => (key ? (t.has(`errors.${key}`) ? t(`errors.${key}`) : t("errors.generic")) : null);

/** The value as text: option labels, a person's name, "1h30", a local date. */
export function CustomValueText({ field, value, people }: { field: FieldView; value: unknown; people: Person[] }) {
  const t = useTranslations("work.customFields");
  const current = currentValue(field, value);
  if (current === null) return <span className="text-muted-foreground">{t("none")}</span>;
  switch (field.type) {
    case "select":
    case "multi_select":
      return (
        <span className="inline-flex flex-wrap gap-1">
          {(Array.isArray(current) ? current : [current as string]).map((id) => (
            <Badge key={id} variant="outline">
              {field.options.find((option) => option.id === id)?.label ?? id}
            </Badge>
          ))}
        </span>
      );
    case "person":
      return <span>{people.find((person) => person.id === current)?.fullName ?? t("none")}</span>;
    case "duration":
      return <span>{formatDuration(current as number)}</span>;
    case "checkbox":
      return <span>{current ? t("yes") : t("no")}</span>;
    case "date":
      return <span>{(current as string).split("-").reverse().join("/")}</span>;
    case "url":
      return (
        <a href={current as string} target="_blank" rel="noreferrer noopener" className="truncate underline">
          {(current as string).replace(/^https?:\/\//, "")}
        </a>
      );
    default:
      return <span>{String(current)}</span>;
  }
}

/**
 * An editor for one value. Text-like inputs commit on blur or Enter (one save per edit, not per
 * keystroke); choices commit at once. `onCommit(null)` clears the field.
 */
export function CustomValueInput({ field, value, people, disabled, onCommit, compact = false }: { field: FieldView; value: unknown; people: Person[]; disabled?: boolean; onCommit: (value: CustomValue) => void; compact?: boolean }) {
  const t = useTranslations("work.customFields");
  const current = currentValue(field, value);
  const size = compact ? "h-7 text-xs md:text-xs" : "";
  const commitText = (raw: string, previous: string) => {
    if (raw.trim() === previous) return;
    onCommit(raw.trim() === "" ? null : raw.trim());
  };
  switch (field.type) {
    case "select":
      return (
        <Select aria-label={field.name} value={(current as string | null) ?? ""} disabled={disabled} onChange={(event) => onCommit(event.target.value || null)} className={size}>
          <option value="">{t("none")}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    case "multi_select": {
      const chosen = (current as string[] | null) ?? [];
      return (
        <details className="relative">
          <summary className={`flex cursor-pointer list-none items-center gap-1 rounded-md border px-2 py-1 ${compact ? "text-xs" : "text-sm"} ${disabled ? "pointer-events-none opacity-60" : ""}`} aria-label={field.name}>
            {chosen.length ? chosen.map((id) => field.options.find((option) => option.id === id)?.label ?? id).join(", ") : t("choose")}
          </summary>
          <div className="absolute z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-md border bg-background p-2 shadow-md">
            {field.options.map((option) => (
              <label key={option.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={chosen.includes(option.id)} disabled={disabled} onChange={(event) => onCommit(event.target.checked ? [...chosen, option.id] : chosen.filter((id) => id !== option.id))} />
                {option.label}
              </label>
            ))}
          </div>
        </details>
      );
    }
    case "person":
      return (
        <Select aria-label={field.name} value={(current as string | null) ?? ""} disabled={disabled} onChange={(event) => onCommit(event.target.value || null)} className={size}>
          <option value="">{t("none")}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      );
    case "checkbox":
      return <input type="checkbox" aria-label={field.name} checked={current === true} disabled={disabled} onChange={(event) => onCommit(event.target.checked)} />;
    case "date":
      return <Input type="date" aria-label={field.name} defaultValue={(current as string | null) ?? ""} key={String(current)} disabled={disabled} onChange={(event) => onCommit(event.target.value || null)} className={size} />;
    case "duration": {
      // Typed in hours ("1.5"), kept in whole minutes.
      const hours = current === null ? "" : String(Math.round(((current as number) / 60) * 100) / 100);
      return (
        <Input
          type="number"
          min={0}
          step={0.25}
          aria-label={`${field.name} (${t("hours")})`}
          placeholder={t("hours")}
          defaultValue={hours}
          key={hours}
          disabled={disabled}
          className={size}
          onBlur={(event) => (event.target.value === hours ? undefined : onCommit(event.target.value === "" ? null : Math.round(Number(event.target.value) * 60)))}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
      );
    }
    default: {
      const text = current === null ? "" : String(current);
      return (
        <Input
          type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
          step={field.type === "number" ? "any" : undefined}
          aria-label={field.name}
          placeholder={field.type === "url" ? t("urlPlaceholder") : undefined}
          maxLength={field.type === "url" ? 1000 : 500}
          defaultValue={text}
          key={text}
          disabled={disabled}
          className={size}
          onBlur={(event) => commitText(event.target.value, text)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
      );
    }
  }
}

/** One filter control per field, in the list's filter row. */
export function CustomFieldFilters({ fields, filters, setFilter, people }: { fields: FieldView[]; filters: TaskFilters; setFilter: (key: keyof TaskFilters, value: string) => void; people: Person[] }) {
  const t = useTranslations("work.customFields");
  const tList = useTranslations("work.list");
  return (
    <>
      {fields.map((field) => {
        const key = customKey(field.id) as keyof TaskFilters;
        const value = (filters[key] as string | undefined) ?? "";
        const special = [
          <option key="any" value="">
            {t("filterAny", { name: field.name })}
          </option>,
          <option key="empty" value={EMPTY}>
            {t("filterEmpty", { name: field.name })}
          </option>,
          <option key="set" value={SET}>
            {t("filterSet", { name: field.name })}
          </option>,
        ];
        if (field.type === "select" || field.type === "multi_select" || field.type === "person" || field.type === "checkbox") {
          const choices = field.type === "person" ? [{ id: "me", label: tList("me") }, ...people.map((person) => ({ id: person.id, label: person.fullName }))] : field.type === "checkbox" ? [{ id: "1", label: t("yes") }, { id: "0", label: t("no") }] : field.options;
          return (
            <Select key={field.id} aria-label={field.name} value={value} onChange={(event) => setFilter(key, event.target.value)} className="w-40">
              {special}
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </Select>
          );
        }
        return <Input key={field.id} type="search" aria-label={field.name} title={t("filterHint")} placeholder={t("filterPlaceholder", { name: field.name })} value={value} onChange={(event) => setFilter(key, event.target.value)} className="w-40" />;
      })}
    </>
  );
}

/** The task page's panel: every field of the task, edited in place. */
export function TaskCustomFields({ taskId, fields, values, people, canEdit }: { taskId: string; fields: FieldView[]; values: Record<string, unknown>; people: Person[]; canEdit: boolean }) {
  const t = useTranslations("work.customFields");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  if (fields.length === 0) return null;
  const commit = (fieldId: string, value: CustomValue) =>
    startTransition(async () => {
      const result = await updateTaskAction({ taskId, customValues: { [fieldId]: value } });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      router.refresh();
    });
  return (
    <section className="flex flex-col gap-2 border-t pt-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("panel")}</h2>
      {fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-1.5">
          <Label>{field.name}</Label>
          {canEdit ? <CustomValueInput field={field} value={values[field.id]} people={people} disabled={pending} onCommit={(value) => commit(field.id, value)} /> : <CustomValueText field={field} value={values[field.id]} people={people} />}
        </div>
      ))}
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(tWork, errorKey)}
        </p>
      ) : null}
    </section>
  );
}

/** The field list of a team (or of one project), with an editor per field for whoever may keep them. */
export function CustomFieldManager({ teamId, projectId, fields, canManage }: { teamId: string; projectId: string | null; fields: FieldView[]; canManage: boolean }) {
  const t = useTranslations("work.customFields");
  const [editing, setEditing] = useState<string | null>(null);
  const own = fields.filter((field) => field.projectId === projectId);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{projectId ? t("projectDescription") : t("description")}</p>
      {own.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {own.map((field) => (
          <li key={field.id} className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-medium ${field.isActive ? "" : "text-muted-foreground line-through"}`}>{field.name}</span>
              <Badge variant="outline">{t(`types.${field.type}`)}</Badge>
              {field.showOnCard ? <Badge variant="secondary">{t("onCard")}</Badge> : null}
              {field.isActive ? null : <Badge variant="secondary">{t("retired")}</Badge>}
              {field.options.length ? <span className="text-xs text-muted-foreground">{field.options.map((option) => option.label).join(" · ")}</span> : null}
              {canManage && editing !== field.id ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(field.id)}>
                  {t("edit")}
                </Button>
              ) : null}
            </div>
            {editing === field.id ? <CustomFieldForm teamId={teamId} projectId={projectId} field={field} onDone={() => setEditing(null)} /> : null}
          </li>
        ))}
      </ul>
      {canManage ? editing === "new" ? <CustomFieldForm teamId={teamId} projectId={projectId} onDone={() => setEditing(null)} /> : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing("new")}>
          {t("add")}
        </Button>
      ) : null}
    </div>
  );
}

function CustomFieldForm({ teamId, projectId, field, onDone }: { teamId: string; projectId: string | null; field?: FieldView; onDone: () => void }) {
  const t = useTranslations("work.customFields");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // Options keep their ids by label, so renaming nothing and reordering keeps every value.
    const lines = String(data.get("options") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const options = lines.map((label) => ({ id: field?.options.find((option) => option.label === label)?.id ?? null, label }));
    startTransition(async () => {
      const result = await saveCustomFieldAction({ fieldId: field?.id ?? null, teamId, projectId, name: data.get("name"), type, options, showOnCard: data.get("showOnCard") === "on", sortOrder: data.get("sortOrder"), isActive: data.get("isActive") === "on" });
      if (!result.ok) {
        setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
        return;
      }
      setErrorKey(null);
      if (result.data.cleared) setNotice(t("cleared", { count: result.data.cleared }));
      router.refresh();
      if (!result.data.cleared) onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`cf-name-${field?.id ?? "new"}`}>{t("name")}</Label>
        <Input id={`cf-name-${field?.id ?? "new"}`} name="name" required maxLength={60} defaultValue={field?.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`cf-type-${field?.id ?? "new"}`}>{t("type")}</Label>
        <Select id={`cf-type-${field?.id ?? "new"}`} value={type} disabled={!!field} title={field ? t("typeLocked") : undefined} onChange={(event) => setType(event.target.value as CustomFieldType)}>
          {CUSTOM_FIELD_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`types.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      {type === "select" || type === "multi_select" ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`cf-options-${field?.id ?? "new"}`}>{t("options")}</Label>
          <textarea id={`cf-options-${field?.id ?? "new"}`} name="options" rows={4} defaultValue={field?.options.map((option) => option.label).join("\n")} className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">{t("optionsHint")}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`cf-order-${field?.id ?? "new"}`}>{t("sortOrder")}</Label>
        <Input id={`cf-order-${field?.id ?? "new"}`} name="sortOrder" type="number" min={0} max={10000} defaultValue={field?.sortOrder ?? 0} />
      </div>
      <div className="flex flex-col justify-end gap-1.5 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="showOnCard" defaultChecked={field?.showOnCard ?? false} /> {t("showOnCard")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="isActive" defaultChecked={field?.isActive ?? true} /> {t("isActive")}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        {notice ? <span className="text-sm text-muted-foreground">{notice}</span> : null}
        {errorKey ? (
          <span role="alert" className="text-sm text-destructive">
            {errorText(tWork, errorKey)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
