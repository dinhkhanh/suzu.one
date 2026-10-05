"use client";
// The checklist library on screen: the library page's grid and editor, the picker the places a
// checklist hooks into share (hand-off packages, intake forms), and the stage hooks of a workflow.
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
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

/** The library as the reference grid: one row per checklist, which unfolds into its steps or its editor. */
export function ChecklistLibrary({ checklists, owners, canCreate }: { checklists: ChecklistCard[]; owners: OwnerChoice[]; canCreate: boolean }) {
  const t = useTranslations("checklists.library");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const usageText = (usage: ChecklistCard["usage"]) =>
    (["stages", "packages", "forms", "steps"] as const)
      .filter((part) => usage[part] > 0)
      .map((part) => t(`usage.${part}`, { count: usage[part] }))
      .join(" · ");
  const shown = filter ? checklists.filter((list) => list.owner === filter) : checklists;
  const ownersShown = [...new Map(checklists.map((list) => [list.owner, list.ownerName ?? t("companyWide")])).entries()];
  const columns = 6;
  return (
    <div className="flex flex-col gap-3">
      {ownersShown.length > 1 ? (
        <div className="toolbar">
          <Select aria-label={t("filterOwner")} value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full md:w-72">
            <option value="">{t("allOwners")}</option>
            {ownersShown.map(([value, name]) => (
              <option key={value || "company"} value={value}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("name")}</TableHead>
              <TableHead kind="org">{t("owner")}</TableHead>
              <TableHead kind="number">{t("columns.items")}</TableHead>
              <TableHead kind="link">{t("columns.usedBy")}</TableHead>
              <TableHead kind="status">{t("columns.state")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {shown.map((list) => {
              const open = openId === list.id;
              const toggle = () => setOpenId(open ? null : list.id);
              return (
                <Fragment key={list.id}>
                  <TableRow className="cursor-pointer" onClick={toggle}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{list.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{list.ownerName ?? t("companyWide")}</TableCell>
                    <TableCell kind="number">{list.items.length}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{usageText(list.usage) || "—"}</TableCell>
                    <TableCell>
                      <Badge dot variant={list.isActive ? "success" : "outline"}>
                        {list.isActive ? t("active") : t("inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell kind="actions">
                      <Button type="button" variant="ghost" size="icon-xs" aria-expanded={open} aria-label={open ? t("collapse") : t("expand")} onClick={(event) => { event.stopPropagation(); toggle(); }}>
                        <ChevronDownIcon className={`transition-transform duration-200 ease-(--ease-settle) ${open ? "rotate-180" : ""}`} />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow data-unnumbered="" className="hover:bg-transparent">
                      <TableCell colSpan={columns} className="h-auto bg-canvas/60 py-4 whitespace-normal">
                        {list.canManage ? (
                          <ChecklistEditor checklist={list} owners={owners.some((owner) => owner.value === list.owner) ? owners : [{ value: list.owner, name: list.ownerName ?? t("companyWide") }, ...owners]} />
                        ) : (
                          <ChecklistReadOnly checklist={list} />
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {canCreate && owners.length > 0 ? (
          <TableAddRow label={t("create")}>
            <ChecklistEditor owners={owners} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}

/** A checklist's steps as they will be ticked: a row each, with the box, the text and its guide. */
function ChecklistReadOnly({ checklist }: { checklist: ChecklistCard }) {
  const t = useTranslations("checklists.library");
  return (
    <div className="flex flex-col gap-3">
      <RichText text={checklist.description} className="text-sm text-muted-foreground" />
      <List>
        {checklist.items.length === 0 ? <ListEmpty>{t("noItems")}</ListEmpty> : null}
        {checklist.items.map((item, index) => (
          <ListItem key={item.id} className="min-h-11 gap-3 py-2 md:min-h-10">
            <Checkbox disabled aria-label={item.text} />
            <span className="min-w-0 flex-1 text-sm">{item.text}</span>
            {item.linkUrl ? (
              <a href={item.linkUrl} className="shrink-0 text-xs text-link hover:underline">
                {t("guide")}
              </a>
            ) : null}
            <span className="shrink-0 font-mono text-[0.6875rem] text-faint tabular-nums">{index + 1}</span>
          </ListItem>
        ))}
      </List>
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
        <NoteEditor id={`description-${key}`} name="description" maxLength={1000} defaultValue={checklist?.description ?? ""} placeholder={t("descriptionPlaceholder")} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("items")}</legend>
        {items.map((item, index) => (
          <div key={item.row} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right font-mono text-xs text-faint tabular-nums">{index + 1}</span>
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

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isActive" defaultChecked={checklist?.isActive ?? true} /> {t("active")}
      </label>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {checklist ? t("save") : t("create")}
        </Button>
        {checklist ? (
          <ConfirmButton size="sm" variant="ghost" className="text-destructive" disabled={pending} destructive label={t("delete")} question={t("deleteConfirm")} onConfirm={() => run(() => deleteChecklistAction({ checklistId: checklist.id }))} />
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
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {choices.map((choice) => (
          <label key={choice.id} className="flex items-center gap-2 text-sm">
            <Checkbox name={name} value={choice.id} defaultChecked={selected.includes(choice.id)} />
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
  if (!canManage && shown.length === 0)
    return (
      <List>
        <ListEmpty>{t("none")}</ListEmpty>
      </List>
    );
  return (
    <div className="flex flex-col gap-3">
      <FormError namespace="work.errors" errorKey={errorKey} />
      <List>
        {shown.map((state) => {
          const own = hooks.filter((hook) => hook.stateId === state.id).map(({ checklistId, required }) => ({ checklistId, required }));
          const addable = choices.filter((choice) => !own.some((hook) => hook.checklistId === choice.id));
          return (
            <ListItem key={state.id}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="w-40 shrink-0 font-medium">{state.name}</span>
                {own.length === 0 ? <span className="text-xs text-muted-foreground">{t("noneHere")}</span> : null}
                {own.map((hook) => (
                  <span key={hook.checklistId} className="flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[0.8125rem]">
                    {nameOf(hook.checklistId)}
                    {canManage ? (
                      <>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Checkbox checked={hook.required} disabled={pending} onCheckedChange={() => save(state.id, own.map((row) => (row.checklistId === hook.checklistId ? { ...row, required: !row.required } : row)))} />
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
            </ListItem>
          );
        })}
      </List>
    </div>
  );
}
