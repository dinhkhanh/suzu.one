"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createTaskAction, deleteViewAction, saveViewAction, updateTaskAction } from "../actions";
import { FILTER_KEYS, filterTasks, type Grouping, GROUPINGS, groupTasks, nestTasks, type TaskFilters } from "../engine/filter";
import { PRIORITIES } from "../enums";
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
};

export type ListOptions = {
  states: { id: string; name: string; category: string; isActive: boolean }[];
  people: { id: string; fullName: string }[];
  labels: { id: string; name: string; color: string }[];
  clients: { id: string; name: string }[];
};

const PRIORITY_CLASS: Record<number, string> = { 1: "text-red-600 dark:text-red-400", 2: "text-orange-600 dark:text-orange-400", 3: "text-blue-600 dark:text-blue-400", 4: "text-muted-foreground" };

export function TaskListView({
  tasks,
  options,
  scope,
  initialFilters,
  initialGrouping,
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
  initialGrouping: Grouping;
  selfId: string;
  today: string;
  canContribute: boolean;
  /** Project lists only: named filter sets, the viewer's own and the shared ones. */
  savedViews?: { id: string; name: string; isShared: boolean; mine: boolean; canDelete: boolean; filters: Record<string, string> }[];
}) {
  const t = useTranslations("work.list");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [grouping, setGrouping] = useState<Grouping>(initialGrouping);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleInput = useRef<HTMLInputElement>(null);
  // Shown at once; the server's answer replaces them when the page data refreshes.
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: ListTask[], change: { type: "state"; id: string; stateId: string } | { type: "add"; task: ListTask }) =>
    change.type === "add" ? [...current, change.task] : current.map((task) => (task.id === change.id ? { ...task, stateId: change.stateId } : task)),
  );

  // Filters live in the URL (shareable, survive a reload) without a server round trip.
  function sync(nextFilters: TaskFilters, nextGrouping: Grouping) {
    const params = new URLSearchParams(window.location.search);
    for (const key of FILTER_KEYS) {
      if (nextFilters[key]) params.set(key, nextFilters[key]);
      else params.delete(key);
    }
    if (nextGrouping === "none") params.delete("group");
    else params.set("group", nextGrouping);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }
  const setFilter = (key: keyof TaskFilters, value: string) => {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    sync(next, grouping);
  };

  const visible = useMemo(() => filterTasks(shown, filters, { selfId, today }), [shown, filters, selfId, today]);
  const groups = useMemo(() => {
    const order = grouping === "status" ? options.states.map((state) => state.id) : grouping === "assignee" ? options.people.map((person) => person.id) : options.clients.map((client) => client.id);
    return groupTasks(visible, grouping, order);
  }, [visible, grouping, options]);
  const groupName = (key: string) => {
    if (grouping === "status") return options.states.find((state) => state.id === key)?.name ?? key;
    if (grouping === "assignee") return key === "none" ? t("unassigned") : (options.people.find((person) => person.id === key)?.fullName ?? shown.find((task) => task.assigneePersonId === key)?.assigneeName ?? key);
    return key === "none" ? t("noClient") : (options.clients.find((client) => client.id === key)?.name ?? key);
  };
  const failed = (result: { ok: boolean; error?: string; message?: string }) => setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

  function moveState(task: ListTask, stateId: string) {
    startTransition(async () => {
      applyOptimistic({ type: "state", id: task.id, stateId });
      const result = await updateTaskAction({ taskId: task.id, stateId });
      failed(result);
      router.refresh();
    });
  }

  function quickCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = titleInput.current?.value.trim();
    if (!title) return;
    // A task created while filtering lands inside the filter, so it does not vanish on arrival.
    const assignee = filters.assignee === "me" ? selfId : filters.assignee && filters.assignee !== "none" ? filters.assignee : "";
    const state = options.states.find((row) => row.id === filters.state && row.isActive);
    titleInput.current!.value = "";
    startTransition(async () => {
      applyOptimistic({ type: "add", task: { id: `new-${title}`, key: "…", title, status: "todo", stateId: state?.id ?? "", priority: null, assigneePersonId: assignee || null, assigneeName: null, dueDate: null, clientId: null, labelIds: [], parentTaskId: null, blockedBy: 0, subtasks: { done: 0, total: 0 }, checklist: { done: 0, total: 0 } } });
      const result = await createTaskAction({ teamId: scope.teamId, ...(scope.projectId ? { projectId: scope.projectId } : {}), title, stateId: state?.id ?? "", assigneePersonId: assignee, labelIds: filters.label ? [filters.label] : [] });
      failed(result);
      router.refresh();
    });
  }

  const filtered = FILTER_KEYS.some((key) => filters[key]);

  function applyView(view: { filters: Record<string, string> }) {
    const next: TaskFilters = Object.fromEntries(FILTER_KEYS.flatMap((key) => (view.filters[key] ? [[key, view.filters[key]]] : [])));
    const nextGrouping = GROUPINGS.includes(view.filters.group as Grouping) ? (view.filters.group as Grouping) : "none";
    setFilters(next);
    setGrouping(nextGrouping);
    sync(next, nextGrouping);
  }
  function saveView(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = { ...Object.fromEntries(FILTER_KEYS.flatMap((key) => (filters[key] ? [[key, filters[key]]] : []))), ...(grouping === "none" ? {} : { group: grouping }) };
    startTransition(async () => {
      failed(await saveViewAction({ projectId: scope.projectId, name: data.get("name"), isShared: data.get("isShared") === "on", filters: current }));
      form.reset();
      router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label={t("search")} placeholder={t("search")} value={filters.q ?? ""} onChange={(event) => setFilter("q", event.target.value)} className="w-52" />
        <Select aria-label={t("assignee")} value={filters.assignee ?? ""} onChange={(event) => setFilter("assignee", event.target.value)} className="w-40">
          <option value="">{t("anyAssignee")}</option>
          <option value="me">{t("me")}</option>
          <option value="none">{t("unassigned")}</option>
          {options.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
        <Select aria-label={t("state")} value={filters.state ?? ""} onChange={(event) => setFilter("state", event.target.value)} className="w-40">
          <option value="">{t("anyState")}</option>
          {options.states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t("priority")} value={filters.priority ?? ""} onChange={(event) => setFilter("priority", event.target.value)} className="w-36">
          <option value="">{t("anyPriority")}</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {tWork(`priority.${priority}`)}
            </option>
          ))}
          <option value="none">{tWork("priority.none")}</option>
        </Select>
        {options.labels.length ? (
          <Select aria-label={t("label")} value={filters.label ?? ""} onChange={(event) => setFilter("label", event.target.value)} className="w-36">
            <option value="">{t("anyLabel")}</option>
            {options.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </Select>
        ) : null}
        {options.clients.length ? (
          <Select aria-label={t("client")} value={filters.client ?? ""} onChange={(event) => setFilter("client", event.target.value)} className="w-40">
            <option value="">{t("anyClient")}</option>
            <option value="none">{t("noClient")}</option>
            {options.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label={t("due")} value={filters.due ?? ""} onChange={(event) => setFilter("due", event.target.value)} className="w-36">
          <option value="">{t("anyDue")}</option>
          <option value="overdue">{t("dueOverdue")}</option>
          <option value="week">{t("dueWeek")}</option>
          <option value="none">{t("dueNone")}</option>
        </Select>
        <Select
          aria-label={t("group")}
          value={grouping}
          onChange={(event) => {
            const next = event.target.value as Grouping;
            setGrouping(next);
            sync(filters, next);
          }}
          className="w-44"
        >
          {GROUPINGS.map((value) => (
            <option key={value} value={value}>
              {t(`grouping.${value}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.closed === "1"} onChange={(event) => setFilter("closed", event.target.checked ? "1" : "")} /> {t("showClosed")}
        </label>
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilters({});
              sync({}, grouping);
            }}
          >
            {t("clear")}
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">{t("count", { shown: visible.length, total: shown.length })}</span>
      </div>

      {savedViews && scope.projectId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {savedViews.map((view) => (
            <span key={view.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5">
              <button type="button" className="hover:underline" onClick={() => applyView(view)}>
                {view.name}
              </button>
              {view.isShared ? <span className="text-xs text-muted-foreground">{t("views.shared")}</span> : null}
              {view.canDelete ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  aria-label={t("views.delete", { name: view.name })}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      failed(await deleteViewAction({ viewId: view.id }));
                      router.refresh();
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {filtered || grouping !== "none" ? (
            <form onSubmit={saveView} className="flex flex-wrap items-center gap-2">
              <Input name="name" required maxLength={60} placeholder={t("views.name")} aria-label={t("views.name")} className="h-7 w-44" />
              {canContribute ? (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="isShared" /> {t("views.share")}
                </label>
              ) : null}
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {t("views.save")}
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

      {canContribute ? (
        <form onSubmit={quickCreate} className="flex items-center gap-2">
          <Input ref={titleInput} data-quick-create aria-label={t("quickCreate")} placeholder={t("quickCreate")} maxLength={200} className="flex-1" />
          <Button type="submit" size="sm" disabled={pending}>
            {t("add")}
          </Button>
        </form>
      ) : null}

      {visible.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">{shown.length === 0 ? t("empty") : t("noMatch")}</p> : null}
      {groups.map((group) =>
        group.tasks.length === 0 ? null : (
          <section key={group.key} className="flex flex-col gap-1">
            {grouping === "none" ? null : (
              <h3 className="flex items-center gap-2 px-1 pt-2 text-sm font-medium">
                {groupName(group.key)} <span className="text-xs text-muted-foreground">{group.tasks.length}</span>
              </h3>
            )}
            <ul className="flex flex-col divide-y rounded-xl border">
              {nestTasks(group.tasks).map(({ task, depth }) => {
                const open = task.status === "todo" || task.status === "in_progress";
                const overdue = open && task.dueDate !== null && task.dueDate < today;
                const editable = (canContribute || task.assigneePersonId === selfId) && !task.id.startsWith("new-");
                return (
                  <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                    <span className={`w-4 text-center text-xs font-bold ${task.priority ? PRIORITY_CLASS[task.priority] : "text-transparent"}`} title={task.priority ? tWork(`priority.${task.priority}`) : undefined}>
                      {task.priority ? (task.priority === 4 ? "↓" : "!".repeat(4 - task.priority)) : "·"}
                    </span>
                    <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
                    <Link href={`/work/tasks/${task.id}`} className={`min-w-0 flex-1 truncate hover:underline ${open ? "font-medium" : "text-muted-foreground line-through"}`}>
                      {task.title}
                    </Link>
                    {task.blockedBy > 0 ? <Badge variant="destructive">{t("blocked")}</Badge> : null}
                    {task.subtasks.total > 0 ? <span className="text-xs text-muted-foreground">{t("subtasks", task.subtasks)}</span> : null}
                    {task.checklist.total > 0 ? <span className="text-xs text-muted-foreground">☑ {task.checklist.done}/{task.checklist.total}</span> : null}
                    {task.labelIds.map((id) => {
                      const label = options.labels.find((row) => row.id === id);
                      return label ? <LabelChip key={id} name={label.name} color={label.color} /> : null;
                    })}
                    <span className="w-32 truncate text-xs text-muted-foreground">{task.assigneeName ?? options.people.find((person) => person.id === task.assigneePersonId)?.fullName ?? t("unassigned")}</span>
                    <span className={`w-24 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{task.dueDate ? format.dateTime(new Date(`${task.dueDate}T00:00:00`), { day: "numeric", month: "short" }) : ""}</span>
                    {editable ? (
                      <Select aria-label={t("state")} value={task.stateId} disabled={pending} onChange={(event) => moveState(task, event.target.value)} className="h-7 w-36 text-xs md:text-xs">
                        {options.states
                          .filter((state) => state.isActive || state.id === task.stateId)
                          .map((state) => (
                            <option key={state.id} value={state.id}>
                              {state.name}
                            </option>
                          ))}
                      </Select>
                    ) : (
                      <Badge variant="outline" className="w-36 justify-start">
                        {options.states.find((state) => state.id === task.stateId)?.name ?? "…"}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
