"use client";
// The week of time (FR-PJM-24, 26): tasks and categories down, days across, totals at the end of
// each row and the foot of each day, attendance beside each day. Typing a total into a cell saves
// it when the cell is left. Dense on a desktop; on a phone the same week as a list of days.
import { Copy, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type CSSProperties, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { setRowBillableAction, setTimeCellAction } from "../time-actions";
import { durationText, hoursOf, parseCellDuration } from "./format";

export type GridRowView = { key: string; label: string; sub: string | null; /** The task and the project the labels name, when the reader may open them. */ taskId?: string | null; projectId?: string | null; cells: number[]; /** Minutes of the row billed to the client, of its total: none, all, or some of them. */ billable: number; total: number };
export type GridDayView = {
  date: string;
  label: string;
  /** Holiday, leave, untracked Saturday… */
  note: string | null;
  /** "Attended 7.5 h", "Untracked", or null when there is nothing to show or the reader may not see it. */
  hint: string | null;
  off: boolean;
};
export type RowOption = { key: string; label: string; sub: string | null };

const MONO = "font-mono text-[0.8125rem] tabular-nums";

function Cell({ date, rowKey, minutes, label, editable, onError }: { date: string; rowKey: string; minutes: number; label: string; editable: boolean; onError: (errorKey: string | null) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(durationText(minutes));
  const [bad, setBad] = useState(false);
  if (!editable) return <span className={cn("block px-1 text-right", MONO, minutes === 0 && "text-faint")}>{minutes ? durationText(minutes) : "·"}</span>;
  const commit = () => {
    const value = parseCellDuration(text);
    if (value === null || value > 24 * 60) {
      setBad(true);
      return onError("cell_unreadable");
    }
    setBad(false);
    if (value === minutes) return setText(durationText(minutes));
    startTransition(async () => {
      const result = await setTimeCellAction({ date, row: rowKey, minutes: value });
      if (!result.ok) {
        setBad(true);
        setText(durationText(minutes));
        return onError((result.error === "failed" ? result.message : result.error) ?? "generic");
      }
      onError(null);
      setText(durationText(value));
      router.refresh();
    });
  };
  return (
    <input
      aria-label={label}
      aria-invalid={bad || undefined}
      value={text}
      disabled={pending}
      inputMode="decimal"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setText(durationText(minutes));
      }}
      className={cn("h-8 w-full min-w-12 rounded-[0.5rem] border border-transparent bg-transparent px-1.5 text-right outline-none transition-[border-color,box-shadow] hover:border-input focus:border-ring focus:bg-background focus:ring-[3px] focus:ring-ring/20 disabled:opacity-60 aria-invalid:border-destructive", MONO)}
    />
  );
}

/**
 * Whether the row's week is billed to the client (FR-PJM-24, Q17). It starts from the project's own
 * kind; one tap here bills the whole row's week, or stops billing it. "Some" means the entries
 * under it disagree — tapping then bills them all.
 */
function BillableToggle({ weekStart, rowKey, billable, total, editable, onError }: { weekStart: string; rowKey: string; billable: number; total: number; editable: boolean; onError: (errorKey: string | null) => void }) {
  const t = useTranslations("daily.time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (total === 0) return null;
  const state = billable === total ? "yes" : billable === 0 ? "no" : "mixed";
  const label = t(`billableState.${state}`);
  const variant = state === "yes" ? "info" : state === "mixed" ? "warning" : "outline";
  // Read-only — an approver's view, or the phone list, where the entries below are the place to change it.
  if (!editable) return state === "no" ? null : <Badge variant={variant}>{label}</Badge>;
  return (
    <Badge
      variant={variant}
      className="press cursor-pointer disabled:opacity-60"
      render={
        <button
          type="button"
          aria-pressed={state === "yes"}
          title={t("billableToggle")}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setRowBillableAction({ weekStart, row: rowKey, billable: state !== "yes" });
              if (!result.ok) return onError((result.error === "failed" ? result.message : result.error) ?? "generic");
              onError(null);
              router.refresh();
            })
          }
        />
      }
    >
      {label}
    </Badge>
  );
}

