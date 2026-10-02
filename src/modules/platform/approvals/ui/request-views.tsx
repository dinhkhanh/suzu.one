// Server components shared by every request type: the inbox rows, a request's header, its
// approval chain and its history.
import { CheckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { statusTone } from "@/components/ui/tone";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { listPersonNames } from "../../people/service";
import type { RequestListRow, RequestView } from "../service";
import { ageOf } from "./age";
import { PersonName } from "./person-name";
import { CommentForm, DelegateForm } from "./request-tools";

export async function RequestStatusBadge({ status }: { status: string }) {
  const t = await getTranslations("approvals");
  return <Badge dot variant={statusTone(status)}>{t(`status.${status}` as "status.pending")}</Badge>;
}

/** `3f2a9c1b-…` → `#3F2A9C1B`: the short code a request is spoken of by. */
export const requestCode = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

/** How long a request has waited, in words: hours on the first day, days after. */
export async function RequestAge({ createdAt, decidedAt }: { createdAt: Date; decidedAt?: Date | null }) {
  const t = await getTranslations("approvals");
  const age = ageOf(createdAt, decidedAt ?? new Date());
  const open = !decidedAt;
  return <span className={cn("font-mono text-[0.8125rem] tabular-nums", open && age.stale ? "text-warning" : "text-muted-foreground")}>{age.days >= 1 ? t("age.days", { days: age.days }) : t("age.hours", { hours: age.hours })}</span>;
}

const OPEN = new Set(["pending", "returned"]);

/**
 * The top of a request's page: its kind and short code over the title, the status beside it, and
 * who it is from. `actions` are the page's keys (open the PDF, print, amend).
 */
export async function RequestHeader({ title, status, requestId, kind, who, description, actions, children }: { title: ReactNode; status: string; requestId: string; /** The type's name, when the title is not it. */ kind?: ReactNode; /** Who filed it, and for whom. */ who?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <PageHeader
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          {kind ? <Badge variant="secondary">{kind}</Badge> : null}
          <span className="font-mono text-xs text-faint tabular-nums">{requestCode(requestId)}</span>
          <RequestStatusBadge status={status} />
        </span>
      }
      title={title}
      description={description ?? who}
      actions={actions}
    >
      {description && who ? <p className="text-sm text-muted-foreground">{who}</p> : null}
      {children}
    </PageHeader>
  );
}

