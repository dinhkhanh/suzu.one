"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addWorkTemplateItemAction,
  applyTemplateAction,
  changeRecurrenceAction,
  createProjectFromTemplateAction,
  createRecurrenceAction,
  nudgeTaskAction,
  removeWorkTemplateItemAction,
  saveWorkTemplateAction,
  updateRecurrenceAction,
  updateWorkTemplateItemAction,
} from "../planning-actions";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };
type Person = { id: string; fullName: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (action: (input: unknown) => Promise<Result>, input: unknown, after?: (data: unknown) => void) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.(result.data);
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────

export type TemplateItemView = {
  id: string;
  parentItemId: string | null;
  title: string;
  roleKey: string | null;
  dueOffsetDays: number;
  estimateMinutes: number | null;
  /** Library checklists the step's task starts with. */ checklistIds?: string[];
};
export type TemplateView = { id: string; purpose: string; name: string; description: string | null; ownerId: string | null; ownerName: string | null; isActive: boolean; canManage: boolean; roleKeys: string[]; items: TemplateItemView[] };

export function TemplateCreateForm({ owners, canShare }: { owners: { id: string; name: string }[]; canShare: boolean }) {
  const t = useTranslations("work.templates");
  const { run, pending, errorKey } = useRun();
  return (
    <form
      className="toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        run(saveWorkTemplateAction, { purpose: data.get("purpose"), name: data.get("name"), description: data.get("description"), ownerId: data.get("ownerId"), isActive: true }, () => form.reset());
      }}
    >
      <Input name="name" required maxLength={120} placeholder={t("name")} aria-label={t("name")} className="w-64" />
      <Select name="purpose" aria-label={t("purpose")} className="w-44" defaultValue="work_project">
        <option value="work_project">{t("purposes.work_project")}</option>
        <option value="work_task">{t("purposes.work_task")}</option>
      </Select>
      <Select name="ownerId" aria-label={t("owner")} className="w-52" defaultValue={canShare ? "" : owners[0]?.id}>
        {canShare ? <option value="">{t("shared")}</option> : null}
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.name}
          </option>
        ))}
      </Select>
      <Input name="description" maxLength={1000} placeholder={t("descriptionField")} aria-label={t("descriptionField")} className="min-w-0 flex-1" />
      <Button type="submit" size="sm" disabled={pending}>
        {t("create")}
      </Button>
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </form>
  );
}

export function TemplateCard({ template, checklists = [] }: { template: TemplateView; /** The library's active checklists. */ checklists?: { id: string; name: string }[] }) {
  const t = useTranslations("work.templates");
  const { run, pending, errorKey } = useRun();
  const roots = template.items.filter((item) => !item.parentItemId || !template.items.some((other) => other.id === item.parentItemId));
  const row = (item: TemplateItemView, depth: number) => (
    <ListItem key={item.id} className="flex-wrap gap-x-3 gap-y-1" style={{ paddingLeft: depth * 20 }}>
      <span className="min-w-0 flex-1 basis-56">{item.title}</span>
      {item.roleKey ? <Badge variant="outline">{item.roleKey}</Badge> : null}
      {checklists
        .filter((list) => item.checklistIds?.includes(list.id))
        .map((list) => (
          <Badge key={list.id} variant="secondary">
            ☑ {list.name}
          </Badge>
        ))}
      <span className="w-16 text-right font-mono text-xs text-muted-foreground">{t("offset", { days: item.dueOffsetDays })}</span>
      {item.estimateMinutes ? <span className="text-xs text-muted-foreground">{t("hours", { hours: Math.round((item.estimateMinutes / 60) * 100) / 100 })}</span> : null}
      {template.canManage ? <TemplateItemEditButton item={item} template={template} roots={roots} checklists={checklists} /> : null}
      {template.canManage ? (
        <button type="button" className="text-xs text-muted-foreground hover:text-destructive" aria-label={t("removeItem", { title: item.title })} disabled={pending} onClick={() => run(removeWorkTemplateItemAction, { itemId: item.id })}>
          ×
        </button>
      ) : null}
    </ListItem>
  );
  return (
    <article className="flex flex-col gap-3 rounded-xl border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{template.name}</h3>
        <Badge variant="secondary">{t(`purposes.${template.purpose}`)}</Badge>
        <Badge variant="outline">{template.ownerName ?? t("shared")}</Badge>
        {template.isActive ? null : <Badge variant="destructive">{t("inactive")}</Badge>}
        {template.canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={pending}
            onClick={() => run(saveWorkTemplateAction, { templateId: template.id, purpose: template.purpose, name: template.name, description: template.description, ownerId: template.ownerId, isActive: !template.isActive })}
          >
            {template.isActive ? t("retire") : t("restore")}
          </Button>
        ) : null}
      </header>
      {template.description ? <p className="text-sm text-muted-foreground">{template.description}</p> : null}
      <List>{template.items.length ? roots.flatMap((item) => [row(item, 0), ...template.items.filter((child) => child.parentItemId === item.id).map((child) => row(child, 1))]) : <ListEmpty>{t("noItems")}</ListEmpty>}</List>
      {template.canManage ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run(
              addWorkTemplateItemAction,
              {
                templateId: template.id,
                title: data.get("title"),
                parentItemId: data.get("parentItemId"),
                roleKey: data.get("roleKey"),
                dueOffsetDays: data.get("dueOffsetDays"),
                estimateHours: data.get("estimateHours"),
                checklistId: data.get("checklistId"),
                sortOrder: template.items.length,
              },
              () => form.reset(),
            );
          }}
        >
          <Input name="title" required maxLength={200} placeholder={t("itemTitle")} aria-label={t("itemTitle")} className="min-w-48 flex-1" />
          <Select name="parentItemId" aria-label={t("parent")} className="w-44" defaultValue="">
            <option value="">{t("topLevel")}</option>
            {roots.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
          <Input name="roleKey" maxLength={31} pattern="[a-zA-Z][a-zA-Z0-9_]+" placeholder={t("role")} aria-label={t("role")} list={`roles-${template.id}`} className="w-32" />
          <datalist id={`roles-${template.id}`}>
            {template.roleKeys.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          <Input name="dueOffsetDays" type="number" required defaultValue={0} min={-365} max={365} aria-label={t("offsetField")} title={t("offsetField")} className="w-20" />
          <Input name="estimateHours" type="number" step="0.25" min={0.25} placeholder={t("estimate")} aria-label={t("estimate")} className="w-24" />
          {checklists.length ? (
            <Select name="checklistId" aria-label={t("checklist")} className="w-44" defaultValue="">
              <option value="">{t("noChecklist")}</option>
              {checklists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t("addItem")}
          </Button>
        </form>
      ) : null}
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </article>
  );
}

