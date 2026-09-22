// A week of time as the screens show it (FR-PJM-24, 26): the grid and the entries, labelled in the
// reader's language. A server component: the person's own week page and the approver's page both
// render it, editable only for the person and only while the week is open.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { TimeWeekView } from "../timesheets";
import { TIME_CATEGORIES } from "../enums";
import { hoursOf } from "./format";
import { type EntryView, WeekEntries } from "./week-entries";
import { type GridDayView, type GridRowView, type RowOption, WeekGrid } from "./week-grid";

type OpenTask = { taskId: string; key: string; title: string; projectName: string | null };

export async function TimeWeek({ view, openTasks = [] }: { view: TimeWeekView; openTasks?: OpenTask[] }) {
  const [t, format] = await Promise.all([getTranslations("daily.time"), getFormatter()]);
  const categoryName = (category: string | null) => t(`categories.${(TIME_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as "admin") : "internal"}`);
  const labelOf = (key: string): { label: string; sub: string | null } => {
    const label = view.labels[key];
    if (!label) {
      const task = openTasks.find((row) => `task:${row.taskId}` === key);
      if (task) return { label: `${task.key} ${task.title}`, sub: task.projectName };
      return key.startsWith("category:") ? { label: categoryName(key.slice("category:".length)), sub: null } : { label: "—", sub: null };
    }
    return label.taskId ? { label: [label.taskKey, label.title].filter(Boolean).join(" ") || "—", sub: label.projectName } : { label: categoryName(label.category), sub: null };
  };
  const dayLabel = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric" });

  const rows: GridRowView[] = view.grid.rows.map((row) => ({ key: row.key, ...labelOf(row.key), cells: row.cells }));
  const days: GridDayView[] = view.days.map((day) => ({
    date: day.date,
    label: dayLabel(day.date),
    note: day.name ?? (day.leave === "full" ? t("leave") : day.leave === "part" ? t("halfLeave") : day.kind === "untracked" ? t("untracked") : null),
    hint: day.hint === null ? null : day.hint.kind === "attended" ? t("hoursValue", { value: hoursOf(day.hint.minutes) }) : day.hint.kind === "untracked" ? t("untracked") : "–",
    off: day.dayOff,
  }));
  const options: RowOption[] = view.editable
    ? [...openTasks.map((task) => ({ key: `task:${task.taskId}`, label: `${task.key} ${task.title}`, sub: task.projectName })), ...TIME_CATEGORIES.map((category) => ({ key: `category:${category}`, label: categoryName(category), sub: t("otherTime") }))]
    : [];
  const copyRows: RowOption[] = view.lastWeekRows.map((key) => ({ key, ...labelOf(key) }));
  const entries: EntryView[] = view.entries.map((entry) => ({
    id: entry.id,
    day: format.dateTime(new Date(`${entry.date}T12:00:00Z`), { weekday: "short", day: "numeric" }),
    ...(entry.taskId ? { label: [entry.key, entry.title].filter(Boolean).join(" ") || "—", sub: entry.projectName } : { label: categoryName(entry.category), sub: null }),
    minutes: entry.minutes,
    billable: entry.billable,
    note: entry.note,
    timer: entry.source === "timer",
    capped: entry.capped,
  }));

  return (
    <div className="flex flex-col gap-6">
      <WeekGrid rows={rows} days={days} editable={view.editable} options={options} copyRows={copyRows} />
      {view.days.some((day) => day.hint) ? <p className="text-xs text-muted-foreground">{t("attendanceHint")}</p> : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("entries")} · {t("billableTotal", { value: hoursOf(view.grid.billable), total: hoursOf(view.grid.total) })}
        </h2>
        <WeekEntries entries={entries} editable={view.editable} />
      </section>
    </div>
  );
}

const STATUS_BADGE = { open: "outline", submitted: "info", approved: "success", returned: "warning" } as const;

/** Where the week stands (FR-PJM-25): its status, and who returned, approved or reopened it and why. */
export async function WeekStatus({ view }: { view: TimeWeekView }) {
  const [t, format] = await Promise.all([getTranslations("daily.time"), getFormatter()]);
  const week = view.week;
  const when = (date: Date | null) => (date ? format.dateTime(date, { dateStyle: "short", timeStyle: "short" }) : "");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {view.approvalRequired || week ? <Badge variant={STATUS_BADGE[view.status]}>{t(`status.${view.status}`)}</Badge> : null}
        {view.timeMode === "required" ? <Badge variant="outline">{t("requiredBadge")}</Badge> : null}
        {week?.submittedAt && view.status === "submitted" ? <span className="text-xs text-muted-foreground">{t("submittedAt", { time: when(week.submittedAt) })}</span> : null}
      </div>
      {week && view.status === "returned" && week.comment ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("returnedBy", { name: week.decidedByName ?? "—", comment: week.comment })}</p> : null}
      {week && view.status === "approved" ? <p className="text-sm text-muted-foreground">{t("approvedBy", { name: week.decidedByName ?? "—", time: when(week.decidedAt) })}</p> : null}
      {week && view.status === "open" && week.decidedByPersonId && week.comment ? <p className="text-sm text-muted-foreground">{t("reopenedBy", { name: week.decidedByName ?? "—", comment: week.comment })}</p> : null}
    </div>
  );
}
