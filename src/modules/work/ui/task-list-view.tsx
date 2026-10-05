"use client";
import { ArrowUpDownIcon, LayersIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { RecordLink } from "@/components/ui/record-link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createTaskAction, deleteViewAction, saveViewAction, updateViewAction } from "../actions";
import { customKey, fieldIdOf } from "../engine/custom-fields";
import { filterEntries, filterTasks, GROUPINGS, groupTasks, type ListGrouping, type ListSort, nestTasks, readFilters, readGrouping, readSort, SORTS, sortTasks, type TaskFilters } from "../engine/filter";
import { CustomValueText, type FieldView } from "./custom-fields";
import { FilterBar, MenuPicker, writeFiltersToUrl } from "./filter-bar";
import { StateBadge } from "./status-badge";
import { DueText, dotOf, PersonAvatar, StateDot, TaskKey } from "./task-row";
import { LabelChip } from "./team-forms";

export type ListTask = {
  id: string;
  key: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "cancelled";
  stateId: string;
  priority: number | null;
  assigneePersonId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  clientId: string | null;
  labelIds: string[];
  parentTaskId: string | null;
  blockedBy: number;
  subtasks: { done: number; total: number };
  checklist: { done: number; total: number };
  startDate?: string | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  /** FR-PJM-35. */
  customValues?: Record<string, unknown>;
  /** FR-PJM-32: pending / snoozed work is hidden unless the filter asks. */
  triageStatus?: string | null;
  /** FR-PJM-28. */
  blocker?: { reason: string; neededName: string | null } | null;
  /** FR-PJM-10. */
  cycleId?: string | null;
  /** FR-PJM-44: the assignee is on leave — "away, covered by X". */
  away?: { until: string; coverName: string | null } | null;
};

export type ListOptions = {
  states: { id: string; name: string; category: string; isActive: boolean }[];
  people: { id: string; fullName: string }[];
  labels: { id: string; name: string; color: string }[];
  clients: { id: string; name: string }[];
  /** The custom fields of the list's tasks (FR-PJM-35). */
  fields?: FieldView[];
  /** The team's open cycles (FR-PJM-10), for the filter and bulk edit. */
  cycles?: { id: string; label: string }[];
};

/** Sort choices: the fixed ones both ways, then each field's. */
export function sortChoices(fields: FieldView[]): { value: string; field?: FieldView }[] {
  return [...SORTS.flatMap((key) => (key === "rank" ? [{ value: key }] : [{ value: key }, { value: `-${key}` }])), ...fields.flatMap((field) => [{ value: customKey(field.id), field }, { value: `-${customKey(field.id)}`, field }])];
}

const PRIORITY_CLASS: Record<number, string> = { 1: "text-destructive", 2: "text-tone-orange", 3: "text-info", 4: "text-faint" };

/** The priority as a short mark: "!!!" for urgent down to "↓" for low; nothing when unset. */
export function PriorityMark({ priority, title }: { priority: number | null; title?: string }) {
  if (!priority) return null;
  return (
    <span className={`shrink-0 font-mono text-[0.6875rem] font-bold ${PRIORITY_CLASS[priority]}`} title={title} aria-label={title}>
      {priority === 4 ? "↓" : "!".repeat(4 - priority)}
    </span>
  );
}

const typingInField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function TaskListView({
  tasks,
  options,
  scope,
  initialFilters,
  initialGrouping,
  initialSort = "rank",
  selfId,
  today,
  canContribute,
  savedViews,
}: {
  tasks: ListTask[];
  options: ListOptions;
  /** Where quick-create files a new task. */
  scope: { teamId: string; projectId: string | null };
  initialFilters: TaskFilters;
  initialGrouping: ListGrouping;
  initialSort?: ListSort;
  selfId: string;
  today: string;
  canContribute: boolean;
  /** Named filter sets of this list — a project's, or a team backlog's: the viewer's own and the shared ones. */
  savedViews?: { id: string; name: string; isShared: boolean; mine: boolean; /** May rename it, change its filters, share or unshare it. */ canEdit: boolean; canDelete: boolean; filters: Record<string, string> }[];
}) {
  const t = useTranslations("work.list");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [activeView, setActiveView] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [grouping, setGrouping] = useState<ListGrouping>(initialGrouping);
  const [sort, setSort] = useState<ListSort>(initialSort);
  const fields = useMemo(() => (options.fields ?? []).filter((field) => field.isActive), [options.fields]);
  const cardFields = fields.filter((field) => field.showOnCard);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleInput = useRef<HTMLInputElement>(null);
  const addRow = useRef<HTMLDetailsElement>(null);
  // Shown at once; the server's answer replaces them when the page data refreshes.
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: ListTask[], added: ListTask) => [...current, added]);

  // "C" (the palette's shortcut) focuses the quick-create box: unfold the add row first, so the
  // focus lands. Capture phase, so this runs before the palette's own listener.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "c" && !event.metaKey && !event.ctrlKey && !event.altKey && !typingInField(event.target) && addRow.current) addRow.current.open = true;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Filters live in the URL (shareable, survive a reload) without a server round trip — but for
  // closed tasks, which the page loads only once they are asked for.
  function sync(nextFilters: TaskFilters, nextGrouping: ListGrouping, nextSort: ListSort = sort) {
    writeFiltersToUrl(nextFilters, { group: nextGrouping === "none" ? null : nextGrouping, sort: nextSort === "rank" ? null : nextSort }, (href) => router.replace(href, { scroll: false }));
  }
  const setFilter = (key: keyof TaskFilters, value: string) => {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    sync(next, grouping);
  };

  const names = useMemo(() => new Map(options.people.map((person) => [person.id, person.fullName])), [options.people]);
  const stateById = useMemo(() => new Map(options.states.map((state) => [state.id, state])), [options.states]);
  const visible = useMemo(() => sortTasks(filterTasks(shown, filters, { selfId, today, fields }), sort, fields, names), [shown, filters, selfId, today, fields, sort, names]);
  const groupField = fields.find((field) => field.id === fieldIdOf(grouping));
  const groups = useMemo(() => {
    const order = groupField ? (groupField.type === "checkbox" ? ["1", "0"] : groupField.type === "person" ? options.people.map((person) => person.id) : groupField.options.map((option) => option.id)) : grouping === "status" ? options.states.map((state) => state.id) : grouping === "assignee" ? options.people.map((person) => person.id) : options.clients.map((client) => client.id);
    return groupTasks(visible, grouping, order, fields);
  }, [visible, grouping, options, fields, groupField]);
  const groupName = (key: string) => {
    if (groupField) {
      if (key === "none") return tWork("customFields.filterEmpty", { name: groupField.name });
      if (groupField.type === "checkbox") return `${groupField.name}: ${key === "1" ? tWork("customFields.yes") : tWork("customFields.no")}`;
      if (groupField.type === "person") return names.get(key) ?? key;
      if (groupField.type === "select" || groupField.type === "multi_select") return groupField.options.find((option) => option.id === key)?.label ?? key;
      return key;
    }
    if (grouping === "status") return stateById.get(key)?.name ?? key;
    if (grouping === "assignee") return key === "none" ? t("unassigned") : (names.get(key) ?? shown.find((task) => task.assigneePersonId === key)?.assigneeName ?? key);
    return key === "none" ? t("noClient") : (options.clients.find((client) => client.id === key)?.name ?? key);
  };
  const failed = (result: { ok: boolean; error?: string; message?: string }) => setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

  function quickCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = titleInput.current?.value.trim();
    if (!title) return;
    // A task created while filtering lands inside the filter, so it does not vanish on arrival.
    const assignee = filters.assignee === "me" ? selfId : filters.assignee && filters.assignee !== "none" ? filters.assignee : "";
    const state = options.states.find((row) => row.id === filters.state && row.isActive);
    titleInput.current!.value = "";
    startTransition(async () => {
      applyOptimistic({ id: `new-${title}`, key: "…", title, status: "todo", stateId: state?.id ?? "", priority: null, assigneePersonId: assignee || null, assigneeName: null, dueDate: null, clientId: null, labelIds: [], parentTaskId: null, blockedBy: 0, subtasks: { done: 0, total: 0 }, checklist: { done: 0, total: 0 } });
      const result = await createTaskAction({ teamId: scope.teamId, ...(scope.projectId ? { projectId: scope.projectId } : {}), title, stateId: state?.id ?? "", assigneePersonId: assignee, labelIds: filters.label ? [filters.label] : [] });
      failed(result);
      router.refresh();
    });
  }

  const filtered = filterEntries(filters).length > 0;

  function applyView(view: { id: string; filters: Record<string, string> }) {
    // Saved before custom fields existed or after: whatever keys the view has, the list reads.
    const next = readFilters(view.filters);
    const nextGrouping = readGrouping(view.filters.group);
    const nextSort = readSort(view.filters.sort);
    setFilters(next);
    setGrouping(nextGrouping);
    setSort(nextSort);
    setActiveView(view.id);
    sync(next, nextGrouping, nextSort);
  }
  // The view last applied, where the viewer may change it: the form below can rewrite it in place.
  const active = savedViews?.find((view) => view.id === activeView && view.canEdit) ?? null;
  function saveView(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = { ...Object.fromEntries(filterEntries(filters)), ...(grouping === "none" ? {} : { group: grouping }), ...(sort === "rank" ? {} : { sort }) };
    // Which of the form's two buttons was pressed: "update" rewrites the view in use, the other saves a new one.
    const update = active && (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "update" ? active : null;
    // Sharing is offered only to the people working on the list; without the box, the view stays as shared as it was.
    const shared = canContribute ? { isShared: data.get("isShared") === "on" } : {};
    startTransition(async () => {
      failed(update ? await updateViewAction({ viewId: update.id, name: data.get("name"), filters: current, ...shared }) : await saveViewAction({ projectId: scope.projectId, teamId: scope.teamId, name: data.get("name"), filters: current, ...shared }));
      if (!update) form.reset();
      router.refresh();
    });
  }

  const groupChoices = [
    ...GROUPINGS.map((value) => ({ value, label: t(`grouping.${value}`) })),
    ...fields.filter((field) => field.type !== "text" && field.type !== "url").map((field) => ({ value: customKey(field.id), label: t("groupByField", { name: field.name }) })),
  ];
  const sortOptions = sortChoices(fields).map((choice) => ({ value: choice.value, label: choice.field ? t(choice.value.startsWith("-") ? "sorts.-field" : "sorts.field", { name: choice.field.name }) : t(`sorts.${choice.value as "rank"}`) }));

  const row = (task: ListTask, depth: number) => {
    const open = task.status === "todo" || task.status === "in_progress";
    const state = stateById.get(task.stateId);
    const assignee = task.assigneeName ?? (task.assigneePersonId ? names.get(task.assigneePersonId) : null) ?? null;
    const chips = (
      <>
        {task.blocker ? (
          <Badge variant="destructive" title={task.blocker.neededName ? `${task.blocker.reason} — ${tWork.markup("blockers.waitingOn", { name: task.blocker.neededName, who: (chunks) => chunks })}` : task.blocker.reason}>
            {tWork("blockers.badge")}
          </Badge>
        ) : null}
        {task.blockedBy > 0 ? <Badge variant="destructive">{t("blocked")}</Badge> : null}
        {task.triageStatus === "pending" || task.triageStatus === "snoozed" ? <Badge variant="warning">{t("inTriage")}</Badge> : null}
        {task.away ? <Badge variant="outline">{task.away.coverName ? tWork("cover.awayCovered", { name: task.away.coverName }) : tWork("cover.away")}</Badge> : null}
        {task.labelIds.map((id) => {
          const label = options.labels.find((row) => row.id === id);
          return label ? <LabelChip key={id} name={label.name} color={label.color} /> : null;
        })}
        {cardFields.map((field) =>
          task.customValues?.[field.id] === undefined ? null : (
            <span key={field.id} className="text-xs text-muted-foreground" title={field.name}>
              <CustomValueText field={field} value={task.customValues[field.id]} people={options.people} />
            </span>
          ),
        )}
        {task.subtasks.total > 0 ? <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{t("subtasks", task.subtasks)}</span> : null}
        {task.checklist.total > 0 ? (
          <span className="font-mono text-[0.6875rem] text-faint tabular-nums">
            ☑ {task.checklist.done}/{task.checklist.total}
          </span>
        ) : null}
      </>
    );
    return (
      <TableRow key={task.id}>
        <TableCell className="w-px pr-0">
          <StateDot category={state?.category ?? dotOf(task.status)} title={state?.name} />
        </TableCell>
        <TableCell kind="id" className="hidden md:table-cell">
          {task.key}
        </TableCell>
        <TableCell className="max-w-0 min-w-56 py-1.5" style={depth ? { paddingLeft: `${0.75 + depth * 1.25}rem` } : undefined}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <PriorityMark priority={task.priority} title={task.priority ? tWork(`priority.${task.priority as 1}`) : undefined} />
              <RecordLink kind="task" id={task.id.startsWith("new-") ? null : task.id} title={task.title} className={`min-w-0 truncate ${open ? "font-medium" : "text-muted-foreground line-through"}`}>
                {task.title}
              </RecordLink>
              <span className="hidden min-w-0 items-center gap-1.5 md:flex">{chips}</span>
            </span>
            {/* On a phone the row's columns fold into a meta line under the title. */}
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
              <TaskKey>{task.key}</TaskKey>
              {state ? <StateBadge category={state.category} name={state.name} /> : null}
              <DueText dueDate={task.dueDate} today={today} open={open} />
              {chips}
            </span>
          </span>
        </TableCell>
        <TableCell className="w-px">
          <span className="flex items-center gap-2" title={assignee ?? t("unassigned")}>
            <PersonAvatar name={assignee} />
            <span className="hidden max-w-32 truncate text-xs text-muted-foreground lg:inline">{assignee ? <RecordLink kind="person" id={task.assigneePersonId}>{assignee}</RecordLink> : t("unassigned")}</span>
          </span>
        </TableCell>
        <TableCell kind="date" className="hidden w-px md:table-cell">
          <DueText dueDate={task.dueDate} today={today} open={open} />
        </TableCell>
        {/* The state is read here and changed on the task's page, where its gates can speak. */}
        <TableCell className="hidden w-px max-w-44 md:table-cell">{state ? <StateBadge category={state.category} name={state.name} /> : <span className="text-xs text-faint">…</span>}</TableCell>
      </TableRow>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} setFilter={setFilter} clear={() => {
        setFilters({});
        sync({}, grouping);
      }} options={options} showState showDue>
        <MenuPicker
          icon={<LayersIcon data-icon="inline-start" />}
          label={t("group")}
          value={grouping}
          choices={groupChoices}
          onChange={(value) => {
            const next = readGrouping(value);
            setGrouping(next);
            sync(filters, next);
          }}
        />
        <MenuPicker
          icon={<ArrowUpDownIcon data-icon="inline-start" />}
          label={t("sort")}
          value={sort}
          choices={sortOptions}
          onChange={(value) => {
            const next = readSort(value);
            setSort(next);
            sync(filters, grouping, next);
          }}
        />
        <span className="font-mono text-xs text-faint tabular-nums">{t("count", { shown: visible.length, total: shown.length })}</span>
      </FilterBar>

      {savedViews ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {savedViews.map((view) => (
            <Badge key={view.id} variant={view.id === activeView ? "secondary" : "outline"} className="h-7 gap-1 pr-1 pl-2.5">
              <button type="button" className="hover:text-foreground" onClick={() => applyView(view)}>
                {view.name}
              </button>
              {view.isShared ? <span className="text-[0.6875rem] text-faint">{t("views.shared")}</span> : null}
              {view.canDelete ? (
                <button
                  type="button"
                  className="press flex size-5 items-center justify-center rounded-full hover:bg-foreground/10 hover:text-destructive [&_svg]:size-3"
                  aria-label={t("views.delete", { name: view.name })}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      failed(await deleteViewAction({ viewId: view.id }));
                      router.refresh();
                    })
                  }
                >
                  <XIcon />
                </button>
              ) : null}
            </Badge>
          ))}
          {filtered || grouping !== "none" || active ? (
            // Keyed by the view in use: its name and sharing fill the form, ready to be changed in place.
            <form key={active?.id ?? "new"} onSubmit={saveView} className="flex flex-wrap items-center gap-2">
              <Input name="name" required maxLength={60} defaultValue={active?.name} placeholder={t("views.name")} aria-label={t("views.name")} className="h-8 w-44 md:h-7" />
              {canContribute ? (
                <Label className="flex items-center gap-1.5 text-xs font-normal">
                  <Checkbox name="isShared" defaultChecked={active?.isShared} /> {t(scope.projectId ? "views.share" : "views.shareTeam")}
                </Label>
              ) : null}
              {active ? (
                <Button type="submit" name="intent" value="update" size="xs" variant="outline" disabled={pending}>
                  {t("views.update", { name: active.name })}
                </Button>
              ) : null}
              <Button type="submit" size="xs" variant="outline" disabled={pending}>
                {active ? t("views.saveNew") : t("views.save")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="status" className="w-px" />
              <TableHead kind="id" className="hidden md:table-cell">
                {tWork("table.key")}
              </TableHead>
              <TableHead kind="text">{tWork("table.title")}</TableHead>
              <TableHead kind="person" className="w-px">
                <span className="sr-only lg:not-sr-only">{t("assignee")}</span>
              </TableHead>
              <TableHead kind="date" className="hidden w-px md:table-cell">
                {t("due")}
              </TableHead>
              <TableHead kind="status" className="hidden w-px md:table-cell">
                {t("state")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? <TableEmpty>{shown.length === 0 ? t("empty") : t("noMatch")}</TableEmpty> : null}
            {groups.map((group) => {
              if (group.tasks.length === 0) return null;
              const band =
                grouping === "none" ? null : (
                  <TableGroupRow key={`group-${group.key}`}>
                    <span className="flex items-center gap-2">
                      {grouping === "status" ? <StateBadge category={stateById.get(group.key)?.category ?? "todo"} name={groupName(group.key)} /> : <span>{groupName(group.key)}</span>}
                      <span className="font-mono text-[0.6875rem] font-normal text-faint tabular-nums">{group.tasks.length}</span>
                    </span>
                  </TableGroupRow>
                );
              return [band, ...nestTasks(group.tasks).map(({ task, depth }) => row(task, depth))];
            })}
          </TableBody>
        </Table>
        {canContribute ? (
          <TableAddRow ref={addRow} label={t("newTask")} open bodyClassName="border-t bg-background px-3 py-2 md:pl-[calc(var(--table-gutter)+0.75rem)]">
            <form onSubmit={quickCreate} className="flex items-center gap-2">
              <Input ref={titleInput} data-quick-create aria-label={t("quickCreate")} placeholder={t("quickCreate")} maxLength={200} className="h-9 flex-1 md:h-8" />
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {t("add")}
              </Button>
            </form>
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
