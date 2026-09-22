"use client";
// The week of time (FR-PJM-24, 26): tasks and categories down, days across, totals at the end of
// each row and the foot of each day, attendance beside each day. Typing a total into a cell saves
// it when the cell is left. Dense on a desktop; on a phone the same week as a list of days.
import { Copy, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { setTimeCellAction } from "../time-actions";
import { durationText, hoursOf, parseCellDuration } from "./format";

export type GridRowView = { key: string; label: string; sub: string | null; cells: number[] };
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

function Cell({ date, rowKey, minutes, label, editable, onError }: { date: string; rowKey: string; minutes: number; label: string; editable: boolean; onError: (errorKey: string | null) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(durationText(minutes));
  const [bad, setBad] = useState(false);
  if (!editable) return <span className={cn("block px-1 text-right tabular-nums", minutes === 0 && "text-faint")}>{minutes ? durationText(minutes) : "·"}</span>;
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
      className="h-8 w-full min-w-12 rounded-md border border-transparent bg-transparent px-1 text-right text-sm tabular-nums outline-none hover:border-input focus:border-ring/60 focus:bg-background disabled:opacity-60 aria-invalid:border-destructive"
    />
  );
}

export function WeekGrid({ rows, days, editable, options, copyRows }: { rows: GridRowView[]; days: GridDayView[]; editable: boolean; options: RowOption[]; copyRows: RowOption[] }) {
  const t = useTranslations("daily.time");
  const [extra, setExtra] = useState<RowOption[]>([]);
  const [adding, setAdding] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const shown: GridRowView[] = [...rows, ...extra.filter((row) => !rows.some((existing) => existing.key === row.key)).map((row) => ({ ...row, cells: days.map(() => 0) }))];
  const dayTotals = days.map((_, index) => shown.reduce((sum, row) => sum + row.cells[index], 0));
  const total = dayTotals.reduce((sum, value) => sum + value, 0);
  const available = options.filter((option) => !shown.some((row) => row.key === option.key));
  const toCopy = copyRows.filter((row) => !shown.some((existing) => existing.key === row.key));
  const cellLabel = (row: GridRowView, day: GridDayView) => t("cellLabel", { row: row.label, day: day.label });

  const addControls = editable ? (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t("addRow")} value={adding} onChange={(event) => setAdding(event.target.value)} className="h-8 w-auto max-w-72 text-xs">
        <option value="">{t("addRowPlaceholder")}</option>
        {available.map((option) => (
          <option key={option.key} value={option.key}>
            {option.sub ? `${option.label} · ${option.sub}` : option.label}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        size="sm"
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
      {toCopy.length > 0 ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setExtra((current) => [...current, ...toCopy])}>
          <Copy aria-hidden /> {t("copyLastWeek", { count: toCopy.length })}
        </Button>
      ) : null}
      <span className="text-xs text-muted-foreground">{t("cellHint")}</span>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop: the dense grid. */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="min-w-56 px-3 py-2 text-left font-medium">{t("row")}</th>
              {days.map((day) => (
                <th key={day.date} className={cn("w-20 px-1 py-2 text-right font-medium", day.off && "bg-muted/60")}>
                  <span className="block">{day.label}</span>
                  {day.note ? <span className="block font-normal text-faint">{day.note}</span> : null}
                </th>
              ))}
              <th className="w-20 px-3 py-2 text-right font-medium">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={days.length + 2} className="px-3 py-6 text-center text-muted-foreground">
                  {t("noEntries")}
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="px-3 py-1.5">
                  <span className="block truncate">{row.label}</span>
                  {row.sub ? <span className="block truncate text-xs text-muted-foreground">{row.sub}</span> : null}
                </td>
                {days.map((day, index) => (
                  <td key={day.date} className={cn("px-1 py-1", day.off && "bg-muted/30")}>
                    <Cell key={`${row.key}:${row.cells[index]}`} date={day.date} rowKey={row.key} minutes={row.cells[index]} label={cellLabel(row, day)} editable={editable} onError={setErrorKey} />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{durationText(row.cells.reduce((sum, value) => sum + value, 0)) || "·"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/20 text-xs">
            <tr>
              <td className="px-3 py-2 font-medium">{t("total")}</td>
              {dayTotals.map((minutes, index) => (
                <td key={days[index].date} className="px-1 py-2 text-right font-medium tabular-nums">
                  {durationText(minutes) || "·"}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{t("hoursValue", { value: hoursOf(total) })}</td>
            </tr>
            {days.some((day) => day.hint) ? (
              <tr className="text-muted-foreground">
                <td className="px-3 pb-2">{t("attendance")}</td>
                {days.map((day) => (
                  <td key={day.date} className="px-1 pb-2 text-right">
                    {day.hint ?? "·"}
                  </td>
                ))}
                <td />
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>

      {/* Phone: one card per day. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {days.map((day, index) => (
          <li key={day.date} className={cn("flex flex-col gap-1 rounded-xl border p-3", day.off && "bg-muted/30")}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{day.label}</span>
              {day.note ? <span className="text-xs text-muted-foreground">{day.note}</span> : null}
              <span className="text-sm font-medium tabular-nums">{t("hoursValue", { value: hoursOf(dayTotals[index]) })}</span>
            </div>
            {day.hint ? <p className="text-xs text-muted-foreground">{t("attendance")}: {day.hint}</p> : null}
            {shown.length === 0 ? <p className="text-xs text-muted-foreground">{t("dayEmpty")}</p> : null}
            <ul className="flex flex-col">
              {shown
                .filter((row) => editable || row.cells[index] > 0)
                .map((row) => (
                  <li key={row.key} className="flex items-center gap-2 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.label}
                      {row.sub ? <span className="text-xs text-muted-foreground"> · {row.sub}</span> : null}
                    </span>
                    <span className="w-20">
                      <Cell key={`${row.key}:${row.cells[index]}`} date={day.date} rowKey={row.key} minutes={row.cells[index]} label={cellLabel(row, day)} editable={editable} onError={setErrorKey} />
                    </span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
        <li className="flex items-center justify-between rounded-xl border bg-muted/20 p-3 text-sm font-medium">
          <span>{t("total")}</span>
          <span className="tabular-nums">{t("hoursValue", { value: hoursOf(total) })}</span>
        </li>
      </ul>

      <FormError namespace="daily.errors" errorKey={errorKey} />
      {addControls}
    </div>
  );
}
