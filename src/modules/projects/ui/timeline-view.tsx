"use client";
// The Gantt of a project (FR-PJM-07): phases, milestones (diamonds) and tasks as bars on a day or
// week scale, grouped by phase or by assignee, with the "blocks" arrows, days off shaded, a today
// line, baseline ghost bars (FR-PJM-12) and the critical path on request.
//
// Plain HTML and SVG with pointer events — no chart library. Rows are virtualised: only the rows in
// view (and a few around them) are in the DOM, so 500 tasks scroll and drag as smoothly as 20. A bar
// is dragged to move it and by its edges to change its start or due date; the arrow keys move a
// focused bar by a day (Shift: its due date only). A move that would make waiting tasks start
// before it ends asks first, then the server works the shift out again and writes every date
// through the task's own update. On a phone the chart is read-only and a tap opens the task.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { moveTimelineTaskAction } from "../actions";
import { criticalPath, type MovePlan, planMove, workCalendar } from "../engine/schedule";
import type { TimelineMilestone, TimelinePhase, TimelineTask, TimelineView as View } from "../timeline";

const ROW_H = 34;
const HEADER_H = 46;
const OVERSCAN = 8;
const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(parse(date) + days * DAY);
const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY);

type Scale = "day" | "week";
type Group = "phase" | "assignee";
type Dates = { startDate: string | null; dueDate: string | null };
type Row =
  | { kind: "phases"; phases: TimelinePhase[] }
  | { kind: "milestones"; label: string; milestones: TimelineMilestone[] }
  | { kind: "group"; label: string; phase: TimelinePhase | null; milestones: TimelineMilestone[] }
  | { kind: "task"; task: TimelineTask };
type Drag = { taskId: string; mode: "move" | "start" | "end"; originX: number; delta: number; pointerId: number };
type Pending = { task: TimelineTask; to: Dates; plan: MovePlan };

const isOpen = (task: { status: string }) => task.status === "todo" || task.status === "in_progress";
const byDates = (a: TimelineTask, b: TimelineTask) => (a.startDate ?? a.dueDate ?? "").localeCompare(b.startDate ?? b.dueDate ?? "") || a.key.localeCompare(b.key);

