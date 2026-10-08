"use client";
// The week's entries one by one (FR-PJM-24): each can be corrected — its length, note and whether
// it is billed — or removed while the week is open. A timer cut at 16 hours says so.
import { Pencil, Send, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type CSSProperties, useState } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { deleteTimeEntryAction, recallWeekAction, submitWeekAction, updateTimeEntryAction } from "../time-actions";
import { durationText, parseCellDuration } from "./format";
import { useRun } from "./use-run";

export type EntryView = {
  id: string;
  day: string;
  label: string;
  sub: string | null;
  /** The project's job number, shown before its name. */ job?: string | null;
  /** The task and the project the labels name, when the reader may open them. */ taskId?: string | null;
  projectId?: string | null;
  minutes: number;
  billable: boolean;
  note: string | null;
  timer: boolean;
  capped: boolean;
};

function EntryRow({ entry, editable, index }: { entry: EntryView; editable: boolean; index: number }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  const [editing, setEditing] = useState(false);
  const [length, setLength] = useState(durationText(entry.minutes));
  const [note, setNote] = useState(entry.note ?? "");
  const [billable, setBillable] = useState(entry.billable);
  const minutes = parseCellDuration(length);
  return (
    <ListItem className="rise flex-col items-stretch gap-1.5" style={{ "--i": index } as CSSProperties}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">{entry.day}</span>
        <span className="min-w-0 flex-1 truncate">
          <RecordLink kind="task" id={entry.taskId}>
            {entry.label}
          </RecordLink>
          {entry.sub ? (
            <span className="text-xs text-muted-foreground">
              {" "}
              · {entry.job ? <span className="font-mono text-faint">{entry.job} </span> : null}
              <RecordLink kind="project" id={entry.projectId}>
                {entry.sub}
              </RecordLink>
            </span>
          ) : null}
        </span>
        {entry.timer ? <Badge variant="outline">{t("timerSource")}</Badge> : null}
        {entry.billable ? <Badge variant="info">{t("billable")}</Badge> : null}
        <span className="font-mono text-[0.8125rem] tabular-nums">{durationText(entry.minutes)}</span>
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
      {entry.note && !editing ? <p className="pl-16 text-xs whitespace-pre-wrap text-muted-foreground">{entry.note}</p> : null}
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
          <Input aria-label={t("minutes")} value={length} onChange={(event) => setLength(event.target.value)} className="h-9 w-20 font-mono text-[0.8125rem] tabular-nums md:h-8" inputMode="decimal" aria-invalid={!minutes || undefined} />
          <Input aria-label={t("note")} placeholder={t("note")} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="h-9 min-w-40 flex-1 md:h-8" />
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={billable} onCheckedChange={(checked) => setBillable(checked)} /> {t("billableLabel")}
          </label>
          <Button type="submit" size="sm" disabled={pending || !minutes}>
            {t("saveEntry")}
          </Button>
        </form>
      ) : null}
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </ListItem>
  );
}

export function WeekEntries({ entries, editable }: { entries: EntryView[]; editable: boolean }) {
  const t = useTranslations("daily.time");
  return (
    <List>
      {entries.length === 0 ? <ListEmpty>{t("noEntries")}</ListEmpty> : null}
      {entries.map((entry, index) => (
        <EntryRow key={`${entry.id}:${entry.minutes}:${entry.billable}:${entry.note ?? ""}`} entry={entry} editable={editable} index={index} />
      ))}
    </List>
  );
}

/** Send the week to the approvers (FR-PJM-25): the hero key of the week's page. */
export function SubmitWeekButton({ weekStart, again }: { weekStart: string; again: boolean }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="lg" variant="accent" disabled={pending} onClick={() => run(submitWeekAction, { weekStart })} className="w-full md:w-auto">
        <Send aria-hidden /> {again ? t("resubmit") : t("submit")}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}

/** Take a submitted week back while nobody has decided it (FR-PJM-25): it opens again, to fix and send anew. */
export function RecallWeekButton({ weekStart }: { weekStart: string }) {
  const t = useTranslations("daily.time");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="lg" variant="outline" disabled={pending} onClick={() => run(recallWeekAction, { weekStart })} className="w-full md:w-auto">
        <Undo2 aria-hidden /> {t("recall")}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}
