// The stored timesheet on screen: a person's month (tap a day for the explanation) and the team grid.
// Server components: no client state, the month and the person are in the URL.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "cn";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthSummary } from "../engine/timesheet";
import type { TeamMonthRow, TimesheetDayRow } from "../timesheets";
import { hoursText } from "./day-plan";

/** One tone per day status, the badge's own (so a day reads like a status anywhere else). */
const STATUS_VARIANT: Record<TimesheetDayRow["status"], BadgeVariant> = {
  present: "success",
  partial: "warning",
  absent: "destructive",
  leave: "info",
  holiday: "violet",
  day_off: "violet",
  remote: "teal",
  untracked: "secondary",
  rest: "outline",
  unscheduled: "outline",
  in_progress: "info",
};

/** The same tones as a tint on a grid cell. */
const CELL_TINT: Record<TimesheetDayRow["status"], string> = {
  present: "bg-success/12 text-success",
  partial: "bg-warning/14 text-warning",
  absent: "bg-destructive/12 text-destructive",
  leave: "bg-info/12 text-info",
  holiday: "bg-tone-violet/12 text-tone-violet",
  day_off: "bg-tone-violet/12 text-tone-violet",
  remote: "bg-tone-teal/12 text-tone-teal",
  untracked: "bg-muted text-muted-foreground",
  rest: "text-faint",
  unscheduled: "text-faint",
  in_progress: "bg-info/8 text-info",
};

export const shiftMonth = (month: string, by: number): string => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
};

export function MonthNav({ month, hrefFor, thisMonth }: { month: string; hrefFor: (month: string) => string; thisMonth: string }) {
  const t = useTranslations("attendance.timesheet");
  const format = useFormatter();
  const key = cn(buttonVariants({ variant: "outline", size: "icon" }));
  return (
    <nav className="flex items-center gap-2">
      <Link href={hrefFor(shiftMonth(month, -1))} className={key} aria-label={t("previousMonth")}>
        <ChevronLeftIcon />
      </Link>
      <span className="min-w-32 text-center text-sm font-medium">{format.dateTime(new Date(`${month}-01T00:00:00`), { month: "long", year: "numeric" })}</span>
      {month < thisMonth ? (
        <Link href={hrefFor(shiftMonth(month, 1))} className={key} aria-label={t("nextMonth")}>
          <ChevronRightIcon />
        </Link>
      ) : (
        <span className={cn(key, "pointer-events-none opacity-50")} aria-hidden>
          <ChevronRightIcon />
        </span>
      )}
    </nav>
  );
}

