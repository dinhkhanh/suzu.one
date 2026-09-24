"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { updateTaskAction } from "../actions";
import { monthGrid, placeByDueDate, shiftMonth } from "../engine/calendar";
import { filterTasks, type TaskFilters } from "../engine/filter";
import { CHANNELS } from "../enums";
import { FilterBar, useUrlFilters } from "./filter-bar";
import type { ListOptions, ListTask } from "./task-list-view";

export type CalendarTask = ListTask & { teamId: string; channel: string | null; contentFormat: string | null; projectName: string | null; editable: boolean };
/** A post of the publish log on the day it is planned for (or went out), flagged (FR-PJM-54). */
export type CalendarPost = { id: string; taskId: string; key: string; title: string; teamId: string; platform: string; date: string; flag: "published" | "late" | "planned" | "unscheduled" | "cancelled"; time: string | null };

const POST_CLASS: Record<CalendarPost["flag"], string> = {
  published: "border-emerald-600/40 text-success",
  late: "border-destructive/60 text-destructive",
  planned: "border-dashed border-border text-muted-foreground",
  unscheduled: "border-dashed border-border text-muted-foreground",
  cancelled: "border-border text-muted-foreground line-through",
};

const MAX_PER_DAY = 4;
const CHANNEL_CLASS: Record<string, string> = {
  facebook: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  tiktok: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200",
  youtube: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  instagram: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  zalo: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

/**
 * Month calendar of tasks on their due date — the content calendar when filtered by client or
 * channel (FR-WRK-05). Dragging a task to another day changes its due date.
 */
export function CalendarView({
  tasks,
  options,
  month,
  daysOff,
  teams,
  initialFilters,
  initialExtra,
  selfId,
  today,
  posts,
  missingTaskIds,
}: {
  tasks: CalendarTask[];
  options: ListOptions;
  month: string;
  daysOff: { date: string; name: string }[];
  /** The cross-project calendar offers a team filter; a project's calendar has one team. */
  teams?: { id: string; name: string }[];
  initialFilters: TaskFilters;
  initialExtra: { team?: string; channel?: string };
  selfId: string;
  today: string;
  /** The content calendar's posts: planned against published (FR-PJM-54). */
  posts?: CalendarPost[];
  /** Content tasks due with no post planned at all. */
  missingTaskIds?: string[];
}) {
  const t = useTranslations("work.calendar");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const { filters, setFilter, clear } = useUrlFilters(initialFilters);
  const [extra, setExtra] = useState(initialExtra);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [shown, applyOptimistic] = useOptimistic(tasks, (current: CalendarTask[], change: { id: string; dueDate: string }) => current.map((task) => (task.id === change.id ? { ...task, dueDate: change.dueDate } : task)));

  const grid = useMemo(() => monthGrid(month), [month]);
  const offByDate = useMemo(() => new Map(daysOff.map((day) => [day.date, day.name])), [daysOff]);
  const byDate = useMemo(() => {
    const visible = filterTasks(shown, { ...filters, closed: "1" }, { selfId, today, fields: options.fields }).filter((task) => (!extra.team || task.teamId === extra.team) && (!extra.channel || task.channel === extra.channel));
    return placeByDueDate(visible);
  }, [shown, filters, extra, selfId, today, options.fields]);

  const postsByDate = useMemo(() => Map.groupBy((posts ?? []).filter((post) => (!extra.team || post.teamId === extra.team) && (!extra.channel || post.platform === extra.channel)), (post) => post.date), [posts, extra]);
  const missing = useMemo(() => new Set(missingTaskIds ?? []), [missingTaskIds]);

  const setExtraKey = (key: "team" | "channel", value: string) => {
    setExtra((current) => ({ ...current, [key]: value || undefined }));
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };
  const openMonth = (next: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("month", next);
    router.push(`${pathname}?${params.toString()}`);
  };

  function reschedule(taskId: string, date: string) {
    const task = shown.find((row) => row.id === taskId);
    if (!task || !task.editable || task.dueDate === date) return;
    startTransition(async () => {
      applyOptimistic({ id: taskId, dueDate: date });
      const result = await updateTaskAction({ taskId, dueDate: date });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      router.refresh();
    });
  }

  const weekdays = grid.weeks[0].map((day) => format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short" }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" aria-label={t("previous")} onClick={() => openMonth(shiftMonth(month, -1))}>
          ←
        </Button>
        <h2 className="min-w-36 text-center text-base font-medium">{format.dateTime(new Date(`${month}-01T00:00:00`), { month: "long", year: "numeric" })}</h2>
        <Button size="sm" variant="outline" aria-label={t("next")} onClick={() => openMonth(shiftMonth(month, 1))}>
          →
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openMonth(today.slice(0, 7))}>
          {t("today")}
        </Button>
        {teams && teams.length > 1 ? (
          <Select aria-label={t("team")} value={extra.team ?? ""} onChange={(event) => setExtraKey("team", event.target.value)} className="w-44">
            <option value="">{t("anyTeam")}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label={t("channel")} value={extra.channel ?? ""} onChange={(event) => setExtraKey("channel", event.target.value)} className="w-40">
          <option value="">{t("anyChannel")}</option>
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {tWork(`channels.${channel}`)}
            </option>
          ))}
        </Select>
      </div>
      <FilterBar filters={filters} setFilter={setFilter} clear={clear} options={options} showClosed={false} />
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-xl border text-sm">
          {weekdays.map((name) => (
            <div key={name} className="border-b bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
              {name}
            </div>
          ))}
          {grid.weeks.flat().map((day, index) => {
            const own = byDate.get(day.date) ?? [];
            const off = offByDate.get(day.date);
            const weekend = index % 7 === 6;
            const visible = expanded === day.date ? own : own.slice(0, MAX_PER_DAY);
            return (
              <div
                key={day.date}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  if (over !== day.date) setOver(day.date);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = dragging ?? event.dataTransfer.getData("text/plain");
                  setDragging(null);
                  setOver(null);
                  reschedule(id, day.date);
                }}
                className={`flex min-h-28 flex-col gap-1 border-r border-b p-1 ${index % 7 === 6 ? "border-r-0" : ""} ${day.inMonth ? "" : "bg-muted/20 text-muted-foreground"} ${off || weekend ? "bg-muted/40" : ""} ${over === day.date ? "ring-2 ring-ring ring-inset" : ""}`}
              >
                <div className="flex items-center justify-between gap-1 px-1 text-xs">
                  <span className={day.date === today ? "rounded-full bg-primary px-1.5 font-semibold text-primary-foreground" : ""}>{Number(day.date.slice(8))}</span>
                  {off ? <span className="truncate text-[10px] text-muted-foreground">{off}</span> : null}
                </div>
                {visible.map((task) => {
                  const open = task.status === "todo" || task.status === "in_progress";
                  const late = open && day.date < today;
                  return (
                    <Link
                      key={task.id}
                      href={`/work/tasks/${task.id}`}
                      draggable={task.editable}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(task.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      title={[task.key, task.title, task.projectName, task.assigneeName, task.channel ? tWork(`channels.${task.channel}`) : null].filter(Boolean).join(" · ")}
                      className={`truncate rounded px-1.5 py-0.5 text-xs hover:underline ${task.channel && CHANNEL_CLASS[task.channel] ? CHANNEL_CLASS[task.channel] : "bg-muted"} ${open ? "" : "line-through opacity-60"} ${late ? "ring-1 ring-destructive" : ""}`}
                    >
                      {missing.has(task.id) ? (
                        <span className="mr-1 font-semibold text-destructive" title={t("postMissing")} aria-label={t("postMissing")}>
                          !
                        </span>
                      ) : null}
                      {task.title}
                    </Link>
                  );
                })}
                {(postsByDate.get(day.date) ?? []).map((post) => (
                  <Link key={post.id} href={`/work/tasks/${post.taskId}`} title={[post.key, post.title, tWork(`channels.${post.platform}`), t(`posts.${post.flag}`)].join(" · ")} className={`truncate rounded border px-1.5 py-0.5 text-[11px] hover:underline ${POST_CLASS[post.flag]}`}>
                    {post.flag === "published" ? "✓ " : post.flag === "late" ? "⚠ " : "◷ "}
                    {post.time ? `${post.time} ` : ""}
                    {post.title}
                  </Link>
                ))}
                {own.length > MAX_PER_DAY ? (
                  <button type="button" className="px-1 text-left text-[11px] text-muted-foreground hover:underline" onClick={() => setExpanded(expanded === day.date ? null : day.date)}>
                    {expanded === day.date ? t("less") : t("more", { count: own.length - MAX_PER_DAY })}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {posts ? <p className="text-xs text-muted-foreground">{t("postLegend")}</p> : null}
    </div>
  );
}
