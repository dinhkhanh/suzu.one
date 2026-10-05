// A week of time as the screens show it (FR-PJM-24, 26): the grid and the entries, labelled in the
// reader's language. A server component: the person's own week page and the approver's page both
// render it, editable only for the person and only while the week is open.
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { statusTone } from "@/components/ui/tone";
import type { TimeWeekView } from "../timesheets";
import { TIME_CATEGORIES } from "../enums";
import { hoursOf } from "./format";
import { type EntryView, WeekEntries } from "./week-entries";
import { type GridDayView, type GridRowView, type RowOption, WeekGrid } from "./week-grid";

type OpenTask = { taskId: string; key: string; title: string; projectId?: string | null; projectName: string | null; /** The project's job number, composed in by the route (FR-PJM-02). */ jobNumber?: string | null };

export async function TimeWeek({ view, openTasks = [] }: { view: TimeWeekView; openTasks?: OpenTask[] }) {
  const [t, format] = await Promise.all([getTranslations("daily.time"), getFormatter()]);
  const categoryName = (category: string | null) => t(`categories.${(TIME_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as "admin") : "internal"}`);
  // With the ids of the task and the project the labels name, so the grid and the entries link them.
  const labelOf = (key: string): { label: string; sub: string | null; job?: string | null; taskId?: string | null; projectId?: string | null } => {
    const label = view.labels[key];
    if (!label) {
      const task = openTasks.find((row) => `task:${row.taskId}` === key);
      if (task) return { label: `${task.key} ${task.title}`, sub: task.projectName, job: task.jobNumber, taskId: task.taskId, projectId: task.projectId };
      return key.startsWith("category:") ? { label: categoryName(key.slice("category:".length)), sub: null } : { label: "—", sub: null };
    }
    // A task this reader may not open: its hours belong on their screen, its name does not.
    if (label.hidden) return { label: t("privateWork"), sub: null };
    return label.taskId ? { label: [label.taskKey, label.title].filter(Boolean).join(" ") || "—", sub: label.projectName, job: label.projectName ? label.jobNumber : null, taskId: label.taskId, projectId: label.projectName ? label.projectId : null } : { label: categoryName(label.category), sub: null };
  };
  const dayLabel = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric" });

  const rows: GridRowView[] = view.grid.rows.map((row) => ({ key: row.key, ...labelOf(row.key), cells: row.cells, billable: row.billable, total: row.total }));
  const days: GridDayView[] = view.days.map((day) => ({
    date: day.date,
    label: dayLabel(day.date),
    note: day.name ?? (day.leave === "full" ? t("leave") : day.leave === "part" ? t("halfLeave") : day.kind === "untracked" ? t("untracked") : null),
    hint: day.hint === null ? null : day.hint.kind === "attended" ? t("hoursValue", { value: hoursOf(day.hint.minutes) }) : day.hint.kind === "untracked" ? t("untracked") : "–",
    off: day.dayOff,
  }));
  const options: RowOption[] = view.editable
    ? [...openTasks.map((task) => ({ key: `task:${task.taskId}`, label: `${task.key} ${task.title}`, sub: [task.jobNumber, task.projectName].filter(Boolean).join(" ") || null })), ...TIME_CATEGORIES.map((category) => ({ key: `category:${category}`, label: categoryName(category), sub: t("otherTime") }))]
    : [];
  const copyRows: RowOption[] = view.lastWeekRows.map((key) => {
    const { label, sub, job } = labelOf(key);
    return { key, label, sub: [job, sub].filter(Boolean).join(" ") || null };
  });
  const entries: EntryView[] = view.entries.map((entry) => ({
    id: entry.id,
    day: format.dateTime(new Date(`${entry.date}T12:00:00Z`), { weekday: "short", day: "numeric" }),
    ...(entry.hidden ? { label: t("privateWork"), sub: null } : entry.taskId ? { label: [entry.key, entry.title].filter(Boolean).join(" ") || "—", sub: entry.projectName, job: entry.projectName ? entry.jobNumber : null, taskId: entry.taskId, projectId: entry.projectName ? entry.projectId : null } : { label: categoryName(entry.category), sub: null }),
    minutes: entry.minutes,
    billable: entry.billable,
    note: entry.note,
    timer: entry.source === "timer",
    capped: entry.capped,
  }));

  return (
    <div className="flex min-w-0 flex-col gap-6 md:gap-8">
      <WeekGrid rows={rows} days={days} weekStart={view.weekStart} editable={view.editable} options={options} copyRows={copyRows} />
      {view.days.some((day) => day.hint) ? <p className="px-0.5 text-xs text-muted-foreground">{t("attendanceHint")}</p> : null}
      <Section title={t("entries")} count={<span className="normal-case">{t("billableTotal", { value: hoursOf(view.grid.billable), total: hoursOf(view.grid.total) })}</span>}>
        <WeekEntries entries={entries} editable={view.editable} />
      </Section>
    </div>
  );
}

/** Where the week stands (FR-PJM-25): its status, and who returned, approved or reopened it and why. */
export async function WeekStatus({ view }: { view: TimeWeekView }) {
  const [t, format] = await Promise.all([getTranslations("daily.time"), getFormatter()]);
  const week = view.week;
  const when = (date: Date | null) => (date ? format.dateTime(date, { dateStyle: "short", timeStyle: "short" }) : "");
  const person = (chunks: ReactNode) => <RecordLink kind="person" id={week?.decidedByPersonId}>{chunks}</RecordLink>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {view.approvalRequired || week ? <Badge dot variant={statusTone(view.status)}>{t(`status.${view.status}`)}</Badge> : null}
        {view.timeMode === "required" ? <Badge variant="outline">{t("requiredBadge")}</Badge> : null}
        {week?.submittedAt && view.status === "submitted" ? <span className="text-xs text-muted-foreground">{t("submittedAt", { time: when(week.submittedAt) })}</span> : null}
      </div>
      {week && view.status === "returned" && week.comment ? <p className="text-sm text-warning">{t.rich("returnedBy", { name: week.decidedByName ?? "—", comment: week.comment, person })}</p> : null}
      {week && view.status === "approved" ? <p className="text-sm text-muted-foreground">{t.rich("approvedBy", { name: week.decidedByName ?? "—", time: when(week.decidedAt), person })}</p> : null}
      {week && view.status === "open" && week.decidedByPersonId && week.comment ? <p className="text-sm text-muted-foreground">{t.rich("reopenedBy", { name: week.decidedByName ?? "—", comment: week.comment, person })}</p> : null}
    </div>
  );
}