/** The property sheet of a request: a label and a value per row, no gutter, no header. */
export function PropertySheet({ rows }: { rows: { label: ReactNode; value: ReactNode; /** A figure: mono, a touch larger. */ money?: boolean; /** Spans and wraps: a reason, a note. */ long?: boolean }[] }) {
  return (
    <Table numbered={false}>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index} className="hover:bg-transparent">
            <TableCell className="w-44 align-top text-xs text-muted-foreground md:w-56 md:text-sm">{row.label}</TableCell>
            <TableCell className={cn(row.long && "whitespace-normal", row.money && "font-mono text-[0.9375rem] font-medium tabular-nums")}>{row.value ?? <span className="text-faint">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type Row = RequestListRow & { waitingOn?: string | null };

/**
 * The reference grid of requests: kind, title, who, where it stands, how long it has waited. Open
 * rows first; the decided ones under a band. On a phone the same rows are a list.
 */
export async function RequestTable({ rows, empty, showRequester, labels, showWaitingOn = false }: { rows: Row[]; empty: string; showRequester: boolean; /** Names of the request builder's types, which the message bundle does not know. */ labels?: ReadonlyMap<string, string>; /** Whose answer each open request is waiting for — the oversight list. */ showWaitingOn?: boolean }) {
  const t = await getTranslations("approvals");
  // No message, no empty state: the caller hides the list when there is nothing to show.
  if (rows.length === 0 && !empty) return null;
  const label = (type: string) => labels?.get(type) ?? (t.has(`types.${type}` as "types.profile_change") ? t(`types.${type}` as "types.profile_change") : type);
  const open = rows.filter((row) => OPEN.has(row.status));
  const resolved = rows.filter((row) => !OPEN.has(row.status));

  const cells = (row: Row) => (
    <>
      <TableCell>
        <Badge variant="secondary">{label(row.type)}</Badge>
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal">
        <Link href={row.link ?? "/approvals"} className="font-medium hover:underline">
          {row.summary || label(row.type)}
        </Link>
      </TableCell>
      {showRequester ? (
        <TableCell>
          <PersonName name={row.requesterName} personId={row.requesterPersonId} />
        </TableCell>
      ) : null}
      <TableCell>
        <RequestStatusBadge status={row.status} />
      </TableCell>
      {showWaitingOn ? <TableCell className="text-muted-foreground">{row.waitingOn ?? "—"}</TableCell> : null}
      <TableCell kind="time">
        <RequestAge createdAt={row.createdAt} decidedAt={row.decidedAt} />
      </TableCell>
    </>
  );

  return (
    <>
      <Table containerClassName="hidden md:block">
        <TableHeader>
          <TableRow>
            <TableHead kind="select">{t("columns.type")}</TableHead>
            <TableHead kind="text">{t("columns.request")}</TableHead>
            {showRequester ? <TableHead kind="person">{t("columns.requester")}</TableHead> : null}
            <TableHead kind="status">{t("columns.step")}</TableHead>
            {showWaitingOn ? <TableHead kind="person">{t("columns.waitingOn")}</TableHead> : null}
            <TableHead kind="time">{t("columns.age")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{empty}</TableEmpty> : null}
          {open.map((row) => (
            <TableRow key={row.id}>{cells(row)}</TableRow>
          ))}
          {resolved.length > 0 ? <TableGroupRow>{t("resolved", { count: resolved.length })}</TableGroupRow> : null}
          {resolved.map((row) => (
            <TableRow key={row.id} className="text-muted-foreground">
              {cells(row)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <List className="md:hidden">
        {rows.length === 0 ? <ListEmpty>{empty}</ListEmpty> : null}
        {[...open, ...resolved].map((row, index) => (
          <ListItem key={row.id} href={row.link ?? "/approvals"} className="rise" style={{ "--i": index } as CSSProperties}>
            <RequestListRowBody row={row} label={label(row.type)} showRequester={showRequester} />
          </ListItem>
        ))}
      </List>
    </>
  );
}

/** One request as a row of the phone's list: the kind and age over the title, the status under it. */
export async function RequestListRowBody({ row, label, showRequester }: { row: Row; label: string; showRequester: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <Badge variant="secondary">{label}</Badge>
        <RequestAge createdAt={row.createdAt} decidedAt={row.decidedAt} />
      </span>
      <span className="line-clamp-2 text-sm font-medium">{row.summary || label}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {showRequester ? <span className="truncate">{row.requesterName}</span> : null}
        <RequestStatusBadge status={row.status} />
      </span>
    </span>
  );
}

const STEP_STATE = (status: string): "done" | "current" | "next" | "off" => {
  if (status === "approved") return "done";
  if (status === "pending") return "current";
  if (status === "rejected" || status === "returned") return "off";
  return "next";
};

/**
 * Who was asked and what they answered, as the vertical chain of steps: a filled disc with a tick
 * for a step that is done, the accent disc for the one it is on, an outline for the ones to come.
 */
export async function ApprovalChain({ view }: { view: RequestView }) {
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  const steps = view.steps.filter((step) => step.status !== "skipped");
  // A finished request has no "current" step; its last step is what it ended on.
  const live = view.request.status === "pending";
  return (
    <Section title={t("history.chain")} count={steps.length}>
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const state = live || step.status !== "pending" ? STEP_STATE(step.status) : "next";
          const last = index === steps.length - 1;
          return (
            <li key={step.key} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold",
                    state === "done" && "border-success bg-success text-white",
                    state === "current" && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15",
                    state === "next" && "border-border bg-background text-faint",
                    state === "off" && "border-destructive/40 bg-destructive/10 text-destructive"
                  )}
                >
                  {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                {last ? null : <span aria-hidden className={cn("w-px flex-1", state === "done" ? "bg-success/40" : "bg-border")} />}
              </span>
              <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5 pb-5", last && "pb-0")}>
                <p className={cn("text-sm font-medium", state === "next" && "text-muted-foreground")}>
                  {t("history.stepTitle", { number: index + 1 })}
                  <span className="font-normal text-muted-foreground"> · {t("history.mode", { mode: step.mode })}</span>
                  {step.parallel ? <span className="font-normal text-muted-foreground"> {t("history.parallel")}</span> : null}
                </p>
                {step.assignees.map((assignee) => (
                  <p key={assignee.personId} className="text-xs text-faint">
                    <RecordLink kind="person" id={assignee.personId}>
                      {assignee.name}
                    </RecordLink>
                    {assignee.delegatedFromName ? ` ${t("history.standingInFor", { name: assignee.delegatedFromName })}` : ""}
                    {" · "}
                    {t(`assignee.${assignee.status}` as "assignee.pending")}
                    {assignee.decidedAt ? ` · ${format.dateTime(assignee.decidedAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    {assignee.comment ? <span className="text-muted-foreground"> — “{assignee.comment}”</span> : null}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** Everything that happened, oldest first. */
export async function RequestEvents({ view }: { view: RequestView }) {
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  return (
    <Section title={t("history.title")} count={view.events.length}>
      <List>
        {view.events.map((event) => (
          <ListItem key={event.id} className="flex-wrap gap-x-2 gap-y-0.5">
            <span className="font-medium">{t(`events.${event.type}` as "events.submitted")}</span>
            <span className="text-muted-foreground">
              {event.actorName ? (
                <RecordLink kind="person" id={event.actorPersonId}>
                  {event.actorName}
                </RecordLink>
              ) : (
                "—"
              )}{" "}
              · <span className="font-mono text-xs tabular-nums">{format.dateTime(event.at, { dateStyle: "medium", timeStyle: "short" })}</span>
            </span>
            {typeof event.meta?.toName === "string" ? (
              <span className="text-muted-foreground">
                →{" "}
                <RecordLink kind="person" id={typeof event.meta.toPersonId === "string" ? event.meta.toPersonId : null}>
                  {event.meta.toName}
                </RecordLink>
              </span>
            ) : null}
            {event.meta?.verifiedSecondChannel ? <Badge variant="outline">{t("history.verified")}</Badge> : null}
            {event.comment ? <p className="w-full text-muted-foreground">“{event.comment}”</p> : null}
          </ListItem>
        ))}
      </List>
    </Section>
  );
}

/** The chain and the history together — what every request page shows at its foot. */
export async function RequestHistory({ view }: { view: RequestView }) {
  return (
    <>
      <ApprovalChain view={view} />
      <RequestEvents view={view} />
    </>
  );
}

/** A remark for anyone party to the request; handing the turn on for whoever's turn it is. */
export async function RequestTools({ view, viewerPersonId }: { view: RequestView; viewerPersonId: string }) {
  const open = view.request.status === "pending" || view.request.status === "returned";
  const isParty = view.isRequester || view.steps.some((step) => step.assignees.some((assignee) => assignee.personId === viewerPersonId));
  if (!open || !isParty) return null;
  const onStep = new Set(view.steps.flatMap((step) => step.assignees.map((assignee) => assignee.personId)));
  const people = view.canDecide ? (await listPersonNames()).filter((person) => person.id !== viewerPersonId && person.id !== view.request.requesterPersonId && !onStep.has(person.id)) : [];
  return (
    <TableCard>
      <List>
        <ListItem className="py-3">
          <CommentForm requestId={view.request.id} />
        </ListItem>
        {view.canDecide ? (
          <ListItem className="py-3">
            <DelegateForm requestId={view.request.id} people={people} />
          </ListItem>
        ) : null}
      </List>
    </TableCard>
  );
}
