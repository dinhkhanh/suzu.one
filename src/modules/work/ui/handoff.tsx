"use client";
// Hand-offs on screen (FR-PJM-40..43): the one note form every kind uses, the hand-off sheet a
// refused move opens, the accept / return buttons, and the task page's hand-off panel.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { HandoffRequirement } from "../handoff-gate";
import { NOTE_PARTS, type Note, type NotePart } from "../engine/handoff";
import { acceptHandoffAction, handOffTaskAction, returnHandoffAction, sendToTeamAction } from "../handoff-actions";

type Result = { ok: boolean; error?: string; message?: string; details?: unknown };
const textareaClass = "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";
const errorOf = (result: Result) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("work");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

// ── The note (FR-PJM-43) ────────────────────────────────────────────────────────────────────

/**
 * The assistant's "draft the note from the thread" button (FR-PJM-64), handed in by the routes
 * (the /work layout) so this module does not reach into another module's screens. It fills the
 * note's fields by id and never sends. None provided = no button.
 */
export type HandoffNoteDraft = (props: { taskId: string; targets: Partial<Record<NotePart | "links", string>> }) => ReactNode;
export const HandoffNoteDraftContext = createContext<HandoffNoteDraft | null>(null);

/** The same headings for every hand-off: stage, cross-team, cover, exit, account. Named `note.<part>` inside the caller's form. */
export function HandoffNoteFields({
  defaultValue,
  required = false,
  taskId,
  idPrefix = "note",
}: {
  defaultValue?: Note;
  /** Cross-team, exit and account hand-offs need at least the context. */ required?: boolean;
  /** A task's hand-off: the note can be drafted from its comment thread (FR-PJM-64). */ taskId?: string;
  /** Two note forms on one page (the sheet and "send to another team") keep their fields apart. */ idPrefix?: string;
}) {
  const t = useTranslations("work.handoff.note");
  const draft = use(HandoffNoteDraftContext);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-sm font-medium">{t("title")}</legend>
      {/* The draft fills the fields below by id; the person reads and edits it before sending. */}
      {taskId && draft ? draft({ taskId, targets: { ...Object.fromEntries(NOTE_PARTS.map((part) => [part, `${idPrefix}-${part}`])), links: `${idPrefix}-links` } }) : null}
      {NOTE_PARTS.map((part) => (
        <div key={part} className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-${part}`} className="text-xs text-muted-foreground">
            {t(part)}
          </Label>
          <textarea id={`${idPrefix}-${part}`} name={`note.${part}`} maxLength={4000} defaultValue={defaultValue?.[part] ?? ""} required={required && part === "context"} placeholder={t(`${part}Hint`)} className={textareaClass} />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-links`} className="text-xs text-muted-foreground">
          {t("links")}
        </Label>
        <textarea id={`${idPrefix}-links`} name="note.links" defaultValue={(defaultValue?.links ?? []).join("\n")} placeholder={t("linksHint")} className={textareaClass} />
      </div>
    </fieldset>
  );
}

/** The note from a form holding `HandoffNoteFields`. */
export function readNote(data: FormData): Note {
  const note: Note = {};
  for (const part of NOTE_PARTS) {
    const value = String(data.get(`note.${part}`) ?? "").trim();
    if (value) note[part] = value;
  }
  const links = String(data.get("note.links") ?? "")
    .split(/\s+/)
    .map((link) => link.trim())
    .filter(Boolean);
  if (links.length) note.links = links;
  return note;
}

/** A stored note, read-only, under the same headings. */
export function HandoffNoteView({ note }: { note: Note }) {
  const t = useTranslations("work.handoff.note");
  const parts = NOTE_PARTS.filter((part) => note[part]);
  if (parts.length === 0 && !note.links?.length) return null;
  return (
    <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
      {parts.map((part: NotePart) => (
        <div key={part} className="contents">
          <dt className="text-xs text-muted-foreground">{t(part)}</dt>
          <dd className="whitespace-pre-line">{note[part]}</dd>
        </div>
      ))}
      {note.links?.length ? (
        <>
          <dt className="text-xs text-muted-foreground">{t("links")}</dt>
          <dd className="flex flex-col">
            {note.links.map((link) => (
              <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="truncate underline">
                {link}
              </a>
            ))}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

// ── The hand-off sheet (FR-PJM-40) ──────────────────────────────────────────────────────────

type Missing = { kind: "field" | "invalid"; key: string; label: string } | { kind: "check"; id: string; text: string } | { kind: "link" } | { kind: "file" };

/** The package a refusal carries, if the refusal is the hand-off gate's. */
export function handoffOf(result: Result): HandoffRequirement | null {
  if (result.ok || result.message !== "handoff_required") return null;
  const details = result.details as { handoff?: HandoffRequirement } | undefined;
  return details?.handoff ?? null;
}

/**
 * For every screen that moves tasks: `intercept(result)` after an update — when the move needs a
 * package it opens the sheet (and returns true); render `sheet` somewhere in the screen.
 */
export function useHandoffGate() {
  const [requirement, setRequirement] = useState<HandoffRequirement | null>(null);
  const intercept = (result: Result): boolean => {
    const handoff = handoffOf(result);
    if (handoff) setRequirement(handoff);
    return !!handoff;
  };
  const sheet = requirement ? <HandoffSheet key={`${requirement.taskId}:${requirement.toStateId}`} requirement={requirement} onClose={() => setRequirement(null)} /> : null;
  return { intercept, open: setRequirement, sheet };
}

/** A sheet from the bottom on a phone, a panel on the right on a desk. */
export function HandoffSheet({ requirement, onClose, onDone }: { requirement: HandoffRequirement; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations("work.handoff");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [missing, setMissing] = useState<Missing[]>([]);
  const { package: pkg } = requirement;
  const missingText = (item: Missing) => (item.kind === "field" ? t("missing.field", { label: item.label }) : item.kind === "invalid" ? t("missing.invalid", { label: item.label }) : item.kind === "check" ? t("missing.check", { text: item.text }) : t(`missing.${item.kind}`));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(pkg.fields.map((field) => [field.key, String(data.get(`value.${field.key}`) ?? "")]));
    const link = String(data.get("link") ?? "").trim();
    startTransition(async () => {
      const result = (await handOffTaskAction({
        taskId: requirement.taskId,
        toStateId: requirement.toStateId,
        values,
        checked: data.getAll("checked").map(String),
        links: link ? [link] : [],
        fileId: String(data.get("fileId") ?? ""),
        toPersonId: String(data.get("toPersonId") ?? ""),
        note: readNote(data),
      })) as Result;
      if (result.ok) {
        onDone?.();
        onClose();
        router.refresh();
        return;
      }
      setErrorKey(errorOf(result));
      setMissing(result.message === "handoff_incomplete" ? ((result.details as { missing?: Missing[] })?.missing ?? []) : []);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-stretch sm:justify-end" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="handoff-sheet-title" className="flex max-h-[92vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-4 shadow-xl sm:max-h-none sm:max-w-lg sm:rounded-none">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="handoff-sheet-title" className="text-base font-semibold">
              {t("sheet.title", { name: pkg.name })}
            </h2>
            <p className="text-sm text-muted-foreground">{t("sheet.move", { key: requirement.taskKey, title: requirement.taskTitle, from: requirement.fromStateName, to: requirement.toStateName })}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("sheet.close")}>
            ×
          </Button>
        </header>
        <p className="rounded-lg bg-muted p-2 text-sm">{t("sheet.why")}</p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {pkg.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`value-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              <Input id={`value-${field.key}`} name={`value.${field.key}`} type={field.type === "url" ? "url" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} required={field.required} maxLength={2000} />
            </div>
          ))}
          {pkg.checklist.length ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-sm font-medium">{t("sheet.checklist")}</legend>
              {pkg.checklist.map((check) => (
                <label key={check.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="checked" value={check.id} /> {check.text}
                </label>
              ))}
            </fieldset>
          ) : null}
          {pkg.requireLink ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handoff-link">{t("sheet.link")} *</Label>
              <Input id="handoff-link" name="link" type="url" maxLength={1000} placeholder="https://" />
            </div>
          ) : null}
          {pkg.requireFile ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handoff-file">{t("sheet.file")} *</Label>
              {requirement.files.length ? (
                <Select id="handoff-file" name="fileId" required defaultValue="">
                  <option value="" disabled>
                    {t("sheet.pickFile")}
                  </option>
                  {requirement.files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.fileName}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("sheet.noFiles")}{" "}
                  <Link href={`/work/tasks/${requirement.taskId}`} className="underline">
                    {t("sheet.openTask")}
                  </Link>
                </p>
              )}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="handoff-receiver">
              {t("sheet.receiver")}
              {pkg.requireAccept ? " *" : ""}
            </Label>
            <Select id="handoff-receiver" name="toPersonId" defaultValue={requirement.defaultReceiverId ?? ""} required={pkg.requireAccept}>
              <option value="">{pkg.requireAccept ? t("sheet.pickReceiver") : t("sheet.keepAssignee")}</option>
              {requirement.receivers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{pkg.requireAccept ? t("sheet.mustAccept") : t("sheet.recorded")}</p>
          </div>
          <HandoffNoteFields taskId={requirement.taskId} />
          {missing.length ? (
            <ul role="alert" className="list-disc rounded-lg border border-destructive/30 bg-destructive/5 p-2 pl-6 text-sm text-destructive">
              {missing.map((item, index) => (
                <li key={index}>{missingText(item)}</li>
              ))}
            </ul>
          ) : (
            <ErrorLine errorKey={errorKey} />
          )}
          <div className="sticky bottom-0 flex gap-2 bg-background pt-2">
            <Button type="submit" disabled={pending} className="flex-1">
              {t("sheet.submit", { state: requirement.toStateName })}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("sheet.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Accept / return (FR-PJM-41) ─────────────────────────────────────────────────────────────

/** The receiver's two buttons. Exported for any screen that lists pending hand-offs (My work, the task page, Today). */
export function HandoffResponder({ handoffId, compact = false }: { handoffId: string; compact?: boolean }) {
  const t = useTranslations("work.handoff");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const run = (call: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorOf(result));
      if (result.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      {returning ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
            run(() => returnHandoffAction({ handoffId, reason }) as Promise<Result>);
          }}
        >
          <Input name="reason" required maxLength={1000} placeholder={t("returnReason")} aria-label={t("returnReason")} className="min-w-0 flex-1" autoFocus />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {t("return")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>
            {t("sheet.cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => acceptHandoffAction({ handoffId }) as Promise<Result>)} className={compact ? "" : "flex-1 sm:flex-none"}>
            {t("accept")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setReturning(true)}>
            {t("returnStart")}
          </Button>
        </div>
      )}
      <ErrorLine errorKey={errorKey} />
    </div>
  );
}

// ── The task page's panel ───────────────────────────────────────────────────────────────────

export type HandoffItem = {
  id: string;
  kind: string;
  status: string;
  fromName: string | null;
  toName: string | null;
  toTeamName: string | null;
  fromStateName: string | null;
  toStateName: string | null;
  packageName: string | null;
  packageFields: { key: string; label: string }[];
  packageValues: Record<string, string>;
  checklist: { id: string; text: string; done: boolean }[];
  fileName: string | null;
  note: Note;
  returnReason: string | null;
  respondedByName: string | null;
  createdAt: string;
  respondedAt: string | null;
  target: { id: string; key: string | null; title: string | null; stateName: string; status: string; triageStatus: string | null } | null;
  canRespond: boolean;
};


/** Every hand-off of the task, newest first, with its note (FR-PJM-43) — and "send to another team" (FR-PJM-42). */
export function HandoffPanel({ taskId, taskTitle, handoffs, teams, canSend }: { taskId: string; taskTitle: string; handoffs: HandoffItem[]; teams: { id: string; name: string }[]; canSend: boolean }) {
  const t = useTranslations("work.handoff");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  const waited = (item: HandoffItem) => {
    const minutes = Math.max(0, Math.round((Date.parse(item.respondedAt ?? new Date().toISOString()) - Date.parse(item.createdAt)) / 60_000));
    return minutes < 60 ? t("waitedMinutes", { minutes }) : minutes < 60 * 48 ? t("waitedHours", { hours: Math.round(minutes / 60) }) : t("waitedDays", { days: Math.round(minutes / 1440) });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      {handoffs.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="flex flex-col gap-2">
        {handoffs.map((item) => (
          <li key={item.id} className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${item.status === "pending" ? "border-primary/40" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(`kinds.${item.kind}`)}</Badge>
              <Badge dot variant={statusTone(item.status)}>{t(`statuses.${item.status}`)}</Badge>
              <span className="text-muted-foreground">
                {item.kind === "cross_team" ? t("toTeam", { from: item.fromName ?? "—", team: item.toTeamName ?? "—" }) : t("fromTo", { from: item.fromName ?? "—", to: item.toName ?? "—" })}
                {item.fromStateName && item.toStateName ? ` · ${item.fromStateName} → ${item.toStateName}` : ""}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {when(item.createdAt)}
                {item.status === "pending" || item.respondedAt ? ` · ${waited(item)}` : ""}
              </span>
            </div>
            {item.target ? (
              <p className="text-xs">
                {t("targetStatus")}{" "}
                {item.target.key ? (
                  <Link href={`/work/tasks/${item.target.id}`} className="underline">
                    {item.target.key} {item.target.title}
                  </Link>
                ) : null}{" "}
                <Badge variant="outline">{item.target.triageStatus === "pending" || item.target.triageStatus === "snoozed" ? t("inTriage") : item.target.stateName}</Badge>
              </p>
            ) : null}
            {item.packageName ? <p className="text-xs text-muted-foreground">{t("package", { name: item.packageName })}</p> : null}
            {Object.keys(item.packageValues).length ? (
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
                {Object.entries(item.packageValues).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-xs text-muted-foreground">{item.packageFields.find((field) => field.key === key)?.label ?? key}</dt>
                    <dd className="break-words">{/^https?:\/\//.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer" className="underline">{value}</a> : value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {item.checklist.length ? (
              <ul className="flex flex-col gap-0.5 text-xs">
                {item.checklist.map((check) => (
                  <li key={check.id}>
                    {check.done ? "☑" : "☐"} {check.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.fileName ? <p className="text-xs">📎 {item.fileName}</p> : null}
            <HandoffNoteView note={item.note} />
            {item.returnReason ? <p className="text-destructive">{t("returnedBecause", { name: item.respondedByName ?? "—", reason: item.returnReason })}</p> : null}
            {item.status === "pending" && item.canRespond ? <HandoffResponder handoffId={item.id} /> : null}
          </li>
        ))}
      </ul>
      {canSend && teams.length ? <SendToTeamForm taskId={taskId} taskTitle={taskTitle} teams={teams} /> : null}
    </section>
  );
}

/** FR-PJM-42: a follow-on task in another team's triage, with the note; the two stay linked. */
function SendToTeamForm({ taskId, taskTitle, teams }: { taskId: string; taskTitle: string; teams: { id: string; name: string }[] }) {
  const t = useTranslations("work.handoff.send");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("title")}</summary>
      <form
        className="flex flex-col gap-3 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          startTransition(async () => {
            const result = (await sendToTeamAction({ taskId, teamId: data.get("teamId"), title: data.get("title"), dueDate: data.get("dueDate"), note: readNote(data) })) as Result & { data?: { targetKey: string } };
            setErrorKey(errorOf(result));
            if (result.ok) {
              setSent(result.data?.targetKey ?? "");
              form.reset();
              router.refresh();
            }
          });
        }}
      >
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-team">{t("team")}</Label>
            <Select id="send-team" name="teamId" required defaultValue="">
              <option value="" disabled>
                {t("pickTeam")}
              </option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-due">{t("dueDate")}</Label>
            <Input id="send-due" name="dueDate" type="date" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-title">{t("taskTitle")}</Label>
          <Input id="send-title" name="title" required maxLength={200} defaultValue={taskTitle} />
        </div>
        <HandoffNoteFields required taskId={taskId} idPrefix="send-note" />
        <ErrorLine errorKey={errorKey} />
        {sent !== null ? <p className="text-sm text-muted-foreground">{t("sent", { key: sent })}</p> : null}
        <Button type="submit" size="sm" disabled={pending} className="self-start">
          {t("submit")}
        </Button>
      </form>
    </details>
  );
}
