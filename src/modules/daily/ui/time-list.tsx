"use client";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { deleteTimeEntryAction } from "../time-actions";
import { hoursOf } from "./format";
import { useRun } from "./use-run";

type Entry = { id: string; /** The task the time is on: its name is then the way to it. */ taskId?: string | null; key: string | null; title: string | null; category: string | null; minutes: number; billable: boolean };

/** Today's time, each line removable while the week is open. */
export function TimeList({ entries }: { entries: Entry[] }) {
  const t = useTranslations("daily");
  const { run, pending, errorKey } = useRun();
  if (entries.length === 0) return null;
  return (
    <>
      <List>
        {entries.map((entry, index) => (
          <ListItem key={entry.id} className="rise" style={{ "--i": index } as React.CSSProperties}>
            <span className="min-w-0 flex-1 truncate">
              <RecordLink kind="task" id={entry.taskId}>
                {entry.key ? <span className="font-mono text-xs text-muted-foreground">{entry.key} </span> : null}
                {entry.title ?? (entry.category ? t(`time.categories.${entry.category as "admin"}`) : "")}
              </RecordLink>
            </span>
            {entry.billable ? <Badge variant="info">{t("time.billable")}</Badge> : null}
            <span className="font-mono text-[0.8125rem] tabular-nums">{t("hours", { value: hoursOf(entry.minutes) })}</span>
            <Button type="button" size="icon-xs" variant="ghost" disabled={pending} onClick={() => run(deleteTimeEntryAction, { id: entry.id })} aria-label={t("time.remove")}>
              <X aria-hidden />
            </Button>
          </ListItem>
        ))}
      </List>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}
