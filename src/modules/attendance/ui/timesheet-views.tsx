// The stored timesheet on screen: a person's month (tap a day for the explanation) and the team grid.
// Server components: no client state, the month and the person are in the URL.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { MonthSummary } from "../engine/timesheet";
import type { TeamMonthRow, TimesheetDayRow } from "../timesheets";
import { hoursText } from "./day-plan";

const STATUS_TONE: Record<TimesheetDayRow["status"], string> = {
  present: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  partial: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  absent: "bg-red-500/20 text-red-800 dark:text-red-300",
  leave: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  holiday: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  day_off: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  remote: "bg-teal-500/15 text-teal-800 dark:text-teal-300",
  untracked: "bg-muted text-muted-foreground",
  rest: "text-muted-foreground",
  unscheduled: "text-muted-foreground",
  in_progress: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
};

export const shiftMonth = (month: string, by: number): string => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
};

export function MonthNav({ month, hrefFor, thisMonth }: { month: string; hrefFor: (month: string) => string; thisMonth: string }) {
  const format = useFormatter();
  return (
    <nav className="flex items-center gap-3 text-sm">
      <Link href={hrefFor(shiftMonth(month, -1))} className="rounded-md border px-2 py-1" aria-label="previous month">
        ←
      </Link>
      <span className="min-w-32 text-center font-medium">{format.dateTime(new Date(`${month}-01T00:00:00`), { month: "long", year: "numeric" })}</span>
      {month < thisMonth ? (
        <Link href={hrefFor(shiftMonth(month, 1))} className="rounded-md border px-2 py-1" aria-label="next month">
          →
        </Link>
      ) : (
        <span className="px-2 py-1 text-muted-foreground">→</span>
      )}
    </nav>
  );
}

