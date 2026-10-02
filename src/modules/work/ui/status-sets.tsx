"use client";
// The status library on screen: task workflows and project status sets, each as the reference
// grid whose rows open their statuses or their editor in a sheet (full width on a phone, where the
// grid scrolls sideways) — and the key on a team's workflow that saves it to the library.
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { MAX_SET_PROJECT_STATUSES, MAX_SET_STATES, PROJECT_STATUSES, STATE_CATEGORIES } from "../enums";
import { deleteProjectStatusSetAction, deleteStateSetAction, saveProjectStatusSetAction, saveStateSetAction, saveTeamWorkflowAsSetAction } from "../status-set-actions";

type Result = { ok: boolean; error?: string; message?: string };

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

export type SetKind = "workflow" | "project";
export type SetStatus = { id: string | null; name: string; category: string; isActive: boolean; /** Projects in this status (project sets). */ uses?: number };
export type SetCard = {
  id: string;
  name: string;
  description: string | null;
  /** The owning team's id; "" = shared. */
  owner: string;
  ownerName: string | null;
  statuses: SetStatus[];
  isActive: boolean;
  canManage: boolean;
  /** Teams using it (project sets). */
  teams?: number;
};
/** Where a set may be filed, as the viewer may file it: "" = shared. */
export type OwnerChoice = { value: string; name: string };

const KIND = {
  workflow: { categories: STATE_CATEGORIES, max: MAX_SET_STATES, categoryKey: "categories", fallback: "in_progress", save: saveStateSetAction, remove: deleteStateSetAction },
  project: { categories: PROJECT_STATUSES, max: MAX_SET_PROJECT_STATUSES, categoryKey: "projects.status", fallback: "active", save: saveProjectStatusSetAction, remove: deleteProjectStatusSetAction },
} as const;

