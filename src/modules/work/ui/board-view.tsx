"use client";
import { ArrowRightLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { RecordLink } from "@/components/ui/record-link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import { updateTaskAction } from "../actions";
import { boardColumns, isSamePlace, planDrop } from "../engine/board";
import { BOARD_RECENT_DAYS, filterTasks, type TaskFilters } from "../engine/filter";
import { CustomValueText } from "./custom-fields";
import { FilterBar, useUrlFilters } from "./filter-bar";
import { useHandoffGate } from "./handoff";
import { QuickCreate, type TaskScope } from "./quick-create";
import { type ListOptions, type ListTask, PriorityMark } from "./task-list-view";
import { StateBadge, stateColumnClass } from "./status-badge";
import { DueText, PersonAvatar, TaskKey } from "./task-row";
import { LabelChip } from "./team-forms";

export type BoardTask = ListTask & { boardRank: number; updatedAt: string };

/**
 * Kanban board (FR-WRK-05): one column per workflow state of the team, washed in its state's tint.
 * A drop shows at once (`useOptimistic`); if the server refuses, the card goes back by itself and
 * the reason is shown. Without a mouse — on a phone — a card moves through its own menu: tap the
 * state on the card, tap the state it goes to (FR-PJM-37: two taps), and the arrows reorder it
 * within its column. With `scope`, each column ends with a quick-create that files into that state.
 */
export function BoardView({
  tasks,
  options,
  initialFilters,
  selfId,
  today,
  canContribute,
  scope,
}: {
  tasks: BoardTask[];
  options: ListOptions;
  initialFilters: TaskFilters;
  selfId: string;
  today: string;
  canContribute: boolean;
  /** Where a column's quick-create files a new task; without it the board only shows. */ scope?: TaskScope;
}) {
  const t = useTranslations("work.board");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { filters, setFilter, clear } = useUrlFilters(initialFilters);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ stateId: string; index: number } | null>(null);
  const [, startTransition] = useTransition();
  // A column that needs a hand-off package (FR-PJM-40): the card snaps back, the reason shows, the sheet opens.
  const gate = useHandoffGate();
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: BoardTask[], move: { id: string; stateId: string; boardRank: number; status: BoardTask["status"] }) =>
    current.map((task) => (task.id === move.id ? { ...task, ...move } : task)),
  );

  const fields = useMemo(() => (options.fields ?? []).filter((field) => field.isActive), [options.fields]);
  const cardFields = fields.filter((field) => field.showOnCard);
  const states = useMemo(() => options.states.filter((state) => state.isActive || shown.some((task) => task.stateId === state.id)), [options.states, shown]);
  const columns = useMemo(() => {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - BOARD_RECENT_DAYS * 86_400_000).toISOString();
    // The board always has its "done" columns; without "show closed" they hold the last two weeks only.
    const visible = filterTasks(shown, { ...filters, closed: "1" }, { selfId, today, fields }).filter((task) => filters.closed === "1" || task.status === "todo" || task.status === "in_progress" || task.updatedAt >= since);
    return boardColumns(
      visible,
      states.map((state) => state.id),
    );
  }, [shown, filters, selfId, today, states, fields]);

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
      gate.intercept(result);
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
      {gate.sheet}
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {states.map((state) => {
          const cards = columns.get(state.id) ?? [];
          return (
            <section
              key={state.id}
              aria-label={state.name}
              className={cn(
                "flex w-[min(18rem,calc(100vw-3rem))] shrink-0 snap-start flex-col gap-2 rounded-[14px] border border-border p-2 transition-shadow duration-100 md:w-72",
                stateColumnClass(state.category),
                dragging && target?.stateId === state.id && "ring-2 ring-ring/40",
              )}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                if (target?.stateId !== state.id) setTarget({ stateId: state.id, index: cards.filter((card) => card.id !== dragging).length });
              }}
              onDrop={(event) => onDrop(event, state.id)}
            >
              <h3 className="flex h-8 items-center gap-2 px-1.5 text-[0.8125rem] font-medium">
                <StateBadge category={state.category} name={state.name} className="min-w-0" />
                <span className="ml-auto font-mono text-[0.6875rem] font-normal text-faint tabular-nums">{cards.length}</span>
              </h3>
              <ul className="flex min-h-10 flex-col gap-2">
                {cards.map((task, position) => {
                  const open = task.status === "todo" || task.status === "in_progress";
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
                      className={cn(
                        "flex flex-col gap-1.5 rounded-[10px] border border-border bg-background p-2.5 text-sm shadow-[0_1px_2px_oklch(0_0_0/4%)] transition-[margin,opacity] duration-200 ease-(--ease-settle)",
                        dragging === task.id && "opacity-40",
                        showGap && "mt-8",
                        editable(task) && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <TaskKey>{task.key}</TaskKey>
                        <PriorityMark priority={task.priority} title={task.priority ? tWork(`priority.${task.priority as 1}`) : undefined} />
                        <span className="ml-auto">
                          <DueText dueDate={task.dueDate} today={today} open={open} />
                        </span>
                        {editable(task) ? (
                          // The card's own menu: where dragging is not to be had, the state is two taps away.
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t("changeState", { title: task.title })} />}>
                              <ArrowRightLeftIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                              <DropdownMenuRadioGroup value={task.stateId} onValueChange={(next) => move(task, String(next), (columns.get(String(next)) ?? []).filter((card) => card.id !== task.id).length)}>
                                {states
                                  .filter((row) => row.isActive || row.id === task.stateId)
                                  .map((row) => (
                                    <DropdownMenuRadioItem key={row.id} value={row.id}>
                                      {row.name}
                                    </DropdownMenuRadioItem>
                                  ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                      <RecordLink kind="task" id={task.id} draggable={false} className={cn("line-clamp-2 leading-snug", open ? "font-medium" : "text-muted-foreground line-through")}>
                        {task.title}
                      </RecordLink>
                      {task.blocker || task.blockedBy > 0 || task.labelIds.length || task.subtasks.total > 0 || task.checklist.total > 0 || cardFields.length ? (
                        <div className="flex flex-wrap items-center gap-1 empty:hidden">
                          {task.blocker ? (
                            <Badge variant="destructive" title={task.blocker.reason}>
                              {tWork("blockers.badge")}
                            </Badge>
                          ) : null}
                          {task.blockedBy > 0 ? <Badge variant="destructive">{tWork("list.blocked")}</Badge> : null}
                          {task.labelIds.map((id) => {
                            const label = options.labels.find((row) => row.id === id);
                            return label ? <LabelChip key={id} name={label.name} color={label.color} /> : null;
                          })}
                          {task.subtasks.total > 0 ? <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{tWork("list.subtasks", task.subtasks)}</span> : null}
                          {cardFields.map((field) =>
                            task.customValues?.[field.id] === undefined ? null : (
                              <span key={field.id} className="text-xs text-muted-foreground" title={field.name}>
                                <CustomValueText field={field} value={task.customValues[field.id]} people={options.people} />
                              </span>
                            ),
                          )}
                          {task.checklist.total > 0 ? (
                            <span className="font-mono text-[0.6875rem] text-faint tabular-nums">
                              ☑ {task.checklist.done}/{task.checklist.total}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={task.assigneeName} />
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{task.assigneeName ?? tWork("list.unassigned")}</span>
                        {editable(task) ? (
                          // Without a mouse (phone, keyboard): nudge up or down.
                          <span className="flex items-center gap-0.5">
                            <Button variant="ghost" size="icon-xs" aria-label={t("moveUp")} disabled={position === 0} onClick={() => move(task, state.id, position - 1)}>
                              <ChevronUpIcon />
                            </Button>
                            <Button variant="ghost" size="icon-xs" aria-label={t("moveDown")} disabled={position === cards.length - 1} onClick={() => move(task, state.id, position + 1)}>
                              <ChevronDownIcon />
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {cards.length === 0 ? <li className="rounded-[10px] border border-dashed border-border p-3 text-center text-xs text-faint">{t("emptyColumn")}</li> : null}
              </ul>
              {/* A new task starts in the column it was typed under, inside the filters in force — so it does not vanish on arrival. */}
              {scope && canContribute && state.isActive && state.category !== "done" && state.category !== "cancelled" ? (
                <QuickCreate
                  compact
                  scope={scope}
                  defaults={{ stateId: state.id, assigneePersonId: filters.assignee === "me" ? selfId : filters.assignee && filters.assignee !== "none" ? filters.assignee : null, labelIds: filters.label ? [filters.label] : [] }}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