export function SummaryTiles({ summary }: { summary: MonthSummary }) {
  const t = useTranslations("attendance.timesheet");
  const days = (centi: number) => (centi / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const tiles: [string, string][] = [
    [t("summary.paidDays"), `${days(summary.paidDaysCenti)} / ${summary.standardDays}`],
    [t("summary.worked"), hoursText(summary.workedMinutes + summary.creditedMinutes)],
    [t("summary.leave"), hoursText(summary.leavePaidMinutes + summary.leaveUnpaidMinutes)],
    [t("summary.late"), `${summary.lateCount} · ${summary.lateMinutes}′`],
    [t("summary.early"), `${summary.earlyCount} · ${summary.earlyMinutes}′`],
    [t("summary.missing"), String(summary.missingPunchDays)],
    [t("summary.absent"), String(summary.absentDays)],
    [t("summary.overtime"), hoursText(summary.otTotalMinutes)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A trace line such as "late:22min:in_08:52_expected_08:30" in the reader's language when a phrase exists, as written otherwise. */
function TraceLine({ line }: { line: string }) {
  const t = useTranslations("attendance.timesheet.trace");
  // Only the first colon separates: the rest may hold clock times.
  const cut = line.indexOf(":");
  const head = cut < 0 ? line : line.slice(0, cut);
  const rest = cut < 0 ? "" : line.slice(cut + 1);
  return (
    <li>
      {t.has(head) ? t(head) : head}
      {rest ? <span className="text-muted-foreground"> · {rest.replaceAll("_", " ")}</span> : null}
    </li>
  );
}

export function MonthDays({ days }: { days: TimesheetDayRow[] }) {
  const t = useTranslations("attendance.timesheet");
  const format = useFormatter();
  const clock = (at: Date | null) => (at ? format.dateTime(at, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "—");
  if (days.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {days.map((day) => {
        const overtime = day.otWeekdayMinutes + day.otWeekdayNightMinutes + day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes;
        return (
          <li key={day.date}>
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <span className="w-28 font-medium">{format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[day.status]}`}>{t(`statuses.${day.status}`)}</span>
                {day.firstIn || day.lastOut ? (
                  <span className="tabular-nums text-muted-foreground">
                    {clock(day.firstIn)} → {clock(day.lastOut)}
                  </span>
                ) : null}
                {day.workedMinutes + day.creditedMinutes > 0 ? <span className="tabular-nums">{hoursText(day.workedMinutes + day.creditedMinutes)}</span> : null}
                {overtime > 0 ? <Badge variant="secondary">{t("overtimeBadge", { hours: hoursText(overtime) })}</Badge> : null}
                {day.anomalies.map((anomaly) => (
                  <Badge key={anomaly} variant="destructive">
                    {t(`anomalies.${anomaly}`)}
                  </Badge>
                ))}
                {day.lockedAt ? <Badge variant="outline">{t("locked")}</Badge> : null}
              </summary>
              <div className="flex flex-col gap-2 border-t bg-muted/30 p-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  {(
                    [
                      ["required", day.requiredMinutes], ["worked", day.workedMinutes], ["credited", day.creditedMinutes], ["late", day.lateMinutes], ["early", day.earlyMinutes], ["absence", day.absenceMinutes],
                      ["leavePaid", day.leavePaidMinutes], ["leaveUnpaid", day.leaveUnpaidMinutes], ["holiday", day.holidayMinutes], ["night", day.nightMinutes], ["overtime", overtime], ["otUnapproved", day.otUnapprovedMinutes],
                    ] as const
                  )
                    .filter(([, minutes]) => minutes > 0)
                    .map(([key, minutes]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t(`fields.${key}`)}</dt>
                        <dd className="tabular-nums">{hoursText(minutes)}</dd>
                      </div>
                    ))}
                </dl>
                <p className="text-xs font-medium text-muted-foreground">{t("why")}</p>
                <ul className="list-disc pl-5 text-xs">
                  {day.trace.map((line, index) => (
                    <TraceLine key={index} line={line} />
                  ))}
                </ul>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

const CODE: Record<TimesheetDayRow["status"], string> = { present: "✓", partial: "½", absent: "✗", leave: "P", holiday: "L", day_off: "N", remote: "R", untracked: "·", rest: "", unscheduled: "?", in_progress: "…" };

export function TeamGrid({ rows, month, dates }: { rows: TeamMonthRow[]; month: string; dates: string[] }) {
  const t = useTranslations("attendance.timesheet");
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("team.empty")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="sticky left-0 z-10 min-w-40 bg-muted px-2 py-1 text-left font-medium">{t("team.person")}</th>
            {dates.map((date) => {
              const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
              return (
                <th key={date} className={`w-7 px-0.5 py-1 text-center font-normal tabular-nums ${weekday === 0 || weekday === 6 ? "text-muted-foreground" : ""}`}>
                  {Number(date.slice(8))}
                </th>
              );
            })}
            {(["paidDays", "late", "missing", "absent", "overtime"] as const).map((key) => (
              <th key={key} className="px-2 py-1 text-right font-medium">
                {t(`team.columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const byDate = new Map(row.days.map((day) => [day.date, day]));
            return (
              <tr key={row.personId} className="border-b last:border-0">
                <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal">
                  <Link href={`/attendance?person=${row.personId}&month=${month}`} className="font-medium underline-offset-4 hover:underline">
                    {row.fullName}
                  </Link>
                  <span className="block text-[10px] text-muted-foreground">{[row.employeeCode, row.departmentName].filter(Boolean).join(" · ")}</span>
                </th>
                {dates.map((date) => {
                  const day = byDate.get(date);
                  return (
                    <td key={date} className="p-0.5 text-center">
                      {day ? (
                        <span title={`${t(`statuses.${day.status}`)}${day.anomalies.length ? ` — ${day.anomalies.map((anomaly) => t(`anomalies.${anomaly}`)).join(", ")}` : ""}`} className={`block rounded px-0.5 py-0.5 ${STATUS_TONE[day.status]} ${day.anomalies.length ? "ring-1 ring-destructive/60" : ""}`}>
                          {CODE[day.status] || " "}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right tabular-nums">
                  {(row.summary.paidDaysCenti / 100).toFixed(2)} / {row.summary.standardDays}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{row.summary.lateCount || ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{row.summary.missingPunchDays || ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{row.summary.absentDays || ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{row.summary.otTotalMinutes ? hoursText(row.summary.otTotalMinutes) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t p-2 text-[11px] text-muted-foreground">{t("team.legend")}</p>
    </div>
  );
}
