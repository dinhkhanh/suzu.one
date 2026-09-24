"use client";
// The week's entries one by one (FR-PJM-24): each can be corrected — its length, note and whether
// it is billed — or removed while the week is open. A timer cut at 16 hours says so.
import { Pencil, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteTimeEntryAction, submitWeekAction, updateTimeEntryAction } from "../time-actions";
import { durationText, parseCellDuration } from "./format";
import { useRun } from "./use-run";

export type EntryView = { id: string; day: string; label: string; sub: string | null; minutes: number; billable: boolean; note: string | null; timer: boolean; capped: boolean };

function EntryRow({ entry, editable }: { entry: EntryView; editable: boolean }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  const [editing, setEditing] = useState(false);
  const [length, setLength] = useState(durationText(entry.minutes));
  const [note, setNote] = useState(entry.note ?? "");
  const [billable, setBillable] = useState(entry.billable);
  const minutes = parseCellDuration(length);
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">{entry.day}</span>
        <span className="min-w-0 flex-1 truncate">
          {entry.label}
          {entry.sub ? <span className="text-xs text-muted-foreground"> · {entry.sub}</span> : null}
        </span>
        {entry.timer ? <Badge variant="outline">{t("timerSource")}</Badge> : null}
        {entry.billable ? <Badge variant="info">{t("billable")}</Badge> : null}
        <span className="tabular-nums">{durationText(entry.minutes)}</span>
        {editable ? (
          <>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => setEditing((open) => !open)} aria-label={t("edit")}>
              <Pencil aria-hidden />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" disabled={pending} onClick={() => run(deleteTimeEntryAction, { id: entry.id })} aria-label={t("remove")}>
              <X aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
      {entry.note && !editing ? <p className="pl-18 text-xs whitespace-pre-wrap text-muted-foreground">{entry.note}</p> : null}
      {entry.capped ? <p className="text-xs text-warning">{t("capped")}</p> : null}
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!minutes) return;
            run(updateTimeEntryAction, { id: entry.id, minutes, note, billable }, () => setEditing(false));
          }}
        >
          <Input aria-label={t("minutes")} value={length} onChange={(event) => setLength(event.target.value)} className="h-8 w-20" inputMode="decimal" aria-invalid={!minutes || undefined} />
          <Input aria-label={t("note")} placeholder={t("note")} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="h-8 min-w-40 flex-1" />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={billable} onChange={(event) => setBillable(event.target.checked)} /> {t("billableLabel")}
          </label>
          <Button type="submit" size="sm" disabled={pending || !minutes}>
            {t("saveEntry")}
          </Button>
        </form>
      ) : null}
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </li>
  );
}

export function WeekEntries({ entries, editable }: { entries: EntryView[]; editable: boolean }) {
  const t = useTranslations("daily.time");
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t("noEntries")}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {entries.map((entry) => (
        <EntryRow key={`${entry.id}:${entry.minutes}:${entry.billable}:${entry.note ?? ""}`} entry={entry} editable={editable} />
      ))}
    </ul>
  );
}

/** Send the week to the approvers (FR-PJM-25). */
export function SubmitWeekButton({ weekStart, again }: { weekStart: string; again: boolean }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" disabled={pending} onClick={() => run(submitWeekAction, { weekStart })}>
        <Send aria-hidden /> {again ? t("resubmit") : t("submit")}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}
