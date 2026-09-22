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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateTaskAction } from "../actions";
import { type CustomValue, customKey } from "../engine/custom-fields";
import { filterTasks, type ListSort, readSort, sortTasks, type TaskFilters } from "../engine/filter";
import { PRIORITIES } from "../enums";
import { bulkUpdateTasksAction } from "../foundation-actions";
import { handoffOf, useHandoffGate } from "./handoff";
import { CustomValueInput, type FieldView } from "./custom-fields";
import { FilterBar, useUrlFilters, writeFiltersToUrl } from "./filter-bar";
import { type ListOptions, type ListTask, sortChoices } from "./task-list-view";
import { LabelChip } from "./team-forms";

type Patch = Partial<Pick<ListTask, "stateId" | "assigneePersonId" | "startDate" | "dueDate" | "priority" | "estimateMinutes" | "labelIds" | "cycleId">> & { customValues?: Record<string, CustomValue> };
type Refusal = { id: string; key: string | null; reason: string; details?: unknown };
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
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar filters={filters} setFilter={setFilter} clear={clear} options={options} />
        <Select
          aria-label={tList("sort")}
          value={sort}
          onChange={(event) => {
            const next = readSort(event.target.value);
            setSort(next);
            writeFiltersToUrl(filters, { sort: next === "rank" ? null : next });
          }}
          className="w-44"
        >
          {sortChoices(fields).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.field ? tList(choice.value.startsWith("-") ? "sorts.-field" : "sorts.field", { name: choice.field.name }) : tList(`sorts.${choice.value as "rank"}`)}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{tList("count", { shown: visible.length, total: shown.length })}</span>
      </div>

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
        <div role="status" className="rounded-lg border p-3 text-sm">
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

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2">
                <input type="checkbox" aria-label={t("selectAll")} checked={allChosen} onChange={(event) => setSelected(event.target.checked ? new Set(visible.filter(editable).map((task) => task.id)) : new Set())} />
              </th>
              <th className="px-2 py-2">{t("key")}</th>
              <th className="px-2 py-2">{t("title")}</th>
              <th className="px-2 py-2">{t("state")}</th>
              <th className="px-2 py-2">{t("assignee")}</th>
              <th className="px-2 py-2">{t("startDate")}</th>
              <th className="px-2 py-2">{t("dueDate")}</th>
              <th className="px-2 py-2">{t("priority")}</th>
              <th className="px-2 py-2 text-right">{t("estimate")}</th>
              {logged ? <th className="px-2 py-2 text-right">{t("logged")}</th> : null}
              <th className="px-2 py-2">{t("labels")}</th>
              {fields.map((field) => (
                <th key={field.id} className="px-2 py-2">
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={11 + fields.length + (logged ? 1 : 0)} className="p-6 text-center text-muted-foreground">
                  {shown.length === 0 ? tList("empty") : tList("noMatch")}
                </td>
              </tr>
            ) : null}
            {visible.map((task) => {
              const can = editable(task) && !pending;
              const open = task.status === "todo" || task.status === "in_progress";
              const overdue = open && task.dueDate !== null && task.dueDate < today;
              const own = fieldsOf(task);
              return (
                <tr key={task.id} className={selected.has(task.id) ? "bg-muted/40" : undefined}>
                  <td className="px-2 py-1">
                    <input type="checkbox" aria-label={t("select", { key: task.key })} checked={selected.has(task.id)} disabled={!editable(task)} onChange={(event) => toggle(task.id, event.target.checked)} />
                  </td>
                  <td className="px-2 py-1 font-mono text-xs whitespace-nowrap text-muted-foreground">{task.key}</td>
                  <td className="max-w-72 px-2 py-1">
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
                  </td>
                  <td className="px-2 py-1">
                    <Select aria-label={t("state")} value={task.stateId} disabled={!can} onChange={(event) => edit(task, { stateId: event.target.value }, { stateId: event.target.value })} className="h-7 w-36 text-xs md:text-xs">
                      {options.states
                        .filter((state) => state.isActive || state.id === task.stateId)
                        .map((state) => (
                          <option key={state.id} value={state.id}>
                            {state.name}
                          </option>
                        ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Select aria-label={t("assignee")} value={task.assigneePersonId ?? ""} disabled={!can} onChange={(event) => edit(task, { assigneePersonId: event.target.value || null }, { assigneePersonId: event.target.value })} className="h-7 w-36 text-xs md:text-xs">
                      <option value="">{tList("unassigned")}</option>
                      {task.assigneePersonId && !options.people.some((person) => person.id === task.assigneePersonId) ? <option value={task.assigneePersonId}>{task.assigneeName ?? "…"}</option> : null}
                      {options.people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.fullName}
                        </option>
                      ))}
                    </Select>
                  </td>
                  {(["startDate", "dueDate"] as const).map((key) => (
                    <td key={key} className="px-2 py-1">
                      <Input
                        type="date"
                        aria-label={t(key)}
                        key={task[key] ?? ""}
                        defaultValue={task[key] ?? ""}
                        disabled={!can}
                        onChange={(event) => edit(task, { [key]: event.target.value || null }, { [key]: event.target.value })}
                        className={`h-7 w-36 text-xs md:text-xs ${key === "dueDate" && overdue ? "text-destructive" : ""}`}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <Select aria-label={t("priority")} value={task.priority ?? ""} disabled={!can} onChange={(event) => edit(task, { priority: event.target.value ? Number(event.target.value) : null }, { priority: event.target.value })} className="h-7 w-28 text-xs md:text-xs">
                      <option value="">{tWork("priority.none")}</option>
                      {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {tWork(`priority.${priority}`)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-right">
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
                      className="h-7 w-20 text-right text-xs md:text-xs"
                    />
                  </td>
                  {logged ? <td className="px-2 py-1 text-right text-xs whitespace-nowrap text-muted-foreground">{logged[task.id] ? hours(logged[task.id]) : ""}</td> : null}
                  <td className="px-2 py-1">
                    <LabelCell task={task} options={options} disabled={!can} onChange={(labelIds) => edit(task, { labelIds }, { labelIds })} />
                  </td>
                  {fields.map((field) => (
                    <td key={field.id} className="px-2 py-1">
                      {own.includes(field) ? <CustomValueInput compact field={field} value={task.customValues?.[field.id]} people={options.people} disabled={!can} onCommit={(value) => edit(task, { customValues: { [field.id]: value } }, { customValues: { [field.id]: value } })} /> : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted/40 text-xs">
            <tr>
              <td colSpan={8} className="px-2 py-2 font-medium">
                {t("totals", { count: visible.length })}
              </td>
              <td className="px-2 py-2 text-right font-medium whitespace-nowrap">{t("hours", { value: hours(totals.estimate) })}</td>
              {logged ? <td className="px-2 py-2 text-right font-medium whitespace-nowrap">{t("hours", { value: hours(totals.logged) })}</td> : null}
              <td colSpan={1 + fields.length} />
            </tr>
          </tfoot>
        </table>
      </div>
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
      <summary className="flex min-h-7 cursor-pointer list-none flex-wrap items-center gap-1 rounded-md border px-1.5 py-0.5" aria-label={t("editLabels", { key: task.key })}>
        {chips.length ? chips.map((label) => <LabelChip key={label.id} name={label.name} color={label.color} />) : <span className="text-xs text-muted-foreground">+</span>}
      </summary>
      <div className="absolute z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-md border bg-background p-2 shadow-md">
        {options.labels.map((label) => (
          <label key={label.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={task.labelIds.includes(label.id)} onChange={(event) => onChange(event.target.checked ? [...task.labelIds, label.id] : task.labelIds.filter((id) => id !== label.id))} />
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
    if (what === "startDate" || what === "dueDate") return <Input type="date" aria-label={t("value")} value={value} onChange={(event) => setValue(event.target.value)} className="h-8 w-40" />;
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
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2 shadow-sm">
      <span className="text-sm font-medium">{t("selected", { count: ids.length })}</span>
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
