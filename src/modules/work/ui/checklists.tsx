"use client";
// The checklist library on screen: the library page's cards and editor, the picker the places a
// checklist hooks into share (hand-off packages, intake forms), and the stage hooks of a workflow.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteChecklistAction, saveChecklistAction, setStateChecklistsAction } from "../checklist-actions";
import { MAX_CHECKLIST_ITEMS, MAX_LINKED_CHECKLISTS } from "../engine/checklists";

type Result = { ok: boolean; error?: string; message?: string };
export type ChecklistChoice = { id: string; name: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

// ── The library page ────────────────────────────────────────────────────────────────────────

export type ChecklistCard = {
  id: string;
  name: string;
  description: string | null;
  /** "unit:<id>" | "team:<id>" | "" (company-wide). */
  owner: string;
  ownerName: string | null;
  items: { id: string; text: string; linkUrl?: string }[];
  isActive: boolean;
  canManage: boolean;
  usage: { stages: number; packages: number; forms: number; steps: number };
};
/** Where a checklist may be filed, as the viewer may file it: "" = company-wide. */
export type OwnerChoice = { value: string; name: string };

export function ChecklistLibrary({ checklists, owners, canCreate }: { checklists: ChecklistCard[]; owners: OwnerChoice[]; canCreate: boolean }) {
  const t = useTranslations("checklists.library");
  const [filter, setFilter] = useState("");
  const usageText = (usage: ChecklistCard["usage"]) =>
    (["stages", "packages", "forms", "steps"] as const)
      .filter((part) => usage[part] > 0)
      .map((part) => t(`usage.${part}`, { count: usage[part] }))
      .join(" · ");
  const shown = filter ? checklists.filter((list) => list.owner === filter) : checklists;
  const ownersShown = [...new Map(checklists.map((list) => [list.owner, list.ownerName ?? t("companyWide")])).entries()];
  return (
    <div className="flex flex-col gap-3">
      {ownersShown.length > 1 ? (
        <Select aria-label={t("filterOwner")} value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full sm:w-72">
          <option value="">{t("allOwners")}</option>
          {ownersShown.map(([value, name]) => (
            <option key={value || "company"} value={value}>
              {name}
            </option>
          ))}
        </Select>
      ) : null}
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {shown.map((list) => (
          <li key={list.id} className="rounded-xl border p-3 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{list.name}</span>
                <span className="text-muted-foreground">{list.ownerName ?? t("companyWide")}</span>
                <span className="text-xs text-muted-foreground">{t("itemCount", { count: list.items.length })}</span>
                {usageText(list.usage) ? <span className="text-xs text-muted-foreground">{t("usedBy", { list: usageText(list.usage) })}</span> : null}
                {list.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
              </summary>
              <div className="pt-3">
                {list.canManage ? (
                  <ChecklistEditor checklist={list} owners={owners.some((owner) => owner.value === list.owner) ? owners : [{ value: list.owner, name: list.ownerName ?? t("companyWide") }, ...owners]} />
                ) : (
                  <ChecklistReadOnly checklist={list} />
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {canCreate && owners.length > 0 ? (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("create")}</summary>
          <div className="pt-3">
            <ChecklistEditor owners={owners} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ChecklistReadOnly({ checklist }: { checklist: ChecklistCard }) {
  const t = useTranslations("checklists.library");
  return (
    <div className="flex flex-col gap-2">
      {checklist.description ? <p className="text-muted-foreground">{checklist.description}</p> : null}
      <ul className="flex flex-col gap-1">
        {checklist.items.map((item) => (
          <li key={item.id} className="flex flex-wrap gap-x-2">
            <span aria-hidden>☐</span>
            <span>{item.text}</span>
            {item.linkUrl ? (
              <a href={item.linkUrl} className="text-xs underline underline-offset-2">
                {t("guide")}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const newRowId = () => Math.random().toString(36).slice(2, 10);

function ChecklistEditor({ checklist, owners }: { checklist?: ChecklistCard; owners: OwnerChoice[] }) {
  const t = useTranslations("checklists.library");
  const { run, pending, errorKey } = useRun();
  const blankRow = () => ({ row: newRowId(), id: "", text: "", linkUrl: "" });
  const [items, setItems] = useState(() => (checklist?.items.length ? checklist.items.map((item) => ({ row: item.id, id: item.id, text: item.text, linkUrl: item.linkUrl ?? "" })) : [blankRow(), blankRow(), blankRow()]));
  const key = checklist?.id ?? "new";
  const setItem = (index: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setItems(next);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        run(
          () =>
            saveChecklistAction({
              checklistId: checklist?.id ?? "",
              name: data.get("name"),
              description: data.get("description"),
              owner: data.get("owner"),
              items: items.map((item) => ({ id: item.id, text: item.text, linkUrl: item.linkUrl })),
              isActive: data.get("isActive") === "on",
            }),
          () => {
            if (!checklist) {
              form.reset();
              setItems([blankRow(), blankRow(), blankRow()]);
            }
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`name-${key}`}>{t("name")}</Label>
          <Input id={`name-${key}`} name="name" required maxLength={120} defaultValue={checklist?.name ?? ""} placeholder={t("namePlaceholder")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`owner-${key}`}>{t("owner")}</Label>
          <Select id={`owner-${key}`} name="owner" defaultValue={checklist?.owner ?? owners[0]?.value ?? ""}>
            {owners.map((owner) => (
              <option key={owner.value || "company"} value={owner.value}>
                {owner.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`description-${key}`}>{t("description")}</Label>
        <textarea id={`description-${key}`} name="description" maxLength={1000} defaultValue={checklist?.description ?? ""} placeholder={t("descriptionPlaceholder")} className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("items")}</legend>
        {items.map((item, index) => (
          <div key={item.row} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <Input aria-label={t("itemText")} value={item.text} maxLength={200} placeholder={t("itemText")} onChange={(event) => setItem(index, { text: event.target.value })} className="min-w-0 flex-[2_1_14rem]" />
            <Input aria-label={t("itemLink")} value={item.linkUrl} maxLength={500} placeholder={t("itemLink")} onChange={(event) => setItem(index, { linkUrl: event.target.value })} className="min-w-0 flex-[1_1_10rem]" />
            <div className="flex">
              <Button type="button" size="sm" variant="ghost" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={t("moveDown")} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                ↓
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={t("removeItem")} onClick={() => setItems(items.filter((_, at) => at !== index))}>
                ×
              </Button>
            </div>
          </div>
        ))}
        {items.length < MAX_CHECKLIST_ITEMS ? (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setItems([...items, blankRow()])}>
            {t("addItem")}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("itemsHint")}</p>
      </fieldset>

      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={checklist?.isActive ?? true} /> {t("active")}
      </label>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {checklist ? t("save") : t("create")}
        </Button>
        {checklist ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("deleteConfirm"))) run(() => deleteChecklistAction({ checklistId: checklist.id }));
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// ── Picking checklists for a package or an intake form ──────────────────────────────────────

/**
 * Checkboxes named `name` (default "checklistIds[]", which `useActionForm` collects into a list).
 * Only active checklists are offered: one chosen before and since retired asks for nothing any
 * more, and saving the form drops it.
 */
export function ChecklistPicker({ choices, selected, name = "checklistIds[]", legend }: { choices: ChecklistChoice[]; selected: readonly string[]; name?: string; legend?: string }) {
  const t = useTranslations("checklists.library");
  if (choices.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1 text-sm font-medium">{legend ?? t("pickLegend")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {choices.map((choice) => (
          <label key={choice.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name={name} value={choice.id} defaultChecked={selected.includes(choice.id)} />
            {choice.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("pickHint", { max: MAX_LINKED_CHECKLISTS })}</p>
    </fieldset>
  );
}

// ── A workflow's stage hooks ────────────────────────────────────────────────────────────────

export type StageHookView = { stateId: string; checklistId: string; required: boolean };

/** Per stage of the team's workflow: the checklists entering it adds, and which of them hold the task there until ticked. */
export function StageChecklists({ states, hooks, choices, canManage }: { states: { id: string; name: string }[]; hooks: StageHookView[]; choices: ChecklistChoice[]; canManage: boolean }) {
  const t = useTranslations("checklists.stages");
  const { run, pending, errorKey } = useRun();
  const nameOf = (id: string) => choices.find((choice) => choice.id === id)?.name ?? t("retired");
  const save = (stateId: string, next: { checklistId: string; required: boolean }[]) => run(() => setStateChecklistsAction({ stateId, hooks: next }));
  const shown = canManage ? states : states.filter((state) => hooks.some((hook) => hook.stateId === state.id));
  if (!canManage && shown.length === 0) return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <FormError namespace="work.errors" errorKey={errorKey} />
      <ul className="flex flex-col divide-y rounded-xl border">
        {shown.map((state) => {
          const own = hooks.filter((hook) => hook.stateId === state.id).map(({ checklistId, required }) => ({ checklistId, required }));
          const addable = choices.filter((choice) => !own.some((hook) => hook.checklistId === choice.id));
          return (
            <li key={state.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-40 shrink-0 font-medium">{state.name}</span>
                {own.length === 0 ? <span className="text-xs text-muted-foreground">{t("noneHere")}</span> : null}
                {own.map((hook) => (
                  <span key={hook.checklistId} className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5">
                    {nameOf(hook.checklistId)}
                    {canManage ? (
                      <>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input type="checkbox" checked={hook.required} disabled={pending} onChange={() => save(state.id, own.map((row) => (row.checklistId === hook.checklistId ? { ...row, required: !row.required } : row)))} />
                          {t("required")}
                        </label>
                        <button type="button" className="text-xs text-muted-foreground hover:text-destructive" aria-label={t("remove")} disabled={pending} onClick={() => save(state.id, own.filter((row) => row.checklistId !== hook.checklistId))}>
                          ×
                        </button>
                      </>
                    ) : hook.required ? (
                      <Badge variant="secondary">{t("required")}</Badge>
                    ) : null}
                  </span>
                ))}
                {canManage && addable.length > 0 && own.length < MAX_LINKED_CHECKLISTS ? (
                  <Select
                    aria-label={t("add")}
                    value=""
                    disabled={pending}
                    onChange={(event) => {
                      if (event.target.value) save(state.id, [...own, { checklistId: event.target.value, required: false }]);
                    }}
                    className="w-full sm:w-56"
                  >
                    <option value="">{t("add")}</option>
                    {addable.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
