"use client";
// Drafting buttons (FR-PJM-64) for the daily, projects and work screens to mount. Each asks the
// server for a draft and puts it into the form's own fields — it never submits and never saves:
// the person reads it, edits it and submits it (or clears it) as they would their own words.
//
// The fields are named by id. Setting a value goes through the native setter and an `input`
// event, so it works for an uncontrolled field (`defaultValue`) and for a React-controlled one.
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";
import { draftEodNotesAction, draftHandoffNoteAction, draftStatusSummaryAction } from "../draft-actions";
import type { HandoffNoteDraft } from "../engine/drafts";

function fill(id: string | undefined, value: string) {
  if (!id) return;
  const field = document.getElementById(id);
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** One button, one draft: busy while it runs, a line saying what happened after. */
function useDraft<Data>(run: (locale: string) => Promise<ActionResult<Data>>, apply: (data: Data) => void) {
  const t = useTranslations("assistant.drafts");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const trigger = () =>
    start(async () => {
      const result = await run(locale);
      if (!result.ok) return setMessage(t(result.message === "draft_not_available" ? "notAvailable" : "failed"));
      apply(result.data);
      setMessage(t("filled"));
    });
  return { pending, message, trigger };
}

function DraftControl({ label, pending, message, onClick }: { label: string; pending: boolean; message: string | null; onClick: () => void }) {
  const t = useTranslations("assistant.drafts");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClick}>
        {pending ? t("working") : label}
      </Button>
      {message ? (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Drafts the notes of the caller's own end-of-day report for `date` from the day's activity, into
 * the field with id `targetId` (the report form's notes). Mount beside that field.
 */
export function EodNotesDraftButton({ date, targetId, onDraft }: { date: string; targetId?: string; onDraft?: (text: string) => void }) {
  const t = useTranslations("assistant.drafts");
  const draft = useDraft(
    (locale) => draftEodNotesAction({ date, locale }),
    (data: { text: string }) => {
      fill(targetId, data.text);
      onDraft?.(data.text);
    },
  );
  return <DraftControl label={t("buttons.eod")} pending={draft.pending} message={draft.message} onClick={draft.trigger} />;
}

/**
 * Drafts the summary of the project's next status update from its facts into `targetId`, and the
 * health the facts suggest into `healthTargetId` (a select of on_track / at_risk / off_track).
 */
export function StatusDraftButton({ projectId, targetId, healthTargetId, onDraft }: { projectId: string; targetId?: string; healthTargetId?: string; onDraft?: (draft: { text: string; health: string }) => void }) {
  const t = useTranslations("assistant.drafts");
  const draft = useDraft(
    (locale) => draftStatusSummaryAction({ projectId, locale }),
    (data: { text: string; health: string }) => {
      fill(targetId, data.text);
      fill(healthTargetId, data.health);
      onDraft?.(data);
    },
  );
  return <DraftControl label={t("buttons.status")} pending={draft.pending} message={draft.message} onClick={draft.trigger} />;
}

type NoteTargets = Partial<Record<"context" | "state" | "done" | "next" | "questions" | "links" | "contacts", string>>;

/**
 * Summarises the task's comment thread into a hand-off note, filling the note form's fields by id
 * (`targets.context`, `targets.state`, …; links one per line). Parts the thread does not speak to
 * are left as the person wrote them.
 */
export function HandoffNoteDraftButton({ taskId, targets = {}, onDraft }: { taskId: string; targets?: NoteTargets; onDraft?: (note: HandoffNoteDraft) => void }) {
  const t = useTranslations("assistant.drafts");
  const draft = useDraft(
    (locale) => draftHandoffNoteAction({ taskId, locale }),
    (data: { note: HandoffNoteDraft }) => {
      const { links, ...parts } = data.note;
      for (const [part, value] of Object.entries(parts)) if (value) fill(targets[part as keyof NoteTargets], value);
      if (links?.length) fill(targets.links, links.join("\n"));
      onDraft?.(data.note);
    },
  );
  return <DraftControl label={t("buttons.handoff")} pending={draft.pending} message={draft.message} onClick={draft.trigger} />;
}