/** New dates of a task after dragging `delta` days in a mode. A one-day task without a start keeps its left edge when stretched. */
function applyDelta(task: Dates, mode: Drag["mode"], delta: number): Dates {
  const due = task.dueDate!;
  const start = task.startDate;
  if (mode === "move") return { startDate: start ? shift(start, delta) : null, dueDate: shift(due, delta) };
  if (mode === "end") {
    const next = shift(due, delta);
    const left = start ?? due;
    return next < left ? { startDate: start, dueDate: left } : { startDate: start ?? (next > due ? due : null), dueDate: next };
  }
  const next = shift(start ?? due, delta);
  return { startDate: next > due ? due : next, dueDate: due };
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function TimelineView({ view }: { view: View }) {
  const t = useTranslations("projects.timeline");
  const tErrors = useTranslations("projects.errors");
  const router = useRouter();
  const [group, setGroup] = useState<Group>("phase");
  const [scale, setScale] = useState<Scale>("day");
  const [showBaseline, setShowBaseline] = useState(view.hasBaseline);
  const [showCritical, setShowCritical] = useState(false);
  // Dates drawn before the server has answered — tied to the data they were drawn over, so fresh
  // data from the server replaces them without an effect.
  const [optimistic, setOptimistic] = useState<{ over: View; dates: Map<string, Dates> } | null>(null);
  const overrides = useMemo(() => (optimistic?.over === view ? optimistic.dates : new Map<string, Dates>()), [optimistic, view]);
  const setOverrides = (dates: Map<string, Dates>) => setOptimistic({ over: view, dates });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [nudge, setNudge] = useState<{ taskId: string; mode: "move" | "end"; delta: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const scroller = useRef<HTMLDivElement>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phone = useMedia("(max-width: 639px)");
  const coarse = useMedia("(pointer: coarse)");
  const readOnly = phone || coarse;

  const slipText = (days: number) => t("slip", { days: Math.abs(days), direction: days > 0 ? "late" : days < 0 ? "early" : "on_time" });
  const slipShort = (days: number) => t("slipShort", { days: `${days > 0 ? "+" : "−"}${Math.abs(days)}` });

  const dayW = scale === "day" ? 28 : 10;
  const labelW = phone ? 132 : 248;
  const totalDays = daysBetween(view.range.from, view.range.to) + 1;
  const chartW = totalDays * dayW;
  const x = useCallback((date: string) => daysBetween(view.range.from, date) * dayW, [view.range.from, dayW]);
  const calendar = useMemo(() => workCalendar(view.workingWeekdays, view.daysOff.map((day) => day.date)), [view.workingWeekdays, view.daysOff]);

  const tasks = useMemo(() => view.tasks.map((task) => ({ ...task, ...(overrides.get(task.id) ?? {}) })), [view.tasks, overrides]);
  const dated = useMemo(() => tasks.filter((task) => task.dueDate), [tasks]);
  const undated = useMemo(() => tasks.filter((task) => !task.dueDate), [tasks]);
  const critical = useMemo(() => (showCritical ? criticalPath(calendar, tasks.map((task) => ({ id: task.id, startDate: task.startDate, dueDate: task.dueDate, open: isOpen(task) })), view.dependencies) : new Set<string>()), [showCritical, calendar, tasks, view.dependencies]);

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    if (group === "phase") {
      const loose = view.milestones.filter((milestone) => !milestone.phaseId || !view.phases.some((phase) => phase.id === milestone.phaseId));
      if (loose.length) result.push({ kind: "milestones", label: t("milestones"), milestones: loose });
      const byPhase = Map.groupBy(dated, (task) => (task.phaseId && view.phases.some((phase) => phase.id === task.phaseId) ? task.phaseId : ""));
      for (const phase of view.phases) {
        result.push({ kind: "group", label: phase.name, phase, milestones: view.milestones.filter((milestone) => milestone.phaseId === phase.id) });
        for (const task of (byPhase.get(phase.id) ?? []).sort(byDates)) result.push({ kind: "task", task });
      }
      const rest = (byPhase.get("") ?? []).sort(byDates);
      if (rest.length) {
        if (view.phases.length) result.push({ kind: "group", label: t("noPhase"), phase: null, milestones: [] });
        for (const task of rest) result.push({ kind: "task", task });
      }
      return result;
    }
    if (view.phases.length) result.push({ kind: "phases", phases: view.phases });
    if (view.milestones.length) result.push({ kind: "milestones", label: t("milestones"), milestones: view.milestones });
    const byPerson = [...Map.groupBy(dated, (task) => task.assigneePersonId ?? "").entries()].sort(([a, own], [b, others]) => (a === "" ? 1 : b === "" ? -1 : (own[0].assigneeName ?? "").localeCompare(others[0].assigneeName ?? "", "vi")));
    for (const [personId, own] of byPerson) {
      result.push({ kind: "group", label: personId ? (own[0].assigneeName ?? "—") : t("unassigned"), phase: null, milestones: [] });
      for (const task of own.sort(byDates)) result.push({ kind: "task", task });
    }
    return result;
  }, [group, dated, view.phases, view.milestones, t]);

  const rowOf = useMemo(() => new Map(rows.flatMap((row, index) => (row.kind === "task" ? [[row.task.id, index] as const] : []))), [rows]);
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);

  // Scroll today into view once, and keep track of the window for virtualisation.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, x(view.today) - 3 * dayW * 7);
    const update = () => setScroll({ top: Math.max(0, element.scrollTop - HEADER_H), height: element.clientHeight });
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // Only when the scale changes the horizontal position has to be found again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /** The dates a task is drawn with right now: while dragged or nudged, where it would land. */
  const shown = (task: TimelineTask): Dates => {
    if (drag?.taskId === task.id) return applyDelta(task, drag.mode, drag.delta);
    if (nudge?.taskId === task.id) return applyDelta(task, nudge.mode, nudge.delta);
    return task;
  };

  // ── Committing a move ─────────────────────────────────────────────────────────────────────

  function send(task: TimelineTask, to: Dates, plan: MovePlan | null, shiftDependents: boolean) {
    setPending(null);
    setError(null);
    const previous = overrides;
    const next = new Map(overrides);
    next.set(task.id, to);
    if (shiftDependents && plan) for (const change of plan.shifts) next.set(change.taskId, change.to);
    setOverrides(next);
    startSaving(async () => {
      const result = await moveTimelineTaskAction({ taskId: task.id, startDate: to.startDate, dueDate: to.dueDate, shiftDependents });
      if (!result.ok) {
        setOverrides(previous);
        const key = result.error === "failed" ? (result.message ?? "generic") : result.error;
        setError(tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }
      setNotice(result.data.shifted ? t("movedWith", { count: result.data.shifted }) : result.data.leftAlone ? t("movedAlone", { count: result.data.leftAlone }) : t("moved"));
      router.refresh();
    });
  }

  function commit(task: TimelineTask, to: Dates) {
    if (to.startDate === task.startDate && to.dueDate === task.dueDate) return;
    const plan = planMove(calendar, tasks.filter((other) => isOpen(other) || other.id === task.id), view.dependencies, { taskId: task.id, ...to });
    if (plan.shifts.length) setPending({ task, to, plan });
    else send(task, to, null, false);
  }

  // ── Pointer and keyboard ──────────────────────────────────────────────────────────────────

  const editable = (task: TimelineTask) => !readOnly && task.canEdit && !saving && !pending;

  function onPointerDown(event: PointerEvent<HTMLElement>, task: TimelineTask, mode: Drag["mode"]) {
    if (!editable(task) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setNotice(null);
    setDrag({ taskId: task.id, mode, originX: event.clientX, delta: 0, pointerId: event.pointerId });
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = Math.round((event.clientX - drag.originX) / dayW);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }
  function onPointerUp(event: PointerEvent<HTMLElement>, task: TimelineTask) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { mode, delta } = drag;
    setDrag(null);
    if (delta === 0) {
      if (mode === "move") router.push(`/work/tasks/${task.id}`);
      return;
    }
    commit(task, applyDelta(task, mode, delta));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, task: TimelineTask) {
    if (event.key === "Enter") {
      router.push(`/work/tasks/${task.id}`);
      return;
    }
    if (!editable(task)) return;
    if (event.key === "Escape") {
      setNudge(null);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const mode: "move" | "end" = event.shiftKey ? "end" : "move";
    const next = nudge?.taskId === task.id && nudge.mode === mode ? { ...nudge, delta: nudge.delta + step } : { taskId: task.id, mode, delta: step };
    setNudge(next);
    // A burst of key presses is one move: it is sent once the keys stop.
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => {
      setNudge(null);
      if (next.delta !== 0) commit(task, applyDelta(task, next.mode, next.delta));
    }, 700);
  }
  useEffect(() => () => void (nudgeTimer.current && clearTimeout(nudgeTimer.current)), []);

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────

  const offDays = useMemo(() => {
    const result: number[] = [];
    for (let index = 0; index < totalDays; index++) {
      const date = shift(view.range.from, index);
      if (!calendar.workingWeekdays.has(((new Date(parse(date)).getUTCDay() + 6) % 7) + 1) || calendar.daysOff.has(date)) result.push(index);
    }
    return result;
  }, [totalDays, view.range.from, calendar]);
  const holidayName = useMemo(() => new Map(view.daysOff.map((day) => [day.date, day.name])), [view.daysOff]);

  const header = useMemo(() => {
    const months: { label: string; left: number; width: number }[] = [];
    const ticks: { label: string; left: number; strong: boolean }[] = [];
    for (let index = 0; index < totalDays; index++) {
      const date = shift(view.range.from, index);
      const [year, month, day] = date.split("-");
      if (index === 0 || day === "01") months.push({ label: `${month}/${year}`, left: index * dayW, width: 0 });
      const weekday = new Date(parse(date)).getUTCDay();
      if (scale === "day") ticks.push({ label: String(Number(day)), left: index * dayW, strong: weekday === 1 });
      else if (weekday === 1) ticks.push({ label: `${Number(day)}/${Number(month)}`, left: index * dayW, strong: true });
    }
    months.forEach((month, index) => (month.width = (months[index + 1]?.left ?? chartW) - month.left));
    return { months, ticks };
  }, [totalDays, view.range.from, dayW, scale, chartW]);

  const height = rows.length * ROW_H;
  const todayX = x(view.today);

  const bar = (task: TimelineTask) => {
    const dates = shown(task);
    const left = x(dates.startDate ?? dates.dueDate!);
    const width = Math.max(dayW, x(dates.dueDate!) + dayW - left);
    return { left, width, dates };
  };

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // Only the arrows that touch the rows near the window: a chart of 500 tasks draws a few dozen.
  const arrows = useMemo(() => {
    const near = (index: number | undefined) => index !== undefined && index >= first - 20 && index <= last + 20;
    return view.dependencies.flatMap((dependency) => {
      const from = rowOf.get(dependency.blocker);
      const to = rowOf.get(dependency.blocked);
      if (from === undefined || to === undefined || (!near(from) && !near(to))) return [];
      return [{ key: `${dependency.blocker}:${dependency.blocked}`, from, to, blocker: taskById.get(dependency.blocker)!, blocked: taskById.get(dependency.blocked)! }];
    });
  }, [view.dependencies, rowOf, first, last, taskById]);

  const milestoneDiamond = (milestone: TimelineMilestone) => {
    if (!milestone.dueDate) return null;
    const late = !milestone.done && milestone.dueDate < view.today;
    const center = x(milestone.dueDate) + dayW / 2;
    const title = [milestone.name, milestone.dueDate, milestone.slipDays ? slipText(milestone.slipDays) : null].filter(Boolean).join(" · ");
    return (
      <span key={milestone.id} className="contents">
        {showBaseline && milestone.baselineDue && milestone.baselineDue !== milestone.dueDate ? <span aria-hidden className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-dashed border-muted-foreground/70" style={{ left: x(milestone.baselineDue) + dayW / 2 }} /> : null}
        <span role="img" aria-label={title} title={title} className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${milestone.done ? "bg-emerald-600" : late ? "bg-destructive" : "bg-amber-500"}`} style={{ left: center }} />
        {milestone.slipDays ? <span className={`absolute top-1/2 -translate-y-1/2 pl-2 text-[10px] whitespace-nowrap ${milestone.slipDays > 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`} style={{ left: center + 6 }}>{slipShort(milestone.slipDays)}</span> : null}
      </span>
    );
  };

  const phaseBar = (phase: TimelinePhase) => {
    if (!phase.startDate && !phase.endDate) return null;
    const left = x(phase.startDate ?? phase.endDate!);
    const width = Math.max(dayW, x(phase.endDate ?? phase.startDate!) + dayW - left);
    return <span key={phase.id} title={`${phase.name}: ${phase.startDate ?? "…"} → ${phase.endDate ?? "…"}`} className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted-foreground/35" style={{ left, width }} />;
  };

  const taskRow = (task: TimelineTask) => {
    const { left, width, dates } = bar(task);
    const done = task.status === "done";
    const canDrag = editable(task);
    const title = `${task.key} ${task.title} · ${dates.startDate ?? dates.dueDate} → ${dates.dueDate}${task.slipDays ? ` · ${slipText(task.slipDays)}` : ""}`;
    const ghost = showBaseline && task.baselineDue ? { left: x(task.baselineStart ?? task.baselineDue), width: Math.max(dayW, x(task.baselineDue) + dayW - x(task.baselineStart ?? task.baselineDue)) } : null;
    const body = (
      <>
        <span className="truncate px-1.5">{task.title}</span>
        {canDrag ? (
          <>
            <span aria-hidden onPointerDown={(event) => onPointerDown(event, task, "start")} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md hover:bg-black/15" />
            <span aria-hidden onPointerDown={(event) => onPointerDown(event, task, "end")} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md hover:bg-black/15" />
          </>
        ) : null}
      </>
    );
    const className = `absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-md text-[11px] leading-none select-none ${done ? "bg-emerald-600/25 text-foreground/70" : task.status === "in_progress" ? "bg-primary text-primary-foreground" : "bg-primary/60 text-primary-foreground"} ${critical.has(task.id) ? "ring-2 ring-destructive" : ""} ${canDrag ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${drag?.taskId === task.id || nudge?.taskId === task.id ? "opacity-80 shadow-md" : ""} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`;
    return (
      <>
        {ghost ? <span aria-hidden className="absolute top-[calc(50%+9px)] h-1.5 rounded-sm border border-dashed border-muted-foreground/60 bg-muted-foreground/10" style={ghost} /> : null}
        {readOnly || !task.canEdit ? (
          <Link href={`/work/tasks/${task.id}`} title={title} className={className} style={{ left, width }}>
            {body}
          </Link>
        ) : (
          <span role="button" tabIndex={0} title={title} aria-label={`${title}. ${t("keyboardHint")}`} className={className} style={{ left, width }} onPointerDown={(event) => onPointerDown(event, task, "move")} onPointerMove={onPointerMove} onPointerUp={(event) => onPointerUp(event, task)} onPointerCancel={() => setDrag(null)} onKeyDown={(event) => onKeyDown(event, task)}>
            {body}
          </span>
        )}
        {task.slipDays ? (
          <span className={`absolute top-1/2 -translate-y-1/2 pl-1 text-[10px] whitespace-nowrap ${task.slipDays > 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`} style={{ left: left + width + 2 }}>
            {slipShort(task.slipDays)}
          </span>
        ) : null}
      </>
    );
  };

  const label = (row: Row) => {
    switch (row.kind) {
      case "phases":
        return <span className="text-xs font-medium text-muted-foreground">{t("phases")}</span>;
      case "milestones":
        return <span className="text-xs font-medium text-muted-foreground">{row.label}</span>;
      case "group":
        return <span className="truncate text-xs font-semibold">{row.label}</span>;
      case "task":
        return (
          <Link href={`/work/tasks/${row.task.id}`} className="flex min-w-0 flex-col leading-tight hover:underline">
            <span className="truncate text-xs">
              <span className="font-mono text-[10px] text-muted-foreground">{row.task.key}</span> {row.task.title}
            </span>
            {group === "phase" && row.task.assigneeName && !phone ? <span className="truncate text-[10px] text-muted-foreground">{row.task.assigneeName}</span> : null}
          </Link>
        );
    }
  };

  const content = (row: Row) => {
    switch (row.kind) {
      case "phases":
        return row.phases.map(phaseBar);
      case "milestones":
        return row.milestones.map(milestoneDiamond);
      case "group":
        return (
          <>
            {row.phase ? phaseBar(row.phase) : null}
            {row.milestones.map(milestoneDiamond)}
          </>
        );
      case "task":
        return taskRow(row.task);
    }
  };

  const toggle = (active: boolean) => `rounded-md px-2 py-1 text-xs ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label={t("groupBy")} className="flex items-center gap-1 rounded-lg border p-0.5">
          <button type="button" className={toggle(group === "phase")} aria-pressed={group === "phase"} onClick={() => setGroup("phase")}>
            {t("byPhase")}
          </button>
          <button type="button" className={toggle(group === "assignee")} aria-pressed={group === "assignee"} onClick={() => setGroup("assignee")}>
            {t("byAssignee")}
          </button>
        </div>
        <div role="group" aria-label={t("scale")} className="flex items-center gap-1 rounded-lg border p-0.5">
          <button type="button" className={toggle(scale === "day")} aria-pressed={scale === "day"} onClick={() => setScale("day")}>
            {t("days")}
          </button>
          <button type="button" className={toggle(scale === "week")} aria-pressed={scale === "week"} onClick={() => setScale("week")}>
            {t("weeks")}
          </button>
        </div>
        {view.hasBaseline ? (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)} /> {t("showBaseline")}
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showCritical} onChange={(event) => setShowCritical(event.target.checked)} /> {t("showCritical")}
        </label>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 3 * dayW * 7);
          }}
        >
          {t("today")}
        </button>
        {saving ? <span className="text-xs text-muted-foreground">{t("saving")}</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">{readOnly ? t("readOnlyHint") : t("hint")}</p>

      {pending ? (
        <div role="alertdialog" aria-labelledby="timeline-confirm" className="flex flex-col gap-2 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 text-sm">
          <p id="timeline-confirm" className="font-medium">
            {t("confirmTitle", { title: pending.task.title, date: pending.to.dueDate ?? "—", count: pending.plan.shifts.length })}
          </p>
          <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-xs">
            {pending.plan.shifts.map((change) => {
              const task = taskById.get(change.taskId);
              return (
                <li key={change.taskId}>
                  <span className="font-mono text-muted-foreground">{task?.key}</span> {task?.title}: {change.from.startDate ?? change.from.dueDate} → {change.to.startDate ?? change.to.dueDate}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => send(pending.task, pending.to, pending.plan, true)}>
              {t("confirmShift", { days: pending.plan.shiftDays })}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => send(pending.task, pending.to, pending.plan, false)}>
              {t("confirmOnly")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div ref={scroller} className="relative max-h-[70vh] overflow-auto rounded-xl border" style={{ height: Math.min(HEADER_H + height + 2, 720) }}>
          <div className="relative" style={{ width: labelW + chartW, height: HEADER_H + height }}>
            {/* The date header stays on top while scrolling down, the labels on the left while scrolling across. */}
            <div className="sticky top-0 z-30 flex border-b bg-background" style={{ height: HEADER_H, width: labelW + chartW }}>
              <div className="sticky left-0 z-10 shrink-0 border-r bg-background" style={{ width: labelW }} />
              <div className="relative shrink-0" style={{ width: chartW }}>
                {header.months.map((month) => (
                  <span key={month.left} className="absolute top-0 truncate border-l px-1 text-[11px] font-medium" style={{ left: month.left, width: month.width }}>
                    {month.label}
                  </span>
                ))}
                {header.ticks.map((tick) => (
                  <span key={tick.left} className={`absolute bottom-1 text-[10px] ${tick.strong ? "text-foreground" : "text-muted-foreground"}`} style={{ left: tick.left, width: scale === "day" ? dayW : undefined, textAlign: scale === "day" ? "center" : undefined }}>
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Days off and the today line, behind the rows. */}
            <svg aria-hidden className="pointer-events-none absolute z-0" style={{ left: labelW, top: HEADER_H }} width={chartW} height={height}>
              {offDays.map((index) => (
                <rect key={index} x={index * dayW} y={0} width={dayW} height={height} className="fill-muted">
                  <title>{holidayName.get(shift(view.range.from, index)) ?? ""}</title>
                </rect>
              ))}
              <line x1={todayX + dayW / 2} x2={todayX + dayW / 2} y1={0} y2={height} className="stroke-destructive" strokeWidth={1.5} strokeDasharray="4 3" />
            </svg>

            {rows.slice(first, last + 1).map((row, offset) => {
              const index = first + offset;
              return (
                <div key={row.kind === "task" ? row.task.id : `${row.kind}:${index}`} className={`absolute left-0 flex border-b border-border/50 ${row.kind === "group" ? "bg-muted/30" : ""}`} style={{ top: HEADER_H + index * ROW_H, height: ROW_H, width: labelW + chartW }}>
                  <div className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-background px-2" style={{ width: labelW }}>
                    {label(row)}
                  </div>
                  <div className="relative z-10 shrink-0" style={{ width: chartW }}>
                    {content(row)}
                  </div>
                </div>
              );
            })}

            {/* "Blocks" arrows: from the end of the blocker to the start of the task waiting for it. */}
            <svg aria-hidden className="pointer-events-none absolute z-10 overflow-visible" style={{ left: labelW, top: HEADER_H }} width={chartW} height={height}>
              <defs>
                <marker id="timeline-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
                </marker>
              </defs>
              {arrows.map((arrow) => {
                const from = bar(arrow.blocker);
                const to = bar(arrow.blocked);
                const x1 = from.left + from.width;
                const y1 = arrow.from * ROW_H + ROW_H / 2;
                const x2 = to.left;
                const y2 = arrow.to * ROW_H + ROW_H / 2;
                const late = x2 < x1;
                const path = late ? `M${x1},${y1} h6 V${(y1 + y2) / 2} H${x2 - 6} V${y2} H${x2 - 1}` : `M${x1},${y1} H${Math.max(x1 + 4, x2 - 6)} V${y2} H${x2 - 1}`;
                return <path key={arrow.key} d={path} fill="none" strokeWidth={1.2} className={late ? "stroke-destructive" : "stroke-muted-foreground/70"} markerEnd="url(#timeline-arrow)" />;
              })}
            </svg>
          </div>
        </div>
      )}

      {undated.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("undated", { count: undated.length })}</summary>
          <ul className="flex flex-col gap-1 pt-2">
            {undated.map((task) => (
              <li key={task.id}>
                <Link href={`/work/tasks/${task.id}`} className="hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("legend")}</p>
    </div>
  );
}
