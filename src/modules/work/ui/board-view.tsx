"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { updateTaskAction } from "../actions";
import { boardColumns, isSamePlace, planDrop } from "../engine/board";
import { filterTasks, type TaskFilters } from "../engine/filter";
import { FilterBar, useUrlFilters } from "./filter-bar";
import type { ListOptions, ListTask } from "./task-list-view";
import { LabelChip } from "./team-forms";

export type BoardTask = ListTask & { boardRank: number; updatedAt: string };

const RECENT_DAYS = 14;
const PRIORITY_CLASS: Record<number, string> = { 1: "border-l-red-500", 2: "border-l-orange-500", 3: "border-l-blue-500", 4: "border-l-muted-foreground/40" };

/**
 * Kanban board (FR-WRK-05): one column per workflow state of the team. A drop shows at once
 * (`useOptimistic`); if the server refuses, the card goes back by itself and the reason is shown.
 */
export function BoardView({ tasks, options, initialFilters, selfId, today, canContribute }: { tasks: BoardTask[]; options: ListOptions; initialFilters: TaskFilters; selfId: string; today: string; canContribute: boolean }) {
  const t = useTranslations("work.board");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const { filters, setFilter, clear } = useUrlFilters(initialFilters);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ stateId: string; index: number } | null>(null);
  const [, startTransition] = useTransition();
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: BoardTask[], move: { id: string; stateId: string; boardRank: number; status: BoardTask["status"] }) => current.map((task) => (task.id === move.id ? { ...task, ...move } : task)));

  const states = useMemo(() => options.states.filter((state) => state.isActive || shown.some((task) => task.stateId === state.id)), [options.states, shown]);
  const columns = useMemo(() => {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString();
    // The board always has its "done" columns; without "show closed" they hold the last two weeks only.
    const visible = filterTasks(shown, { ...filters, closed: "1" }, { selfId, today }).filter((task) => filters.closed === "1" || task.status === "todo" || task.status === "in_progress" || task.updatedAt >= since);
    return boardColumns(visible, states.map((state) => state.id));
  }, [shown, filters, selfId, today, states]);

  const statusOf = (stateId: string): BoardTask["status"] => {
    const category = options.states.find((state) => state.id === stateId)?.category;
    return category === "done" ? "done" : category === "cancelled" ? "cancelled" : category === "in_progress" || category === "in_review" ? "in_progress" : "todo";
  };
  const editable = (task: BoardTask) => canContribute || task.assigneePersonId === selfId;

  function move(task: BoardTask, stateId: string, index: number) {
    const column = columns.get(stateId) ?? [];
    if (isSamePlace(column, task, stateId, index)) return;
    const { boardRank, ...position } = planDrop(column, task.id, index);
    startTransition(async () => {
      applyOptimistic({ id: task.id, stateId, boardRank, status: statusOf(stateId) });
      const result = await updateTaskAction({ taskId: task.id, ...(stateId === task.stateId ? {} : { stateId }), position });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      router.refresh();
    });
  }

  function onDrop(event: React.DragEvent, stateId: string) {
    event.preventDefault();
    const task = shown.find((row) => row.id === (dragging ?? event.dataTransfer.getData("text/plain")));
    const index = target?.stateId === stateId ? target.index : (columns.get(stateId)?.length ?? 0);
    setDragging(null);
    setTarget(null);
    if (task && editable(task)) move(task, stateId, index);
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} setFilter={setFilter} clear={clear} options={options} />
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {states.map((state) => {
          const cards = columns.get(state.id) ?? [];
          return (
            <section
              key={state.id}
              aria-label={state.name}
              className={`flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2 ${dragging && target?.stateId === state.id ? "ring-2 ring-ring" : ""}`}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                if (target?.stateId !== state.id) setTarget({ stateId: state.id, index: cards.filter((card) => card.id !== dragging).length });
              }}
              onDrop={(event) => onDrop(event, state.id)}
            >
              <h3 className="flex items-center justify-between px-1 text-sm font-medium">
                <span className="truncate">{state.name}</span>
                <span className="text-xs text-muted-foreground">{cards.length}</span>
              </h3>
              <ul className="flex min-h-10 flex-col gap-2">
                {cards.map((task, position) => {
                  const open = task.status === "todo" || task.status === "in_progress";
                  const overdue = open && task.dueDate !== null && task.dueDate < today;
                  const others = cards.filter((card) => card.id !== dragging);
                  const showGap = dragging && dragging !== task.id && target?.stateId === state.id && others[target.index]?.id === task.id;
                  return (
                    <li
                      key={task.id}
                      draggable={editable(task)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(task.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setTarget(null);
                      }}
                      onDragOver={(event) => {
                        if (!dragging || dragging === task.id) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const box = event.currentTarget.getBoundingClientRect();
                        const own = others.findIndex((card) => card.id === task.id);
                        const index = event.clientY < box.top + box.height / 2 ? own : own + 1;
                        if (target?.stateId !== state.id || target.index !== index) setTarget({ stateId: state.id, index });
                      }}
                      className={`flex flex-col gap-1.5 rounded-lg border border-l-4 bg-background p-2 text-sm shadow-xs ${task.priority ? PRIORITY_CLASS[task.priority] : "border-l-transparent"} ${dragging === task.id ? "opacity-40" : ""} ${showGap ? "mt-8" : ""} ${editable(task) ? "cursor-grab" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{task.key}</span>
                        {task.dueDate ? <span className={overdue ? "font-medium text-destructive" : ""}>{format.dateTime(new Date(`${task.dueDate}T00:00:00`), { day: "numeric", month: "short" })}</span> : null}
                      </div>
                      <Link href={`/work/tasks/${task.id}`} draggable={false} className={`hover:underline ${open ? "font-medium" : "text-muted-foreground line-through"}`}>
                        {task.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1">
                        {task.blockedBy > 0 ? <Badge variant="destructive">{tWork("list.blocked")}</Badge> : null}
                        {task.labelIds.map((id) => {
                          const label = options.labels.find((row) => row.id === id);
                          return label ? <LabelChip key={id} name={label.name} color={label.color} /> : null;
                        })}
                        {task.subtasks.total > 0 ? <span className="text-xs text-muted-foreground">{tWork("list.subtasks", task.subtasks)}</span> : null}
                        {task.checklist.total > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            ☑ {task.checklist.done}/{task.checklist.total}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{task.assigneeName ?? tWork("list.unassigned")}</span>
                        {editable(task) ? (
                          // Without a mouse (phone, keyboard): pick the column, nudge up or down.
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label={t("moveUp")} disabled={position === 0} onClick={() => move(task, state.id, position - 1)} className="rounded px-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30">
                              ↑
                            </button>
                            <button type="button" aria-label={t("moveDown")} disabled={position === cards.length - 1} onClick={() => move(task, state.id, position + 1)} className="rounded px-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30">
                              ↓
                            </button>
                            <Select aria-label={t("moveTo")} value={state.id} onChange={(event) => move(task, event.target.value, columns.get(event.target.value)?.length ?? 0)} className="h-6 w-24 px-1 text-xs md:text-xs">
                              {states.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </Select>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {cards.length === 0 ? <li className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">{t("emptyColumn")}</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
