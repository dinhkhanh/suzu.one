"use client";
import { HistoryIcon, PaperclipIcon, SmilePlusIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { addCommentAction, beginTaskUploadAction, completeTaskUploadAction, deleteCommentAction, editCommentAction, followTaskAction, openTaskFileAction, reactToCommentAction, removeTaskFileAction } from "../actions";
import { type DraftMention, fromDraft, mentionName, mentionQueryAt, parseBody, splitDraft, toDraft } from "../engine/mentions";
import { REACTIONS } from "../enums";
import type { DetailActivity } from "./task-detail";
import { PersonAvatar } from "./task-row";
import { RecordLink } from "@/components/ui/record-link";

type Person = { id: string; fullName: string };
export type DiscussionComment = {
  id: string;
  parentId: string | null;
  /** null = posted by an automation. */ authorPersonId: string | null;
  authorName: string;
  byAutomation?: boolean;
  body: string;
  reactions: Record<string, string[]>;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
};
export type DiscussionFile = { id: string; fileName: string; sizeBytes: number; uploadedByPersonId?: string | null; uploadedByName: string | null; createdAt: string; canRemove: boolean };

type Failure = { ok: boolean; error?: string; message?: string };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
const searchKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (work: () => Promise<Failure>, done?: () => void) =>
    startTransition(async () => {
      const result = await work();
      setErrorKey(keyOf(result));
      if (result.ok) done?.();
      router.refresh();
    });
  return { run, pending, errorKey, setErrorKey };
}

