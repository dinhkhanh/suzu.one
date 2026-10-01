"use client";
// The table view (FR-PJM-36): one row per task, every column editable in place — the change shows
// at once and snaps back if the server refuses it — rows picked for one bulk change, and column
// totals of estimates and logged time.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { type ColumnKind, Table, TableBody, TableCard, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { updateTaskAction } from "../actions";
import { type CustomFieldType, type CustomValue, customKey } from "../engine/custom-fields";
import { filterTasks, type ListSort, readSort, sortTasks, type TaskFilters } from "../engine/filter";
import { PRIORITIES } from "../enums";
import { bulkUpdateTasksAction } from "../foundation-actions";
import { handoffOf, useHandoffGate } from "./handoff";
import { CustomValueInput, type FieldView } from "./custom-fields";
import { ArrowUpDownIcon } from "lucide-react";
import { FilterBar, MenuPicker, useUrlFilters, writeFiltersToUrl } from "./filter-bar";
import { type ListOptions, type ListTask, sortChoices } from "./task-list-view";
import { LabelChip } from "./team-forms";

type Patch = Partial<Pick<ListTask, "stateId" | "assigneePersonId" | "startDate" | "dueDate" | "priority" | "estimateMinutes" | "labelIds" | "cycleId">> & { customValues?: Record<string, CustomValue> };
type Refusal = { id: string; key: string | null; reason: string; details?: unknown };
// A custom field's column header carries the icon of its type.
const FIELD_KIND: Record<CustomFieldType, ColumnKind> = { text: "text", number: "number", select: "select", multi_select: "tags", date: "date", person: "person", url: "link", checkbox: "check", duration: "time" };
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

function applyPatch(task: ListTask, patch: Patch): ListTask {
  const { customValues, ...plain } = patch;
  const next = { ...task, ...plain };
  if (customValues) next.customValues = { ...task.customValues, ...customValues };
  return next;
}