/**
 * "Edit" on a step: its title, where it sits, its role, its day, its estimate and its checklist. The
 * template's next use reads it; tasks already made from it keep what they were made with.
 */
function TemplateItemEditButton({ item, template, roots, checklists }: { item: TemplateItemView; template: TemplateView; roots: TemplateItemView[]; checklists: { id: string; name: string }[] }) {
  const t = useTranslations("work.templates");
  const { run, pending, errorKey } = useRun();
  const [open, setOpen] = useState(false);
  const checklist = item.checklistIds?.[0] ?? "";
  // A step with sub-steps stays a step: two levels stay two levels.
  const hasChildren = template.items.some((other) => other.parentItemId === item.id);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="xs" variant="ghost" className="text-muted-foreground" aria-label={t("editItem", { title: item.title })} />}>{t("edit")}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("editItem", { title: item.title })}</DialogTitle>
          <DialogDescription>{t("editItemHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const chosen = data.get("checklistId");
            // The checklist is sent only when it was changed: a step's further checklists are kept otherwise
            // — and so is one retired from the library, which the picker cannot show.
            const shown = checklists.some((list) => list.id === checklist) ? checklist : "";
            const checklistChange = chosen !== null && chosen !== shown ? { checklistId: chosen } : {};
            run(
              updateWorkTemplateItemAction,
              { itemId: item.id, title: data.get("title"), parentItemId: data.get("parentItemId") ?? "", roleKey: data.get("roleKey"), dueOffsetDays: data.get("dueOffsetDays"), estimateHours: data.get("estimateHours"), ...checklistChange },
              () => setOpen(false),
            );
          }}
        >
          <Input name="title" required maxLength={200} defaultValue={item.title} placeholder={t("itemTitle")} aria-label={t("itemTitle")} />
          <div className="flex flex-wrap items-center gap-2">
            {hasChildren ? null : (
              <Select name="parentItemId" aria-label={t("parent")} className="w-52" defaultValue={item.parentItemId ?? ""}>
                <option value="">{t("topLevel")}</option>
                {roots
                  .filter((root) => root.id !== item.id)
                  .map((root) => (
                    <option key={root.id} value={root.id}>
                      {root.title}
                    </option>
                  ))}
              </Select>
            )}
            <Input name="roleKey" maxLength={31} pattern="[a-zA-Z][a-zA-Z0-9_]+" defaultValue={item.roleKey ?? ""} placeholder={t("role")} aria-label={t("role")} list={`roles-edit-${item.id}`} className="w-40" />
            <datalist id={`roles-edit-${item.id}`}>
              {template.roleKeys.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input name="dueOffsetDays" type="number" required defaultValue={item.dueOffsetDays} min={-365} max={365} aria-label={t("offsetField")} title={t("offsetField")} className="w-24" />
            <Input name="estimateHours" type="number" step="0.25" min={0.25} defaultValue={item.estimateMinutes ? item.estimateMinutes / 60 : ""} placeholder={t("estimate")} aria-label={t("estimate")} className="w-24" />
            {checklists.length ? (
              <Select name="checklistId" aria-label={t("checklist")} className="w-52" defaultValue={checklist}>
                <option value="">{t("noChecklist")}</option>
                {checklists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <FormError namespace="work.templates.errors" errorKey={errorKey} />
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              {t("saveItem")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Use a template: a new project (`teams` given) or more tasks inside an existing one (`projectId`). */
export function TemplateUseForm({
  templates,
  teams,
  projectId,
  peopleByTeam,
  today,
}: {
  templates: { id: string; name: string; ownerId: string | null; roleKeys: string[] }[];
  teams?: { id: string; name: string; defaultVisibility: string }[];
  projectId?: string;
  /** Who can play a role: the team's (and the project's) people. Key "" = the project's own list. */
  peopleByTeam: Record<string, Person[]>;
  today: string;
}) {
  const t = useTranslations("work.templates");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { run, pending, errorKey } = useRun();
  const [teamId, setTeamId] = useState(teams?.[0]?.id ?? "");
  const usable = templates.filter((template) => !template.ownerId || !teams || template.ownerId === teamId);
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? "");
  const template = usable.find((row) => row.id === templateId) ?? usable[0];
  const people = peopleByTeam[teams ? teamId : ""] ?? [];
  const [made, setMade] = useState<number | null>(null);
  if (templates.length === 0 || (teams && teams.length === 0)) return <p className="text-sm text-muted-foreground">{t("nothingToUse")}</p>;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const roles = Object.fromEntries((template?.roleKeys ?? []).map((key) => [key, String(data.get(`role.${key}`) ?? "")]));
        const use = { templateId: template?.id, anchorMode: data.get("anchorMode"), anchorDate: data.get("anchorDate"), roles };
        if (projectId) run(applyTemplateAction, { ...use, projectId }, (result) => setMade((result as { tasks: number }).tasks));
        else
          run(createProjectFromTemplateAction, { ...use, teamId, name: data.get("name"), visibility: data.get("visibility"), description: "", clientId: "", leadPersonId: "" }, (result) =>
            router.push(`/work/projects/${(result as { id: string }).id}`),
          );
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {teams ? (
          <Select aria-label={t("team")} className="w-52" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label={t("template")} className="w-64" value={template?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>
          {usable.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        {teams ? (
          <>
            <Input name="name" required maxLength={120} placeholder={t("projectName")} aria-label={t("projectName")} className="min-w-48 flex-1" />
            <Select name="visibility" aria-label={tWork("projects.fields.visibility")} className="w-40" key={teamId} defaultValue={teams.find((team) => team.id === teamId)?.defaultVisibility ?? "team"}>
              {(["entity", "team", "private"] as const).map((value) => (
                <option key={value} value={value}>
                  {tWork(`visibility.${value}`)}
                </option>
              ))}
            </Select>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select name="anchorMode" aria-label={t("anchorMode")} className="w-56" defaultValue="start">
          <option value="start">{t("anchor.start")}</option>
          <option value="end">{t("anchor.end")}</option>
        </Select>
        <DatePicker name="anchorDate" required defaultValue={today} aria-label={t("anchorDate")} className="w-44" />
      </div>
      {template?.roleKeys.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{t("whoPlays")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {template.roleKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 font-mono text-xs">{key}</span>
                <Select name={`role.${key}`} aria-label={key} defaultValue="" className="min-w-0 flex-1">
                  <option value="">{t("unassigned")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !template}>
          {projectId ? t("addTasks") : t("createProject")}
        </Button>
        {made !== null ? <span className="text-sm text-muted-foreground">{t("made", { count: made })}</span> : null}
      </div>
      <FormError namespace="work.templates.errors" errorKey={errorKey} />
    </form>
  );
}

// ── Recurring tasks ─────────────────────────────────────────────────────────────────────────

type RecurrenceRuleView = { freq: "daily" | "weekly" | "monthly"; interval: number; weekdays?: number[]; monthDay?: number | "last" };
type DayOffMode = "shift" | "skip" | "keep";
export type RecurrenceItem = {
  id: string;
  title: string;
  rule: RecurrenceRuleView;
  startDate: string;
  endDate: string | null;
  leadDays: number;
  onDayOff: string;
  isActive: boolean;
  assigneePersonId?: string | null;
  assigneeName: string | null;
  estimateMinutes?: number | null;
  nextDate: string | null;
  made: number;
};

/**
 * The fields of a rule, for adding one and for changing one: its title and who its tasks go to,
 * when it comes round, from when to when, how far ahead tasks appear and what happens on a day off.
 * A rule's start is not changed afterwards (`startDate` shown only when adding).
 */
function RecurrenceFields({ initial, people, today, idPrefix }: { initial?: RecurrenceItem; people: Person[]; today: string; idPrefix: string }) {
  const t = useTranslations("work.recurrence");
  const [freq, setFreq] = useState<RecurrenceRuleView["freq"]>(initial?.rule.freq ?? "weekly");
  const weekdays = initial?.rule.weekdays ?? [1];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="title" required maxLength={200} defaultValue={initial?.title} placeholder={t("title")} aria-label={t("title")} className="min-w-48 flex-1" />
        <Select name="assigneePersonId" aria-label={t("assignee")} className="w-48" defaultValue={initial?.assigneePersonId ?? ""}>
          <option value="">{t("unassigned")}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
        <Input name="estimateHours" type="number" step="0.25" min={0.25} max={1000} defaultValue={initial?.estimateMinutes ? initial.estimateMinutes / 60 : ""} placeholder={t("estimate")} aria-label={t("estimate")} className="w-24" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t("every")}</span>
        <Input name="interval" type="number" required min={1} max={366} defaultValue={initial?.rule.interval ?? 1} aria-label={t("interval")} className="w-16" />
        <Select name="freq" aria-label={t("frequency")} className="w-28" value={freq} onChange={(event) => setFreq(event.target.value as typeof freq)}>
          <option value="daily">{t("freq.daily")}</option>
          <option value="weekly">{t("freq.weekly")}</option>
          <option value="monthly">{t("freq.monthly")}</option>
        </Select>
        {freq === "weekly" ? (
          <span className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
              <label key={weekday} htmlFor={`${idPrefix}-weekday-${weekday}`} className="flex items-center gap-1">
                <Checkbox id={`${idPrefix}-weekday-${weekday}`} name="weekdays" value={String(weekday)} defaultChecked={weekdays.includes(weekday)} />
                {t(`weekdays.${weekday}`)}
              </label>
            ))}
          </span>
        ) : null}
        {freq === "monthly" ? (
          <Select name="monthDay" aria-label={t("monthDay")} className="w-32" defaultValue={String(initial?.rule.monthDay ?? 1)}>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {t("onDay", { day: value })}
              </option>
            ))}
            <option value="last">{t("lastDay")}</option>
          </Select>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {initial ? null : (
          <label className="flex items-center gap-2">
            {t("from")}
            <DatePicker name="startDate" required defaultValue={today} className="w-40" />
          </label>
        )}
        <label className="flex items-center gap-2">
          {t("until")}
          <DatePicker name="endDate" defaultValue={initial?.endDate ?? ""} className="w-40" />
        </label>
        <label className="flex items-center gap-2">
          {t("lead")}
          <Input name="leadDays" type="number" min={0} max={60} defaultValue={initial?.leadDays ?? 7} className="w-16" />
        </label>
        <label className="flex items-center gap-2">
          {t("onDayOff")}
          <Select name="onDayOff" aria-label={t("onDayOff")} className="w-52" defaultValue={initial?.onDayOff ?? "shift"} searchable={false}>
            {(["shift", "skip", "keep"] as const satisfies readonly DayOffMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {t(`dayOff.${mode}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </>
  );
}

/** What the fields of `RecurrenceFields` send. */
function recurrenceInput(data: FormData) {
  const freq = String(data.get("freq"));
  const interval = data.get("interval");
  const rule = freq === "daily" ? { freq, interval } : freq === "weekly" ? { freq, interval, weekdays: data.getAll("weekdays") } : { freq, interval, monthDay: data.get("monthDay") };
  return { title: data.get("title"), rule, endDate: data.get("endDate"), leadDays: data.get("leadDays"), onDayOff: data.get("onDayOff"), assigneePersonId: data.get("assigneePersonId"), estimateHours: data.get("estimateHours") };
}

/** "Edit" on a rule: the same fields in a sheet. What the rule already made stays as it is. */
function RecurrenceEditButton({ item, people, today }: { item: RecurrenceItem; people: Person[]; today: string }) {
  const t = useTranslations("work.recurrence");
  const { run, pending, errorKey } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" aria-label={t("editTitle", { title: item.title })} />}>{t("edit")}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editTitle", { title: item.title })}</DialogTitle>
          <DialogDescription>{t("editHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(updateRecurrenceAction, { recurrenceId: item.id, ...recurrenceInput(new FormData(event.currentTarget)) }, () => setOpen(false));
          }}
        >
          <RecurrenceFields initial={item} people={people} today={today} idPrefix={`edit-${item.id}`} />
          <FormError namespace="work.recurrence.errors" errorKey={errorKey} />
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The rules of a project, or (`target.teamId`) of a team's own backlog. */
export function RecurrenceManager({ target, recurrences, people, canManage, today }: { target: { projectId: string } | { teamId: string }; recurrences: RecurrenceItem[]; people: Person[]; canManage: boolean; today: string }) {
  const t = useTranslations("work.recurrence");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const describe = (rule: RecurrenceItem["rule"]) =>
    rule.freq === "daily"
      ? t("rule.daily", { interval: rule.interval })
      : rule.freq === "weekly"
        ? t("rule.weekly", { interval: rule.interval, days: (rule.weekdays ?? []).map((weekday) => t(`weekdays.${weekday}`)).join(", ") })
        : rule.monthDay === "last"
          ? t("rule.monthlyLast", { interval: rule.interval })
          : t("rule.monthly", { interval: rule.interval, day: rule.monthDay ?? 1 });

  return (
    <div className="flex flex-col gap-3">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("title")}</TableHead>
              <TableHead kind="select">{t("frequency")}</TableHead>
              <TableHead kind="person">{t("assignee")}</TableHead>
              <TableHead kind="number">{t("columns.made")}</TableHead>
              <TableHead kind="date">{t("columns.next")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
              {canManage ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {recurrences.length === 0 ? <TableEmpty>{"teamId" in target ? t("emptyTeam") : t("empty")}</TableEmpty> : null}
            {recurrences.map((item) => {
              const ended = !!item.endDate && item.endDate <= today;
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell>
                    {describe(item.rule)}
                    {item.onDayOff !== "shift" ? <span className="block text-xs text-muted-foreground">{t(`dayOff.${item.onDayOff as DayOffMode}`)}</span> : null}
                  </TableCell>
                  <TableCell>
                    {item.assigneeName ? (
                      <RecordLink kind="person" id={item.assigneePersonId}>
                        {item.assigneeName}
                      </RecordLink>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell kind="number">{item.made}</TableCell>
                  <TableCell>{item.nextDate ? day(item.nextDate) : "—"}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(ended ? "ended" : item.isActive ? "active" : "paused")}>
                      {t(ended ? "ended" : item.isActive ? "active" : "paused")}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell kind="actions">
                      {!ended ? (
                        <span className="flex justify-end gap-1">
                          <RecurrenceEditButton item={item} people={people} today={today} />
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(changeRecurrenceAction, { recurrenceId: item.id, change: item.isActive ? "pause" : "resume" })}>
                            {t(item.isActive ? "pause" : "resume")}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(changeRecurrenceAction, { recurrenceId: item.id, change: "end" })}>
                            {t("end")}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {canManage ? (
          <TableAddRow label={t("create")} open={recurrences.length === 0}>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                run(createRecurrenceAction, { ...target, ...recurrenceInput(data), startDate: data.get("startDate"), priority: "", description: "" }, () => form.reset());
              }}
            >
              <RecurrenceFields people={people} today={today} idPrefix="new-recurrence" />
              <div>
                <Button type="submit" size="sm" disabled={pending}>
                  {t("create")}
                </Button>
              </div>
            </form>
          </TableAddRow>
        ) : null}
      </TableCard>
      <FormError namespace="work.recurrence.errors" errorKey={errorKey} />
    </div>
  );
}

// ── Leader view ─────────────────────────────────────────────────────────────────────────────

export function NudgeButton({ taskId }: { taskId: string }) {
  const t = useTranslations("work.leader");
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | string>("idle");
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || state === "sent"}
        onClick={() =>
          startTransition(async () => {
            const result: Result = await nudgeTaskAction({ taskId });
            setState(result.ok ? "sent" : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
          })
        }
      >
        {state === "sent" ? t("nudged") : t("nudge")}
      </Button>
      {state !== "idle" && state !== "sent" ? (
        <span role="alert" className="text-xs text-destructive">
          {t.has(`errors.${state}`) ? t(`errors.${state}`) : t("errors.generic")}
        </span>
      ) : null}
    </span>
  );
}