export function SummaryTiles({ summary }: { summary: MonthSummary }) {
  const t = useTranslations("attendance.timesheet");
  const days = (centi: number) => (centi / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const tiles: { label: string; value: string; tone?: "warning" | "destructive" }[] = [
    { label: t("summary.paidDays"), value: `${days(summary.paidDaysCenti)} / ${summary.standardDays}` },
    { label: t("summary.worked"), value: hoursText(summary.workedMinutes + summary.creditedMinutes) },
    { label: t("summary.leave"), value: hoursText(summary.leavePaidMinutes + summary.leaveUnpaidMinutes) },
    { label: t("summary.late"), value: `${summary.lateCount} · ${summary.lateMinutes}′`, tone: summary.lateCount ? "warning" : undefined },
    { label: t("summary.early"), value: `${summary.earlyCount} · ${summary.earlyMinutes}′`, tone: summary.earlyCount ? "warning" : undefined },
    { label: t("summary.missing"), value: String(summary.missingPunchDays), tone: summary.missingPunchDays ? "destructive" : undefined },
    { label: t("summary.absent"), value: String(summary.absentDays), tone: summary.absentDays ? "destructive" : undefined },
    { label: t("summary.overtime"), value: hoursText(summary.otTotalMinutes) },
  ];
  return (
    <TileGrid className="md:grid-cols-4">
      {tiles.map((tile) => (
        <Tile key={tile.label} label={tile.label} value={tile.value} tone={tile.tone} />
      ))}
    </TileGrid>
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
  return (
    <List>
      {days.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
      {days.map((day) => {
        const overtime = day.otWeekdayMinutes + day.otWeekdayNightMinutes + day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes;
        return (
          <ListItem key={day.date} className="block p-0">
            <details className="group/day">
              <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm transition-colors duration-100 hover:bg-canvas md:px-3.5 [&::-webkit-details-marker]:hidden">
                <span className="w-24 font-medium">{format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</span>
                <Badge dot variant={STATUS_VARIANT[day.status]}>
                  {t(`statuses.${day.status}`)}
                </Badge>
                {day.firstIn || day.lastOut ? (
                  <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">
                    {clock(day.firstIn)} → {clock(day.lastOut)}
                  </span>
                ) : null}
                {day.workedMinutes + day.creditedMinutes > 0 ? <span className="font-mono text-[0.8125rem] tabular-nums">{hoursText(day.workedMinutes + day.creditedMinutes)}</span> : null}
                {overtime > 0 ? <Badge variant="secondary">{t("overtimeBadge", { hours: hoursText(overtime) })}</Badge> : null}
                {day.anomalies.map((anomaly) => (
                  <Badge key={anomaly} variant="destructive">
                    {t(`anomalies.${anomaly}`)}
                  </Badge>
                ))}
                {day.lockedAt ? <Badge variant="outline">{t("locked")}</Badge> : null}
              </summary>
              <div className="flex flex-col gap-2 border-t bg-canvas p-4 text-sm md:px-3.5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  {(
                    [
                      ["required", day.requiredMinutes],
                      ["worked", day.workedMinutes],
                      ["credited", day.creditedMinutes],
                      ["late", day.lateMinutes],
                      ["early", day.earlyMinutes],
                      ["absence", day.absenceMinutes],
                      ["leavePaid", day.leavePaidMinutes],
                      ["leaveUnpaid", day.leaveUnpaidMinutes],
                      ["holiday", day.holidayMinutes],
                      ["night", day.nightMinutes],
                      ["overtime", overtime],
                      ["otUnapproved", day.otUnapprovedMinutes],
                    ] as const
                  )
                    .filter(([, minutes]) => minutes > 0)
                    .map(([key, minutes]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t(`fields.${key}`)}</dt>
                        <dd className="font-mono tabular-nums">{hoursText(minutes)}</dd>
                      </div>
                    ))}
                </dl>
                <p className="section-label">{t("why")}</p>
                <ul className="list-disc pl-5 text-xs">
                  {day.trace.map((line, index) => (
                    <TraceLine key={index} line={line} />
                  ))}
                </ul>
              </div>
            </details>
          </ListItem>
        );
      })}
    </List>
  );
}

const CODE: Record<TimesheetDayRow["status"], string> = { present: "✓", partial: "½", absent: "✗", leave: "P", holiday: "L", day_off: "N", remote: "R", untracked: "·", rest: "", unscheduled: "?", in_progress: "…" };

export function TeamGrid({ rows, month, dates }: { rows: TeamMonthRow[]; month: string; dates: string[] }) {
  const t = useTranslations("attendance.timesheet");
  return (
    <TableCard>
      <Table numbered={false} className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead kind="person" className="sticky left-0 z-10 min-w-36 bg-canvas">
              {t("team.person")}
            </TableHead>
            {dates.map((date) => {
              const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
              return (
                <TableHead key={date} className={cn("w-7 min-w-7 px-0.5 text-center font-mono tabular-nums", (weekday === 0 || weekday === 6) && "text-faint")}>
                  {Number(date.slice(8))}
                </TableHead>
              );
            })}
            {(["paidDays", "late", "missing", "absent", "overtime"] as const).map((key) => (
              <TableHead key={key} kind="number">
                {t(`team.columns.${key}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("team.empty")}</TableEmpty> : null}
          {rows.map((row) => {
            const byDate = new Map(row.days.map((day) => [day.date, day]));
            return (
              <TableRow key={row.personId}>
                <TableCell className="sticky left-0 z-10 h-auto bg-background py-1.5">
                  <Link href={`/attendance?person=${row.personId}&month=${month}`} className="block max-w-44 truncate text-[0.8125rem] font-medium hover:underline">
                    {row.fullName}
                  </Link>
                  <span className="block truncate text-[10px] text-muted-foreground">{[row.employeeCode, row.departmentName].filter(Boolean).join(" · ")}</span>
                </TableCell>
                {dates.map((date) => {
                  const day = byDate.get(date);
                  return (
                    <TableCell key={date} className="h-auto p-0.5 text-center">
                      {day ? (
                        <span
                          title={`${t(`statuses.${day.status}`)}${day.anomalies.length ? ` — ${day.anomalies.map((anomaly) => t(`anomalies.${anomaly}`)).join(", ")}` : ""}`}
                          className={cn("block rounded-[4px] px-0.5 py-1 font-mono", CELL_TINT[day.status], day.anomalies.length && "ring-1 ring-destructive/60")}
                        >
                          {CODE[day.status] || " "}
                        </span>
                      ) : null}
                    </TableCell>
                  );
                })}
                <TableCell kind="number" className="h-auto py-1.5 text-xs">
                  {(row.summary.paidDaysCenti / 100).toFixed(2)} / {row.summary.standardDays}
                </TableCell>
                <TableCell kind="number" className="h-auto py-1.5 text-xs">
                  {row.summary.lateCount || ""}
                </TableCell>
                <TableCell kind="number" className="h-auto py-1.5 text-xs">
                  {row.summary.missingPunchDays || ""}
                </TableCell>
                <TableCell kind="number" className="h-auto py-1.5 text-xs">
                  {row.summary.absentDays || ""}
                </TableCell>
                <TableCell kind="number" className="h-auto py-1.5 text-xs">
                  {row.summary.otTotalMinutes ? hoursText(row.summary.otTotalMinutes) : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("team.legend")}</p>
    </TableCard>
  );
}