export function TaskTableView({
  tasks,
  options,
  initialFilters,
  initialSort = "rank",
  selfId,
  today,
  canContribute,
  logged,
}: {
  tasks: ListTask[];
  options: ListOptions;
  initialFilters: TaskFilters;
  initialSort?: ListSort;
  selfId: string;
  today: string;
  canContribute: boolean;
  /** Minutes logged per task; null when the viewer may not see logged time. */
  logged: Record<string, number> | null;
}) {
  const t = useTranslations("work.table");
  const tList = useTranslations("work.list");
  const tBulk = useTranslations("work.bulk");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { filters, setFilter, clear } = useUrlFilters(initialFilters);
  const [sort, setSort] = useState<ListSort>(initialSort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ updated: number; refused: Refusal[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: ListTask[], change: { ids: string[]; patch: Patch }) => current.map((task) => (change.ids.includes(task.id) ? applyPatch(task, change.patch) : task)));

  const fields = useMemo(() => (options.fields ?? []).filter((field) => field.isActive), [options.fields]);
  const names = useMemo(() => new Map(options.people.map((person) => [person.id, person.fullName])), [options.people]);
  const visible = useMemo(() => sortTasks(filterTasks(shown, filters, { selfId, today, fields }), sort, fields, names), [shown, filters, selfId, today, fields, sort, names]);
  const editable = (task: ListTask) => (canContribute || task.assigneePersonId === selfId) && !task.id.startsWith("new-");
  const failed = (result: { ok: boolean; error?: string; message?: string }) => setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
  // Inline and bulk state changes meet the hand-off gate (FR-PJM-40): the sheet opens for the task.
  const gate = useHandoffGate();

  // A field of a project applies only to that project's tasks; the team's fields to all.
  const fieldsOf = (task: ListTask) => fields.filter((field) => field.projectId === null || field.projectId === task.projectId);

  function edit(task: ListTask, patch: Patch, input: Record<string, unknown>) {
    setOutcome(null);
    startTransition(async () => {
      applyOptimistic({ ids: [task.id], patch });
      const result = await updateTaskAction({ taskId: task.id, ...input });
      gate.intercept(result);
      failed(result);
      router.refresh();
    });
  }

  const totals = useMemo(() => ({ estimate: visible.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0), logged: logged ? visible.reduce((sum, task) => sum + (logged[task.id] ?? 0), 0) : 0 }), [visible, logged]);
  const allChosen = visible.length > 0 && visible.every((task) => selected.has(task.id));
  const toggle = (id: string, on: boolean) => setSelected((current) => new Set(on ? [...current, id] : [...current].filter((row) => row !== id)));

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} setFilter={setFilter} clear={clear} options={options} showState showDue>
        <MenuPicker
          icon={<ArrowUpDownIcon data-icon="inline-start" />}
          label={tList("sort")}
          value={sort}
          choices={sortChoices(fields).map((choice) => ({ value: choice.value, label: choice.field ? tList(choice.value.startsWith("-") ? "sorts.-field" : "sorts.field", { name: choice.field.name }) : tList(`sorts.${choice.value as "rank"}`) }))}
          onChange={(value) => {
            const next = readSort(value);
            setSort(next);
            writeFiltersToUrl(filters, { sort: next === "rank" ? null : next });
          }}
        />
        <span className="font-mono text-xs text-faint tabular-nums">{tList("count", { shown: visible.length, total: shown.length })}</span>
      </FilterBar>

      {selected.size > 0 ? (
        <BulkBar
          ids={[...selected]}
          options={options}
          fields={fields}
          pending={pending}
          onClear={() => setSelected(new Set())}
          onApply={(patch, input) => {
            const ids = [...selected];
            setOutcome(null);
            startTransition(async () => {
              applyOptimistic({ ids, patch });
              const result = await bulkUpdateTasksAction({ taskIds: ids, ...input });
              failed(result);
              if (result.ok) {
                setOutcome({ updated: result.data.updated.length, refused: result.data.refused });
                setSelected(new Set(result.data.refused.map((row) => row.id)));
              }
              router.refresh();
            });
          }}
        />
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
      {gate.sheet}
      {outcome ? (
        <div role="status" className="rounded-[14px] border border-border bg-background p-3 text-sm">
          <p>{tBulk("updated", { count: outcome.updated })}</p>
          {outcome.refused.length ? (
            <>
              <p className="text-destructive">{tBulk("refused", { count: outcome.refused.length })}</p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {outcome.refused.map((row) => (
                  <li key={row.id}>
                    <span className="font-mono">{row.key ?? "—"}</span>: {tBulk.has(`reasons.${row.reason}`) ? tBulk(`reasons.${row.reason}`) : tBulk("reasons.other")}
                    {handoffOf({ ok: false, message: row.reason, details: row.details }) ? (
                      <button type="button" className="ml-2 underline" onClick={() => gate.open(handoffOf({ ok: false, message: row.reason, details: row.details }))}>
                        {tWork("handoff.fill")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {logged === null ? <p className="text-xs text-muted-foreground">{t("loggedHidden")}</p> : null}

      <TableCard>
      <Table className="min-w-[64rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-px">
              <Checkbox aria-label={t("selectAll")} checked={allChosen} onCheckedChange={(checked) => setSelected(checked ? new Set(visible.filter(editable).map((task) => task.id)) : new Set())} />
            </TableHead>
            <TableHead kind="id">{t("key")}</TableHead>
            <TableHead kind="text">{t("title")}</TableHead>
            <TableHead kind="status">{t("state")}</TableHead>
            <TableHead kind="person">{t("assignee")}</TableHead>
            <TableHead kind="date">{t("startDate")}</TableHead>
            <TableHead kind="date">{t("dueDate")}</TableHead>
            <TableHead kind="select">{t("priority")}</TableHead>
            <TableHead kind="time">{t("estimate")}</TableHead>
            {logged ? <TableHead kind="time">{t("logged")}</TableHead> : null}
            <TableHead kind="tags">{t("labels")}</TableHead>
            {fields.map((field) => (
              <TableHead key={field.id} kind={FIELD_KIND[field.type]}>
                {field.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? <TableEmpty>{shown.length === 0 ? tList("empty") : tList("noMatch")}</TableEmpty> : null}
          {visible.map((task) => {
            const can = editable(task) && !pending;
            const open = task.status === "todo" || task.status === "in_progress";
            const overdue = open && task.dueDate !== null && task.dueDate < today;
            const own = fieldsOf(task);
            return (
              <TableRow key={task.id} data-state={selected.has(task.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox aria-label={t("select", { key: task.key })} checked={selected.has(task.id)} disabled={!editable(task)} onCheckedChange={(checked) => toggle(task.id, checked)} />
                </TableCell>
                <TableCell kind="id">{task.key}</TableCell>
                <TableCell className="max-w-72">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/work/tasks/${task.id}`} className={`truncate hover:underline ${open ? "font-medium" : "text-muted-foreground line-through"}`}>
                      {task.title}
                    </Link>
                    {task.blocker ? (
                      <Badge variant="destructive" title={task.blocker.reason}>
                        {tWork("blockers.badge")}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <Select aria-label={t("state")} value={task.stateId} disabled={!can} searchable={false} onChange={(event) => edit(task, { stateId: event.target.value }, { stateId: event.target.value })} className="h-7 w-36 text-xs md:text-xs">
                    {options.states
                      .filter((state) => state.isActive || state.id === task.stateId)
                      .map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Select aria-label={t("assignee")} value={task.assigneePersonId ?? ""} disabled={!can} onChange={(event) => edit(task, { assigneePersonId: event.target.value || null }, { assigneePersonId: event.target.value })} className="h-7 w-36 text-xs md:text-xs">
                    <option value="">{tList("unassigned")}</option>
                    {task.assigneePersonId && !options.people.some((person) => person.id === task.assigneePersonId) ? <option value={task.assigneePersonId}>{task.assigneeName ?? "…"}</option> : null}
                    {options.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.fullName}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                {(["startDate", "dueDate"] as const).map((key) => (
                  <TableCell key={key}>
                    <DatePicker
                      aria-label={t(key)}
                      key={task[key] ?? ""}
                      defaultValue={task[key] ?? ""}
                      disabled={!can}
                      onChange={(event) => edit(task, { [key]: event.target.value || null }, { [key]: event.target.value })}
                      className={`h-7 w-36 text-xs md:text-xs ${key === "dueDate" && overdue ? "text-destructive" : ""}`}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Select aria-label={t("priority")} value={task.priority ?? ""} disabled={!can} searchable={false} onChange={(event) => edit(task, { priority: event.target.value ? Number(event.target.value) : null }, { priority: event.target.value })} className="h-7 w-28 text-xs md:text-xs">
                    <option value="">{tWork("priority.none")}</option>
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {tWork(`priority.${priority}`)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell kind="time">
                  <Input
                    type="number"
                    min={0.25}
                    max={1000}
                    step={0.25}
                    aria-label={t("estimate")}
                    key={task.estimateMinutes ?? ""}
                    defaultValue={task.estimateMinutes ? hours(task.estimateMinutes) : ""}
                    disabled={!can}
                    onBlur={(event) => {
                      const minutes = event.target.value ? Math.round(Number(event.target.value) * 60) : null;
                      if (minutes !== (task.estimateMinutes ?? null)) edit(task, { estimateMinutes: minutes }, { estimateMinutes: minutes ?? "" });
                    }}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    className="ml-auto h-7 w-20 text-right text-xs md:text-xs"
                  />
                </TableCell>
                {logged ? <TableCell kind="time" className="text-xs text-muted-foreground">{logged[task.id] ? hours(logged[task.id]) : ""}</TableCell> : null}
                <TableCell>
                  <LabelCell task={task} options={options} disabled={!can} onChange={(labelIds) => edit(task, { labelIds }, { labelIds })} />
                </TableCell>
                {fields.map((field) => (
                  <TableCell key={field.id}>
                    {own.includes(field) ? <CustomValueInput compact field={field} value={task.customValues?.[field.id]} people={options.people} disabled={!can} onCommit={(value) => edit(task, { customValues: { [field.id]: value } }, { customValues: { [field.id]: value } })} /> : null}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter className="text-xs">
          <TableRow>
            <TableCell colSpan={8}>{t("totals", { count: visible.length })}</TableCell>
            <TableCell kind="time">{t("hours", { value: hours(totals.estimate) })}</TableCell>
            {logged ? <TableCell kind="time">{t("hours", { value: hours(totals.logged) })}</TableCell> : null}
            <TableCell colSpan={1 + fields.length} />
          </TableRow>
        </TableFooter>
      </Table>
      </TableCard>
    </div>
  );
}

function LabelCell({ task, options, disabled, onChange }: { task: ListTask; options: ListOptions; disabled: boolean; onChange: (labelIds: string[]) => void }) {
  const t = useTranslations("work.table");
  const chips = task.labelIds.map((id) => options.labels.find((label) => label.id === id)).filter((label) => !!label);
  if (disabled || options.labels.length === 0)
    return (
      <span className="flex flex-wrap gap-1">
        {chips.map((label) => (
          <LabelChip key={label.id} name={label.name} color={label.color} />
        ))}
      </span>
    );
  return (
    <details className="relative">
      <summary className="flex min-h-7 cursor-pointer list-none flex-wrap items-center gap-1 rounded-lg border border-border px-1.5 py-0.5 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={t("editLabels", { key: task.key })}>
        {chips.length ? chips.map((label) => <LabelChip key={label.id} name={label.name} color={label.color} />) : <span className="text-xs text-faint">+</span>}
      </summary>
      <div className="absolute z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-xl bg-popover p-2 shadow-(--float-shadow)">
        {options.labels.map((label) => (
          <label key={label.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={task.labelIds.includes(label.id)} onCheckedChange={(checked) => onChange(checked ? [...task.labelIds, label.id] : task.labelIds.filter((id) => id !== label.id))} />
            <LabelChip name={label.name} color={label.color} />
          </label>
        ))}
      </div>
    </details>
  );
}

type BulkWhat = "state" | "assignee" | "startDate" | "dueDate" | "priority" | "addLabel" | "removeLabel" | "cycle" | `cf.${string}`;

/** One change for every selected row. The server checks each task and names the ones it refused. */
function BulkBar({ ids, options, fields, pending, onClear, onApply }: { ids: string[]; options: ListOptions; fields: FieldView[]; pending: boolean; onClear: () => void; onApply: (patch: Patch, input: Record<string, unknown>) => void }) {
  const t = useTranslations("work.bulk");
  const tWork = useTranslations("work");
  const [what, setWhat] = useState<BulkWhat>("state");
  const [value, setValue] = useState<string>("");
  const [customValue, setCustomValue] = useState<CustomValue>(null);
  const field = what.startsWith("cf.") ? fields.find((row) => customKey(row.id) === what) : undefined;

  function apply() {
    if (field) return onApply({ customValues: { [field.id]: customValue } }, { customValues: { [field.id]: customValue } });
    switch (what) {
      case "state":
        return value ? onApply({ stateId: value }, { stateId: value }) : undefined;
      case "assignee":
        return onApply({ assigneePersonId: value || null }, { assigneePersonId: value });
      case "startDate":
      case "dueDate":
        return onApply({ [what]: value || null }, { [what]: value });
      case "priority":
        return onApply({ priority: value ? Number(value) : null }, { priority: value });
      case "addLabel":
        return value ? onApply({}, { addLabelIds: [value] }) : undefined;
      case "removeLabel":
        return value ? onApply({}, { removeLabelIds: [value] }) : undefined;
      case "cycle":
        return onApply({ cycleId: value || null }, { cycleId: value });
    }
  }

  const control = () => {
    if (field) return <CustomValueInput compact field={field} value={customValue} people={options.people} onCommit={setCustomValue} />;
    if (what === "startDate" || what === "dueDate") return <DatePicker aria-label={t("value")} value={value} onChange={(event) => setValue(event.target.value)} className="h-8 w-40" />;
    const choices =
      what === "state"
        ? options.states.filter((state) => state.isActive).map((state) => ({ id: state.id, label: state.name }))
        : what === "assignee"
          ? options.people.map((person) => ({ id: person.id, label: person.fullName }))
          : what === "cycle"
            ? (options.cycles ?? [])
          : what === "priority"
            ? PRIORITIES.map((priority) => ({ id: String(priority), label: tWork(`priority.${priority}`) }))
            : options.labels.map((label) => ({ id: label.id, label: label.name }));
    return (
      <Select aria-label={t("value")} value={value} onChange={(event) => setValue(event.target.value)} className="h-8 w-48">
        <option value="">{what === "state" || what === "addLabel" || what === "removeLabel" ? "—" : t("clearValue")}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </Select>
    );
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-background p-2 shadow-(--float-shadow)">
      <span className="px-1 text-sm font-medium">{t("selected", { count: ids.length })}</span>
      <Select
        aria-label={t("what")}
        value={what}
        onChange={(event) => {
          setWhat(event.target.value as BulkWhat);
          setValue("");
          setCustomValue(null);
        }}
        className="h-8 w-44"
      >
        {(["state", "assignee", "startDate", "dueDate", "priority", "addLabel", "removeLabel"] as const).map((key) => (
          <option key={key} value={key}>
            {t(`fields.${key}`)}
          </option>
        ))}
        {options.cycles?.length ? <option value="cycle">{tWork("cycles.bulkField")}</option> : null}
        {fields.map((row) => (
          <option key={row.id} value={customKey(row.id)}>
            {t("fields.custom", { name: row.name })}
          </option>
        ))}
      </Select>
      {control()}
      <Button size="sm" disabled={pending} onClick={apply}>
        {t("apply")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t("clearSelection")}
      </Button>
    </div>
  );
}