export function WeekGrid({ rows, days, weekStart, editable, options, copyRows }: { rows: GridRowView[]; days: GridDayView[]; weekStart: string; editable: boolean; options: RowOption[]; copyRows: RowOption[] }) {
  const t = useTranslations("daily.time");
  const [extra, setExtra] = useState<RowOption[]>([]);
  const [adding, setAdding] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const shown: GridRowView[] = [...rows, ...extra.filter((row) => !rows.some((existing) => existing.key === row.key)).map((row) => ({ ...row, cells: days.map(() => 0), billable: 0, total: 0 }))];
  const dayTotals = days.map((_, index) => shown.reduce((sum, row) => sum + row.cells[index], 0));
  const total = dayTotals.reduce((sum, value) => sum + value, 0);
  const available = options.filter((option) => !shown.some((row) => row.key === option.key));
  const toCopy = copyRows.filter((row) => !shown.some((existing) => existing.key === row.key));
  const cellLabel = (row: GridRowView, day: GridDayView) => t("cellLabel", { row: row.label, day: day.label });

  const addControls = editable ? (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <div className="flex min-w-0 gap-2">
        <Select aria-label={t("addRow")} value={adding} onChange={(event) => setAdding(event.target.value)} className="min-w-0 flex-1 md:w-72 md:flex-none">
          <option value="">{t("addRowPlaceholder")}</option>
          {available.map((option) => (
            <option key={option.key} value={option.key}>
              {option.sub ? `${option.label} · ${option.sub}` : option.label}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!adding}
          onClick={() => {
            const option = options.find((row) => row.key === adding);
            if (option) setExtra((current) => [...current, option]);
            setAdding("");
          }}
        >
          <Plus aria-hidden /> {t("addRow")}
        </Button>
      </div>
      {toCopy.length > 0 ? (
        <Button type="button" variant="ghost" onClick={() => setExtra((current) => [...current, ...toCopy])} className="self-start">
          <Copy aria-hidden /> {t("copyLastWeek", { count: toCopy.length })}
        </Button>
      ) : null}
      <span className="px-0.5 text-xs text-muted-foreground">{t("cellHint")}</span>
    </div>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Desktop: the dense grid. */}
      <div className="hidden min-w-0 md:block">
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="text" className="min-w-56">
                {t("row")}
              </TableHead>
              {days.map((day) => (
                <TableHead key={day.date} kind="time" className={cn("w-20 px-1.5", day.off && "bg-muted/60")}>
                  <span className="inline-flex flex-col items-end">
                    <span>{day.label}</span>
                    {day.note ? <span className="font-normal text-faint">{day.note}</span> : null}
                  </span>
                </TableHead>
              ))}
              <TableHead kind="time" className="w-20">
                {t("total")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? <TableEmpty>{t("noEntries")}</TableEmpty> : null}
            {shown.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      <RecordLink kind="task" id={row.taskId}>{row.label}</RecordLink>
                    </span>
                    <BillableToggle weekStart={weekStart} rowKey={row.key} billable={row.billable} total={row.total} editable={editable} onError={setErrorKey} />
                  </span>
                  {row.sub ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      <RecordLink kind="project" id={row.projectId}>{row.sub}</RecordLink>
                    </span>
                  ) : null}
                </TableCell>
                {days.map((day, index) => (
                  <TableCell key={day.date} kind="time" className={cn("px-1 py-1", day.off && "bg-muted/30")}>
                    <Cell key={`${row.key}:${row.cells[index]}`} date={day.date} rowKey={row.key} minutes={row.cells[index]} label={cellLabel(row, day)} editable={editable} onError={setErrorKey} />
                  </TableCell>
                ))}
                <TableCell kind="time" className="font-medium">
                  {durationText(row.cells.reduce((sum, value) => sum + value, 0)) || "·"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="text-xs font-medium">{t("total")}</TableCell>
              {dayTotals.map((minutes, index) => (
                <TableCell key={days[index].date} kind="time" className="px-1.5 font-medium">
                  {durationText(minutes) || "·"}
                </TableCell>
              ))}
              <TableCell kind="time" className="font-semibold">
                {t("hoursValue", { value: hoursOf(total) })}
              </TableCell>
            </TableRow>
            {days.some((day) => day.hint) ? (
              <TableRow className="text-xs text-muted-foreground">
                <TableCell className="h-9 text-xs">{t("attendance")}</TableCell>
                {days.map((day) => (
                  <TableCell key={day.date} kind="time" className="h-9 px-1.5 text-xs">
                    {day.hint ?? "·"}
                  </TableCell>
                ))}
                <TableCell className="h-9" />
              </TableRow>
            ) : null}
          </TableFooter>
        </Table>
      </div>

      {/* Phone: one row per day. */}
      <List className="md:hidden">
        {days.map((day, index) => (
          <ListItem key={day.date} className={cn("rise flex-col items-stretch gap-1 py-3", day.off && "bg-canvas")} style={{ "--i": index } as CSSProperties}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{day.label}</span>
              {day.note ? <span className="text-xs text-muted-foreground">{day.note}</span> : null}
              <span className={cn("text-sm font-medium", MONO)}>{t("hoursValue", { value: hoursOf(dayTotals[index]) })}</span>
            </div>
            {day.hint ? (
              <p className="text-xs text-muted-foreground">
                {t("attendance")}: {day.hint}
              </p>
            ) : null}
            {shown.length === 0 ? <p className="text-xs text-muted-foreground">{t("dayEmpty")}</p> : null}
            <ul className="flex flex-col">
              {shown
                .filter((row) => editable || row.cells[index] > 0)
                .map((row) => (
                  <li key={row.key} className="flex items-center gap-2 py-0.5">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm">
                      <span className="min-w-0 truncate">
                        <RecordLink kind="task" id={row.taskId}>{row.label}</RecordLink>
                        {row.sub ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · <RecordLink kind="project" id={row.projectId}>{row.sub}</RecordLink>
                          </span>
                        ) : null}
                      </span>
                      <BillableToggle weekStart={weekStart} rowKey={row.key} billable={row.billable} total={row.total} editable={false} onError={setErrorKey} />
                    </span>
                    <span className="w-20 shrink-0">
                      <Cell key={`${row.key}:${row.cells[index]}`} date={day.date} rowKey={row.key} minutes={row.cells[index]} label={cellLabel(row, day)} editable={editable} onError={setErrorKey} />
                    </span>
                  </li>
                ))}
            </ul>
          </ListItem>
        ))}
        <ListItem className="justify-between bg-canvas font-medium">
          <span>{t("total")}</span>
          <span className={MONO}>{t("hoursValue", { value: hoursOf(total) })}</span>
        </ListItem>
      </List>

      <FormError namespace="daily.errors" errorKey={errorKey} />
      {addControls}
    </div>
  );
}