/** A comment's words: mentions stand out, web addresses become links. Nothing remote is embedded. */
function Body({ body }: { body: string }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {parseBody(body).map((segment, index) =>
        segment.type === "mention" ? (
          <RecordLink key={index} kind="person" id={segment.personId} className="rounded bg-primary/10 px-1 font-medium text-primary">
            @{segment.name}
          </RecordLink>
        ) : segment.type === "link" ? (
          <a key={index} href={segment.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
            {segment.url}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/** A text box with an @-picker over the people who may see the task. */
function Composer({
  people,
  initial = "",
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  placeholder,
}: {
  people: Person[];
  initial?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (body: string, reset: () => void) => void;
  onCancel?: () => void;
  placeholder: string;
}) {
  const t = useTranslations("work.discussion");
  // The box holds the draft as it reads ("@Lê Trần Ý Nhiên"); the people picked are kept beside
  // it, and the stored tokens are put back only when the comment is sent.
  const [draft] = useState(() => toDraft(initial));
  const [body, setBody] = useState(draft.text);
  const [mentions, setMentions] = useState<DraftMention[]>(draft.mentions);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const listId = useId();
  const matches = useMemo(() => (query ? people.filter((person) => searchKey(person.fullName).includes(searchKey(query.query))).slice(0, 6) : []), [people, query]);
  // The highlighted row, moved by the arrow keys. A new search starts again at the top.
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(query?.query);
  if (searched !== query?.query) {
    setSearched(query?.query);
    setActive(0);
  }
  const picking = query !== null && matches.length > 0;
  const current = picking ? Math.min(active, matches.length - 1) : -1;
  const segments = splitDraft(body, mentions);
  const stored = fromDraft(body, mentions);

  function pick(person: Person) {
    const field = box.current;
    if (!query || !field) return;
    const name = mentionName(person.fullName);
    const caret = field.selectionStart;
    setMentions((known) => (known.some((mention) => mention.name === name && mention.personId === person.id) ? known : [...known, { name, personId: person.id }]));
    setQuery(null);
    field.focus();
    field.setSelectionRange(query.start, caret);
    // Typed in as if by the keyboard, so the browser's undo (Ctrl/⌘+Z) takes it back. The change
    // event that follows updates the draft; only where the browser refuses is the value set by hand.
    if (!document.execCommand("insertText", false, `@${name} `)) setBody(`${body.slice(0, query.start)}@${name} ${body.slice(caret)}`);
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSubmit(stored.trim(), () => setBody(""));
      }}
    >
      <div className="relative">
        {/* The same text drawn behind the box, so a picked name can be blue: the box's own text is
            transparent, its caret and placeholder are not. Every metric matches the Textarea's. */}
        <div
          ref={backdrop}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.625rem] border border-transparent bg-background px-3 py-2.5 text-base leading-relaxed break-words whitespace-pre-wrap md:text-sm dark:bg-input/20"
        >
          {segments.map((segment, index) =>
            segment.type === "mention" ? (
              <span key={index} className="rounded-sm bg-primary/10 text-primary">
                @{segment.name}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
          {/* A trailing line break needs something after it to take up its line. */}
          {"\u200b"}
        </div>
        <Textarea
          ref={box}
          value={body}
          rows={3}
          // The limit is on what is stored, and every picked name is stored with its id.
          maxLength={5000 - (stored.length - body.length)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="relative min-h-16 bg-transparent text-transparent caret-foreground selection:bg-primary/20 md:min-h-14 dark:bg-transparent"
          role="combobox"
          aria-expanded={picking}
          aria-controls={picking ? listId : undefined}
          aria-activedescendant={picking ? `${listId}-${current}` : undefined}
          aria-autocomplete="list"
          onScroll={(event) => {
            if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => {
            setBody(event.target.value);
            setQuery(mentionQueryAt(event.target.value, event.target.selectionStart));
          }}
          onKeyDown={(event) => {
            if (picking && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((current + step + matches.length) % matches.length);
            } else if (picking && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              pick(matches[current]);
            } else if (event.key === "Escape") setQuery(null);
            else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
          }}
        />
        {/* In a portal over everything, so a card or a sheet that clips its content cannot cut it off. Focus stays in the text box. */}
        <Popover open={picking} onOpenChange={(open) => (open ? null : setQuery(null))}>
          <PopoverContent anchor={box} align="start" initialFocus={false} finalFocus={false} className="w-64 gap-0 p-1">
            <ul id={listId} role="listbox" aria-label={t("mentionPicker")}>
              {matches.map((person, index) => (
                <li key={person.id}>
                  <button
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === current}
                    className={cn("w-full rounded-md px-2 py-1.5 text-left", index === current ? "bg-muted" : "hover:bg-muted/60")}
                    // Keep the caret in the text box; the click still picks.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(person)}
                  >
                    {person.fullName}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
        <span className="text-xs text-faint">{t("composerHint")}</span>
      </div>
    </form>
  );
}

/** Follow / unfollow. The assignee and the collaborators always hear about their task. */
export function FollowButton({ taskId, state, followers }: { taskId: string; state: "working" | "following" | "muted" | "none"; followers: number }) {
  const t = useTranslations("work.discussion");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{t("followers", { count: followers })}</span>
      {state === "working" ? (
        <span className="text-xs text-muted-foreground">{t("followWorking")}</span>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => followTaskAction({ taskId, follow: state !== "following" }))}>
          {state === "following" ? t("unfollow") : t("follow")}
        </Button>
      )}
      {errorKey ? <span className="text-xs text-destructive">{t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}</span> : null}
    </div>
  );
}

export function TaskFiles({ taskId, files, canAdd, accept }: { taskId: string; files: DiscussionFile[]; canAdd: boolean; accept: string }) {
  const t = useTranslations("work.discussion");
  const format = useFormatter();
  const { run, pending, errorKey, setErrorKey } = useRun();
  const size = (bytes: number) => (bytes >= 1_048_576 ? `${format.number(bytes / 1_048_576, { maximumFractionDigits: 1 })} MB` : `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`);
  return (
    <section className="flex flex-col gap-2">
      <TableCard>
        <TableCardHeader title={t("files", { count: files.length })} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="file">{t("columns.file")}</TableHead>
              <TableHead kind="number">{t("columns.size")}</TableHead>
              <TableHead kind="person">{t("columns.uploadedBy")}</TableHead>
              <TableHead kind="date">{t("columns.added")}</TableHead>
              {files.some((file) => file.canRemove) ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? <TableEmpty>{t("noFiles")}</TableEmpty> : null}
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="max-w-80 truncate">
                  <FileLink fileId={file.id} fileName={file.fileName} download={openTaskFileAction} onError={setErrorKey} />
                </TableCell>
                <TableCell kind="number">{size(file.sizeBytes)}</TableCell>
                <TableCell>
                  {file.uploadedByName ? (
                    <RecordLink kind="person" id={file.uploadedByPersonId}>
                      {file.uploadedByName}
                    </RecordLink>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{format.dateTime(new Date(file.createdAt), { dateStyle: "short" })}</TableCell>
                {files.some((row) => row.canRemove) ? (
                  <TableCell kind="actions">
                    {file.canRemove ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeTaskFileAction({ fileId: file.id }))}>
                        {t("removeFile")}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canAdd ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 border-t px-3 py-2 text-[0.8125rem] font-medium text-link hover:bg-canvas md:pl-[calc(var(--table-gutter)+0.75rem)]">
            <PaperclipIcon className="size-3.5" />
            <input
              type="file"
              accept={accept}
              disabled={pending}
              className="text-sm text-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium"
              aria-label={t("addFile")}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                run(async () => {
                  const result = await uploadThroughSignedUrl(
                    file,
                    (meta) => beginTaskUploadAction({ taskId, ...meta }),
                    (fileId) => completeTaskUploadAction({ fileId }),
                  );
                  input.value = "";
                  return result.ok ? { ok: true } : { ok: false, error: "failed", message: result.errorKey };
                });
              }}
            />
            {pending ? <span className="text-xs text-muted-foreground">{t("uploading")}</span> : null}
          </label>
        ) : null}
      </TableCard>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
    </section>
  );
}

type Named = { id: string; name: string };

/** Comments and the field-by-field history in one timeline (FR-WRK-09), oldest first; replies sit under their comment. */
export function TaskDiscussion({
  taskId,
  comments,
  activity,
  people,
  selfId,
  canModerate,
  draft,
}: {
  taskId: string;
  comments: DiscussionComment[];
  activity: DetailActivity[];
  people: Person[];
  selfId: string;
  canModerate: boolean;
  /** A comment the composer opens with: the assistant's proposal, being edited (Sửa). */ draft?: string;
}) {
  const t = useTranslations("work.discussion");
  const tTask = useTranslations("work.task");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "comments">("all");

  const describe = (entry: DetailActivity): string => {
    const name = (value: unknown) => (value && typeof value === "object" && "name" in value ? String((value as Named).name) : value === null || value === undefined ? "—" : String(value));
    if (entry.type === "field_changed" && entry.field) {
      const field = tTask.has(`fields.${entry.field}`) ? tTask(`fields.${entry.field}`) : entry.field;
      if (entry.field === "description" || entry.field === "links") return tTask("activity.changedPlain", { field });
      if (entry.field === "checklist") return tTask("activity.checklist", entry.toValue as { done: number; total: number });
      if (entry.field === "priority") return tTask("activity.changed", { field, from: entry.fromValue ? tWork(`priority.${entry.fromValue}`) : "—", to: entry.toValue ? tWork(`priority.${entry.toValue}`) : "—" });
      return tTask("activity.changed", { field, from: name(entry.fromValue), to: name(entry.toValue) });
    }
    if (entry.type === "custom_field_changed") {
      const [from, to] = [entry.fromValue, entry.toValue] as ({ name?: string; value?: string | null } | null)[];
      return tTask("activity.custom_field_changed", { field: to?.name ?? from?.name ?? "", from: from?.value ?? "—", to: to?.value ?? "—" });
    }
    if (entry.type === "moved") {
      const [from, to] = [entry.fromValue, entry.toValue] as ({ name?: string; team?: string } | null)[];
      return tTask("activity.moved", { from: from?.name ?? "", fromTeam: from?.team ?? "", to: to?.name ?? "", toTeam: to?.team ?? "" });
    }
    if (entry.type.startsWith("review_")) {
      const value = (entry.toValue ?? {}) as { version?: number; name?: string };
      return tTask(`activity.${entry.type}`, { version: value.version ?? 0, name: value.name ?? "" });
    }
    const subject = name(entry.toValue ?? entry.fromValue);
    return tTask.has(`activity.${entry.type}`) ? tTask(`activity.${entry.type}`, { name: subject }) : entry.type;
  };

  const timeline = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentId).map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment, replies: comments.filter((reply) => reply.parentId === comment.id) }));
    // A comment is in the timeline as itself; its "commented" history row would say it twice.
    const history = show === "all" ? activity.filter((entry) => entry.type !== "commented").map((entry) => ({ kind: "activity" as const, at: entry.createdAt, entry })) : [];
    return [...roots, ...history].sort((a, b) => a.at.localeCompare(b.at));
  }, [comments, activity, show]);

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  const actionClass = "press rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
  const renderComment = (comment: DiscussionComment, isReply: boolean) => (
    <ListItem key={comment.id} id={`comment-${comment.id}`} className={`items-start gap-3 py-3 ${isReply ? "pl-12 md:pl-12" : ""}`}>
      <PersonAvatar name={comment.byAutomation ? null : comment.authorName} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <RecordLink kind="person" id={comment.byAutomation ? null : comment.authorPersonId} className="font-medium">
            {comment.authorName}
          </RecordLink>
          {comment.byAutomation ? <Badge variant="outline">{t("byAutomation")}</Badge> : null}
          <time className="text-xs text-faint">{when(comment.createdAt)}</time>
          {comment.editedAt && !comment.deleted ? <span className="text-xs text-faint">{t("edited")}</span> : null}
        </div>
        {comment.deleted ? (
          <p className="text-sm text-muted-foreground italic">{t("deleted")}</p>
        ) : editing === comment.id ? (
          <Composer
            people={people}
            initial={comment.body}
            submitLabel={t("saveEdit")}
            pending={pending}
            placeholder={t("placeholder")}
            onCancel={() => setEditing(null)}
            onSubmit={(body) =>
              run(
                () => editCommentAction({ commentId: comment.id, body }),
                () => setEditing(null),
              )
            }
          />
        ) : (
          <Body body={comment.body} />
        )}
        {comment.deleted || editing === comment.id ? null : (
          <div className="-ml-1.5 flex flex-wrap items-center gap-0.5 text-xs">
            {REACTIONS.map((emoji) => {
              const who = comment.reactions[emoji] ?? [];
              const mine = who.includes(selfId);
              return who.length || replyTo === `react:${comment.id}` ? (
                <button
                  key={emoji}
                  type="button"
                  disabled={pending}
                  aria-pressed={mine}
                  onClick={() => run(() => reactToCommentAction({ commentId: comment.id, emoji }))}
                  className={`press inline-flex h-6 items-center gap-1 rounded-full border px-2 font-mono tabular-nums ${mine ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                >
                  {emoji} {who.length || ""}
                </button>
              ) : null;
            })}
            <button type="button" className={actionClass} aria-label={t("react")} onClick={() => setReplyTo(replyTo === `react:${comment.id}` ? null : `react:${comment.id}`)}>
              <SmilePlusIcon className="size-3.5" />
            </button>
            <button type="button" className={actionClass} onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>
              {t("reply")}
            </button>
            {comment.authorPersonId === selfId ? (
              <button type="button" className={actionClass} onClick={() => setEditing(comment.id)}>
                {t("edit")}
              </button>
            ) : null}
            {comment.authorPersonId === selfId || canModerate ? (
              <button type="button" disabled={pending} className={`${actionClass} hover:text-destructive`} onClick={() => run(() => deleteCommentAction({ commentId: comment.id }))}>
                {t("delete")}
              </button>
            ) : null}
          </div>
        )}
        {replyTo === comment.id ? (
          <Composer
            people={people}
            submitLabel={t("reply")}
            pending={pending}
            placeholder={t("replyPlaceholder")}
            onCancel={() => setReplyTo(null)}
            onSubmit={(body, reset) =>
              run(
                () => addCommentAction({ taskId, body, parentId: comment.id }),
                () => (reset(), setReplyTo(null)),
              )
            }
          />
        ) : null}
      </div>
    </ListItem>
  );

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-label">{t("title", { count: comments.filter((comment) => !comment.deleted).length })}</h2>
        <Segmented
          aria-label={t("title", { count: comments.length })}
          value={show}
          onChange={setShow}
          options={(["all", "comments"] as const).map((value) => ({ value, label: t(`show.${value}`) }))}
          className="[&>button]:h-7 md:[&>button]:h-6 [&>button]:text-xs"
        />
      </div>
      <TableCard>
        <List>
          {timeline.length === 0 ? <ListEmpty>—</ListEmpty> : null}
          {timeline.map((item) =>
            item.kind === "activity" ? (
              <ListItem key={item.entry.id} className="min-h-9 gap-3 py-1.5 text-xs md:min-h-9">
                <span className="flex size-6 shrink-0 items-center justify-center text-faint">
                  <HistoryIcon className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5">
                  <RecordLink kind="person" id={item.entry.actorName ? item.entry.actorPersonId : null} className="font-medium">
                    {item.entry.actorName ?? tTask("system")}
                  </RecordLink>
                  <span className="min-w-0 text-muted-foreground">{describe(item.entry)}</span>
                </span>
                <time className="shrink-0 font-mono text-[0.6875rem] text-faint tabular-nums">{when(item.entry.createdAt)}</time>
              </ListItem>
            ) : (
              [renderComment(item.comment, false), ...item.replies.map((reply) => renderComment(reply, true))]
            ),
          )}
        </List>
        <div className="border-t bg-canvas p-3">
          <Composer people={people} initial={draft} submitLabel={t("send")} pending={pending} placeholder={t("placeholder")} onSubmit={(body, reset) => run(() => addCommentAction({ taskId, body }), reset)} />
        </div>
      </TableCard>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
    </section>
  );
}