/** One kind of set as the reference grid: a row per set, which unfolds into its statuses or its editor. */
export function StatusSetLibrary({ kind, sets, owners, canCreate }: { kind: SetKind; sets: SetCard[]; owners: OwnerChoice[]; canCreate: boolean }) {
  const t = useTranslations("work.statusSets");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sets.find((set) => set.id === openId);
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("name")}</TableHead>
            <TableHead kind="org">{t("owner")}</TableHead>
            <TableHead kind="text">{t("statuses")}</TableHead>
            <TableHead kind="number">{kind === "project" ? t("teamsUsing") : t("count")}</TableHead>
            <TableHead kind="status">{t("state")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sets.length === 0 ? <TableEmpty>{t(`empty.${kind}`)}</TableEmpty> : null}
          {sets.map((set) => (
            <TableRow key={set.id} className="cursor-pointer" onClick={() => setOpenId(set.id)}>
              <TableCell className="whitespace-normal">
                <span className="font-medium">{set.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{set.ownerName ?? t("shared")}</TableCell>
              <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{set.statuses.filter((status) => status.isActive).map((status) => status.name).join(" → ")}</TableCell>
              <TableCell kind="number">{kind === "project" ? (set.teams ?? 0) : set.statuses.length}</TableCell>
              <TableCell>
                <Badge dot variant={set.isActive ? "success" : "outline"}>
                  {set.isActive ? t("active") : t("inactive")}
                </Badge>
              </TableCell>
              <TableCell kind="actions">
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("expand")} onClick={(event) => { event.stopPropagation(); setOpenId(set.id); }}>
                  <ChevronRightIcon />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canCreate && owners.length > 0 ? (
        <TableAddRow label={t(`create.${kind}`)}>
          <SetEditor kind={kind} owners={owners} />
        </TableAddRow>
      ) : null}
      <Dialog open={!!open} onOpenChange={(next) => (next ? null : setOpenId(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open?.name}</DialogTitle>
          </DialogHeader>
          {open ? open.canManage ? <SetEditor key={open.id} kind={kind} set={open} owners={owners.some((owner) => owner.value === open.owner) ? owners : [{ value: open.owner, name: open.ownerName ?? t("shared") }, ...owners]} onDone={() => setOpenId(null)} /> : <SetReadOnly kind={kind} set={open} /> : null}
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}

function SetReadOnly({ kind, set }: { kind: SetKind; set: SetCard }) {
  const t = useTranslations("work.statusSets");
  const tWork = useTranslations("work");
  return (
    <div className="flex flex-col gap-3">
      {set.description ? <p className="text-sm text-muted-foreground">{set.description}</p> : null}
      <List>
        {set.statuses.length === 0 ? <ListEmpty>{t("noStatuses")}</ListEmpty> : null}
        {set.statuses.map((status, index) => (
          <ListItem key={status.id ?? index} className="min-h-11 gap-3 py-2 md:min-h-10">
            <span className="w-5 text-right font-mono text-xs text-faint tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">{status.name}</span>
            {status.isActive ? null : <Badge variant="secondary">{t("inactive")}</Badge>}
            <Badge dot variant={kind === "project" ? statusTone(status.category) : "outline"}>{tWork(`${KIND[kind].categoryKey}.${status.category}` as "categories.todo")}</Badge>
          </ListItem>
        ))}
      </List>
    </div>
  );
}

const newRowId = () => Math.random().toString(36).slice(2, 10);

function SetEditor({ kind, set, owners, onDone }: { kind: SetKind; set?: SetCard; owners: OwnerChoice[]; /** After a save or a delete — the sheet closes. */ onDone?: () => void }) {
  const t = useTranslations("work.statusSets");
  const tWork = useTranslations("work");
  const config = KIND[kind];
  const { run, pending, errorKey } = useRun();
  const blankRow = (): SetStatus & { row: string } => ({ row: newRowId(), id: null, name: "", category: config.fallback, isActive: true });
  const initial = () => (set?.statuses.length ? set.statuses.map((status) => ({ ...status, row: status.id ?? newRowId() })) : [blankRow(), blankRow(), blankRow()]);
  const [rows, setRows] = useState(initial);
  const key = `${kind}-${set?.id ?? "new"}`;
  const setRow = (index: number, patch: Partial<SetStatus>) => setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const base = { setId: set?.id ?? "", name: data.get("name"), description: data.get("description"), ownerTeamId: data.get("owner"), isActive: data.get("isActive") === "on" };
        const call =
          kind === "workflow"
            ? () => saveStateSetAction({ ...base, states: rows.map(({ name, category }) => ({ name, category })) })
            : () => saveProjectStatusSetAction({ ...base, statuses: rows.map(({ id, name, category, isActive }) => ({ id: id ?? "", name, category, isActive })) });
        run(call, () => {
          if (set) return onDone?.();
          form.reset();
          setRows([blankRow(), blankRow(), blankRow()]);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`name-${key}`}>{t("name")}</Label>
          <Input id={`name-${key}`} name="name" required maxLength={80} defaultValue={set?.name ?? ""} placeholder={t(`namePlaceholder.${kind}`)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`owner-${key}`}>{t("owner")}</Label>
          <Select id={`owner-${key}`} name="owner" defaultValue={set?.owner ?? owners[0]?.value ?? ""}>
            {owners.map((owner) => (
              <option key={owner.value || "shared"} value={owner.value}>
                {owner.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`description-${key}`}>{t("descriptionField")}</Label>
        <Input id={`description-${key}`} name="description" maxLength={500} defaultValue={set?.description ?? ""} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("statuses")}</legend>
        {rows.map((row, index) => (
          <div key={row.row} className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 last:border-b-0">
            <span className="w-5 text-right font-mono text-xs text-faint tabular-nums">{index + 1}</span>
            <Input aria-label={t("statusName")} value={row.name} maxLength={40} placeholder={t("statusName")} onChange={(event) => setRow(index, { name: event.target.value })} className="min-w-0 flex-[2_1_12rem]" />
            <Select aria-label={t("category")} value={row.category} onChange={(event) => setRow(index, { category: event.target.value })} className="min-w-0 flex-[1_1_9rem]">
              {config.categories.map((category) => (
                <option key={category} value={category}>
                  {tWork(`${config.categoryKey}.${category}` as "categories.todo")}
                </option>
              ))}
            </Select>
            {kind === "project" && row.id ? (
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={row.isActive} onCheckedChange={(checked) => setRow(index, { isActive: checked === true })} /> {t("active")}
              </label>
            ) : null}
            {row.uses ? <span className="text-xs text-muted-foreground">{t("projectsIn", { count: row.uses })}</span> : null}
            <div className="flex">
              <Button type="button" size="sm" variant="ghost" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={t("moveDown")} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                ↓
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={t("remove")} disabled={!!row.uses} onClick={() => setRows(rows.filter((_, at) => at !== index))}>
                ×
              </Button>
            </div>
          </div>
        ))}
        {rows.length < config.max ? (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setRows([...rows, blankRow()])}>
            {t("addStatus")}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">{t(`hint.${kind}`)}</p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isActive" defaultChecked={set?.isActive ?? true} /> {t("active")}
      </label>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {set ? tWork("save") : t(`create.${kind}`)}
        </Button>
        {set ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("deleteConfirm"))) run(() => config.remove({ setId: set.id }), onDone);
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Under a team's workflow: save it to the library as the team's own, for the next team to start from. */
export function SaveWorkflowToLibrary({ teamId, teamName }: { teamId: string; teamName: string }) {
  const t = useTranslations("work.statusSets");
  const { run, pending, errorKey } = useRun();
  const [done, setDone] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setDone(false);
        run(() => saveTeamWorkflowAsSetAction({ teamId, name: data.get("name") }), () => setDone(true));
      }}
    >
      <Input name="name" required maxLength={80} aria-label={t("name")} defaultValue={t("fromTeamName", { team: teamName })} className="min-w-0 flex-[1_1_14rem] sm:max-w-80" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t("saveToLibrary")}
      </Button>
      {done ? <span className="text-sm text-muted-foreground">{t("savedToLibrary")}</span> : null}
      <FormError namespace="work.errors" errorKey={errorKey} />
    </form>
  );
}
