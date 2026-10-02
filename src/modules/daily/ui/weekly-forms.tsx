"use client";
// The lead's own words on a weekly report, and a refresh of the facts for a week the job has not
// generated yet.
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { draftSaved } from "@/modules/platform/rich-text/ui/drafts";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { generateTeamWeekAction, saveWeeklySummaryAction } from "../actions";
import { useRun } from "./use-run";

export function WeeklySummaryForm({ id, summary }: { id: string; summary: string | null }) {
  const t = useTranslations("daily.weekly");
  const [text, setText] = useState(summary ?? "");
  const [saved, setSaved] = useState(false);
  const { run, pending, errorKey } = useRun();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        run(saveWeeklySummaryAction, { id, summary: text }, () => {
          setSaved(true);
          draftSaved(form);
        });
      }}
    >
      <NoteEditor
        aria-label={t("summary")}
        draft={`weekly-summary:${id}`}
        value={text}
        onChange={(next) => {
          setText(next);
          setSaved(false);
        }}
        maxLength={5000}
        rows={5}
        placeholder={t("summaryPlaceholder")}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("saveSummary")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </form>
  );
}

export function GenerateWeekButton({ teamId, weekStart, label }: { teamId: string; weekStart: string; label: string }) {
  const { run, pending, errorKey } = useRun();
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(generateTeamWeekAction, { teamId, weekStart })}>
        <RefreshCw aria-hidden /> {label}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}
