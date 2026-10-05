"use client";
// The small machinery shared by recruitment's list editors — pipeline stages, application
// questions, interview kits: a row's move-up / move-down / remove buttons, and the state helpers
// behind them. Each row keeps a local id so React keeps its inputs in place while rows move.
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

let counter = 0;
const localId = () => `row-${(counter += 1)}`;

/** A list of rows with stable local ids, and the three things an editor does to it. */
export function useRows<Row>(initial: readonly Row[]) {
  const [rows, setRows] = useState(() => initial.map((row) => ({ ...row, rowId: localId() })));
  return {
    rows,
    add: (row: Row) => setRows((current) => [...current, { ...row, rowId: localId() }]),
    update: (rowId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))),
    remove: (rowId: string) => setRows((current) => current.filter((row) => row.rowId !== rowId)),
    move: (index: number, by: -1 | 1) =>
      setRows((current) => {
        const target = index + by;
        if (target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      }),
    reset: (next: readonly Row[]) => setRows(next.map((row) => ({ ...row, rowId: localId() }))),
  };
}

/** Up, down, remove — icon buttons with their names spoken, on the row's own line. */
export function RowControls({ index, count, onMove, onRemove, removable = true }: { index: number; count: number; onMove: (by: -1 | 1) => void; onRemove: () => void; removable?: boolean }) {
  const t = useTranslations("recruit.editor");
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t("up")}>
        <ArrowUp aria-hidden />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t("down")}>
        <ArrowDown aria-hidden />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={!removable} onClick={onRemove} aria-label={t("remove")}>
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}
