"use client";
// The forms of the collaboration pages — the RAID log, meetings, the document space. Each posts to
// one server action, which re-checks access; the page decides which forms to show. Mobile first:
// fields stack on a phone and sit in a row from `sm`, and the everyday actions are one tap.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { beginRaidEvidenceAction, completeRaidEvidenceAction, createProjectSpaceAction, issueToTaskAction, meetingCalendarAction, openRaidEvidenceAction, saveMeetingAction, saveRaidItemAction, setRaidStatusAction } from "../collab-actions";
import { RAID_KINDS, RAID_SEVERITIES, type RaidKind, RECORDABLE_MEETING_KINDS } from "../engine/raid";
import { UploadField } from "./commercial-forms";
import { ActionButton, ActionForm } from "./plan-forms";

type Person = { id: string; fullName: string };
type Upload = { fileId: string; uploadUrl: string; contentType: string };
type Stored = { fileId: string; fileName: string };

const textarea = "min-h-20 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm";

// ── The RAID log (FR-PJM-29) ────────────────────────────────────────────────────────────────

export type RaidValues = { id: string; kind: RaidKind; title: string; description: string | null; ownerPersonId: string | null; dueDate: string | null; severity: string | null; decidedOn: string | null; evidenceUrl: string | null; evidence: Stored | null };

/** A new item (the kind chosen first, the fields following it) or an item being changed (its kind fixed). */
export function RaidForm({ projectId, people, item, today, onDone }: { projectId: string; people: readonly Person[]; item?: RaidValues; today: string; onDone?: () => void }) {
  const t = useTranslations("projects.raid");
  const [kind, setKind] = useState<RaidKind>(item?.kind ?? "risk");
  const [key, setKey] = useState(0);
  const id = item?.id ?? "new";
  const rated = kind === "risk" || kind === "issue";
  return (
    <ActionForm
      key={key}
      action={saveRaidItemAction}
      extra={{ projectId, ...(item ? { itemId: item.id, kind: item.kind } : {}) }}
      submit={item ? t("save") : t("add")}
      onDone={() => {
        if (!item) setKey((value) => value + 1);
        onDone?.();
      }}
    >
      {item ? null : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">{t("fields.kind")}</legend>
          <div className="flex flex-wrap gap-2">
            {RAID_KINDS.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm has-checked:bg-muted">
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} /> {t(`kinds.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field name="title" label={t("fields.title")}>
        <Input id={`raid-title-${id}`} name="title" required maxLength={300} defaultValue={item?.title ?? ""} placeholder={t(`placeholders.${kind}`)} />
      </Field>
      <Field name="description" label={t("fields.description")}>
        <textarea id={`raid-desc-${id}`} name="description" rows={2} maxLength={4000} defaultValue={item?.description ?? ""} className={textarea} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="ownerPersonId" label={t("fields.owner")}>
          <Select id={`raid-owner-${id}`} name="ownerPersonId" defaultValue={item?.ownerPersonId ?? ""}>
            <option value="">{t("noOwner")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="dueDate" label={t("fields.dueDate")}>
          <Input id={`raid-due-${id}`} name="dueDate" type="date" defaultValue={item?.dueDate ?? ""} />
        </Field>
        {rated ? (
          <Field name="severity" label={t("fields.severity")}>
            <Select id={`raid-sev-${id}`} name="severity" required defaultValue={item?.severity ?? "medium"}>
              {RAID_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`severities.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {kind === "decision" ? (
          <Field name="decidedOn" label={t("fields.decidedOn")}>
            <Input id={`raid-decided-${id}`} name="decidedOn" type="date" required max={today} defaultValue={item?.decidedOn ?? today} />
          </Field>
        ) : null}
      </div>
      {kind === "decision" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <UploadField label={t("fields.evidenceFile")} name="evidenceFileId" initial={item?.evidence} begin={(meta) => beginRaidEvidenceAction({ projectId, ...meta }) as Promise<ActionResult<Upload>>} complete={(fileId) => completeRaidEvidenceAction({ fileId }) as Promise<ActionResult<Stored>>} />
          <Field name="evidenceUrl" label={t("fields.evidenceUrl")}>
            <Input id={`raid-url-${id}`} name="evidenceUrl" type="url" maxLength={500} defaultValue={item?.evidenceUrl ?? ""} placeholder="https://" />
          </Field>
        </div>
      ) : null}
    </ActionForm>
  );
}

/** Close or reopen an item: one tap. */
export function RaidStatusButton({ itemId, open }: { itemId: string; open: boolean }) {
  const t = useTranslations("projects.raid");
  return <ActionButton action={setRaidStatusAction} input={{ itemId, status: open ? "closed" : "open" }} label={open ? t("close") : t("reopen")} />;
}

/** Turns an open issue into a task of the project: to the owner by default, or someone else, with a due date. */
export function IssueToTaskForm({ itemId, people, ownerPersonId, dueDate }: { itemId: string; people: readonly Person[]; ownerPersonId: string | null; dueDate: string | null }) {
  const t = useTranslations("projects.raid");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t("toTask")}</summary>
      <div className="pt-2">
        <ActionForm action={issueToTaskAction} extra={{ itemId }} submit={t("toTaskSubmit")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field name="assigneePersonId" label={t("fields.assignee")}>
            <Select id={`task-assignee-${itemId}`} name="assigneePersonId" defaultValue={ownerPersonId ?? ""}>
              <option value="">{t("noOwner")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="dueDate" label={t("fields.dueDate")}>
            <Input id={`task-due-${itemId}`} name="dueDate" type="date" defaultValue={dueDate ?? ""} />
          </Field>
        </ActionForm>
      </div>
    </details>
  );
}

export function RaidEvidenceLink({ projectId, fileId, fileName }: { projectId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openRaidEvidenceAction({ projectId, ...(input as object) }) as Promise<ActionResult<{ url: string }>>} />;
}

/** Changing an item, folded away under its row. */
export function RaidEdit({ projectId, people, item, today }: { projectId: string; people: readonly Person[]; item: RaidValues; today: string }) {
  const t = useTranslations("projects.raid");
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t("edit")}</summary>
      <div className="pt-2">{open ? <RaidForm projectId={projectId} people={people} item={item} today={today} onDone={() => setOpen(false)} /> : null}</div>
    </details>
  );
}

