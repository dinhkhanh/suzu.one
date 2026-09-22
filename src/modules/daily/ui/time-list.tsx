"use client";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { deleteTimeEntryAction } from "../time-actions";
import { hoursOf } from "./format";
import { useRun } from "./use-run";

type Entry = { id: string; key: string | null; title: string | null; category: string | null; minutes: number; billable: boolean };

/** Today's time, each line removable while the week is open. */
export function TimeList({ entries }: { entries: Entry[] }) {
  const t = useTranslations("daily");
  const { run, pending, errorKey } = useRun();
  if (entries.length === 0) return null;
  return (
    <>
      <ul className="flex flex-col gap-1 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {entry.key ? <span className="font-mono text-xs text-muted-foreground">{entry.key}</span> : null} {entry.title ?? (entry.category ? t(`time.categories.${entry.category as "admin"}`) : "")}
            </span>
            <span className="text-xs text-muted-foreground">{entry.billable ? t("time.billable") : null}</span>
            <span className="tabular-nums">{t("hours", { value: hoursOf(entry.minutes) })}</span>
            <Button type="button" size="icon-xs" variant="ghost" disabled={pending} onClick={() => run(deleteTimeEntryAction, { id: entry.id })} aria-label={t("time.remove")}>
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}