// ── Meetings (FR-PJM-30) ────────────────────────────────────────────────────────────────────

export type MeetingValues = { id: string; kind: string; title: string; heldOn: string; startTime: string | null; durationMinutes: number | null; attendeeIds: string[]; externalAttendees: string | null; agenda: string | null; notes: string | null };

const BLANK_ROWS = 3;

/**
 * A meeting: when, who, the agenda and the notes — then what was decided (each a decision in the
 * log) and what has to be done (each a task in the project). Changing a meeting adds decisions and
 * action items; the ones already made are managed in the log and on the board.
 */
export function MeetingForm({ projectId, people, meeting, today }: { projectId: string; people: readonly Person[]; meeting?: MeetingValues; today: string }) {
  const t = useTranslations("projects.meetings");
  const router = useRouter();
  const [key, setKey] = useState(0);
  const id = meeting?.id ?? "new";
  const attendees = new Set(meeting?.attendeeIds ?? []);
  // Someone on the notes who has since left the project is still listed, ticked.
  const gone = (meeting?.attendeeIds ?? []).filter((personId) => !people.some((person) => person.id === personId));
  return (
    <ActionForm
      key={key}
      action={saveMeetingAction}
      extra={{ projectId, ...(meeting ? { meetingId: meeting.id } : {}) }}
      submit={meeting ? t("save") : t("record")}
      onDone={() => {
        setKey((value) => value + 1);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem]">
        <Field name="kind" label={t("fields.kind")}>
          <Select id={`m-kind-${id}`} name="kind" defaultValue={meeting?.kind ?? "weekly"}>
            {RECORDABLE_MEETING_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`kinds.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="title" label={t("fields.title")}>
          <Input id={`m-title-${id}`} name="title" required maxLength={200} defaultValue={meeting?.title ?? ""} placeholder={t("titleHint")} />
        </Field>
        <Field name="heldOn" label={t("fields.heldOn")}>
          <Input id={`m-date-${id}`} name="heldOn" type="date" required defaultValue={meeting?.heldOn ?? today} />
        </Field>
      </div>
      {/* The hour is what a calendar invitation is made of (FR-PJM-30); notes written up afterwards need none. */}
      <div className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
        <Field name="startTime" label={t("fields.startTime")}>
          <Input id={`m-time-${id}`} name="startTime" type="time" defaultValue={meeting?.startTime?.slice(0, 5) ?? ""} />
        </Field>
        <Field name="durationMinutes" label={t("fields.durationMinutes")}>
          <Input id={`m-len-${id}`} name="durationMinutes" type="number" min={5} max={720} step={5} defaultValue={meeting?.durationMinutes ?? ""} placeholder="60" />
        </Field>
        <p className="self-end pb-2 text-xs text-muted-foreground">{t("timeHint")}</p>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">{t("fields.attendees")}</legend>
        <div className="flex flex-wrap gap-2">
          {people.map((person) => (
            <label key={person.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm has-checked:bg-muted">
              <input type="checkbox" name="attendeeIds[]" value={person.id} defaultChecked={attendees.has(person.id)} /> {person.fullName}
            </label>
          ))}
          {gone.map((personId) => (
            <input key={personId} type="hidden" name="attendeeIds[]" value={personId} />
          ))}
        </div>
      </fieldset>
      <Field name="externalAttendees" label={t("fields.externalAttendees")}>
        <Input id={`m-ext-${id}`} name="externalAttendees" maxLength={1000} defaultValue={meeting?.externalAttendees ?? ""} placeholder={t("externalHint")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="agenda" label={t("fields.agenda")}>
          <textarea id={`m-agenda-${id}`} name="agenda" rows={4} maxLength={8000} defaultValue={meeting?.agenda ?? ""} className={textarea} />
        </Field>
        <Field name="notes" label={t("fields.notes")}>
          <textarea id={`m-notes-${id}`} name="notes" rows={4} maxLength={20000} defaultValue={meeting?.notes ?? ""} className={textarea} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{meeting ? t("moreDecisions") : t("fields.decisions")}</legend>
        <p className="text-xs text-muted-foreground">{t("decisionsHint")}</p>
        {Array.from({ length: BLANK_ROWS }, (_, index) => (
          <div key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2 sm:border-0 sm:p-0">
            <Input aria-label={t("fields.decision")} id={`m-dec-${id}-${index}`} name={`decisions.${index}.title`} maxLength={300} placeholder={t("decisionHint")} />
            <Input aria-label={t("fields.decisionDetail")} id={`m-decd-${id}-${index}`} name={`decisions.${index}.description`} maxLength={2000} placeholder={t("fields.decisionDetail")} />
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{meeting ? t("moreActions") : t("fields.actions")}</legend>
        <p className="text-xs text-muted-foreground">{t("actionsHint")}</p>
        {Array.from({ length: BLANK_ROWS }, (_, index) => (
          <div key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_12rem_10rem] sm:border-0 sm:p-0">
            <Input aria-label={t("fields.action")} id={`m-act-${id}-${index}`} name={`actions.${index}.title`} maxLength={300} placeholder={t("actionHint")} />
            <Select aria-label={t("fields.assignee")} id={`m-actp-${id}-${index}`} name={`actions.${index}.assigneePersonId`} defaultValue="">
              <option value="">{t("fields.assignee")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <Input aria-label={t("fields.due")} id={`m-actd-${id}-${index}`} name={`actions.${index}.dueDate`} type="date" />
          </div>
        ))}
      </fieldset>
    </ActionForm>
  );
}

export type MeetingCalendarValues = { id: string; startTime: string | null; calendarEventId: string | null; calendarStatus: string | null; calendarError: string | null; meetingUrl: string | null };

/**
 * "Put it in the calendar" (FR-PJM-30). The invitation goes out through the platform's adapter,
 * which on a machine with no Google service account records `simulated` — so this says exactly
 * that, and never pretends an invitation reached anybody's mailbox.
 */
export function MeetingCalendar({ projectId, meeting }: { projectId: string; meeting: MeetingCalendarValues }) {
  const t = useTranslations("projects.meetings.calendar");
  const inCalendar = !!meeting.calendarEventId;
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="text-base font-medium">{t("title")}</h2>
      {meeting.startTime ? null : <p className="text-sm text-muted-foreground">{t("needsTime")}</p>}
      {meeting.calendarStatus ? (
        <p className="text-sm">
          {t(`status.${meeting.calendarStatus as "simulated"}`)}
          {meeting.calendarError ? <span className="text-destructive"> · {meeting.calendarError.slice(0, 120)}</span> : null}
        </p>
      ) : null}
      {meeting.meetingUrl ? (
        <a href={meeting.meetingUrl} className="text-sm underline" target="_blank" rel="noreferrer">
          {t("join")}
        </a>
      ) : null}
      {meeting.startTime ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton action={meetingCalendarAction} input={{ projectId, meetingId: meeting.id }} label={inCalendar ? t("update") : t("put")} variant={inCalendar ? "outline" : "default"} />
          {inCalendar ? <ActionButton action={meetingCalendarAction} input={{ projectId, meetingId: meeting.id, remove: "on" }} label={t("remove")} variant="ghost" confirm={t("removeConfirm")} /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Documents (FR-PJM-31) ───────────────────────────────────────────────────────────────────

/** Makes the project's document space with its starter pages, then shows it. */
export function CreateSpaceButton({ projectId }: { projectId: string }) {
  const t = useTranslations("projects.documents");
  const tErrors = useTranslations("projects.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createProjectSpaceAction({ projectId });
            setError(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
            if (result.ok) router.refresh();
          })
        }
      >
        {pending ? t("creating") : t("create")}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {tErrors.has(error) ? tErrors(error) : tErrors("generic")}
        </span>
      ) : null}
    </div>
  );
}
