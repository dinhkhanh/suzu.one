// Server components shared by every request type: the list rows of an inbox and a request's history.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPersonNames } from "../../people/service";
import type { RequestListRow, RequestView } from "../service";
import { CommentForm, DelegateForm } from "./request-tools";

export async function RequestStatusBadge({ status }: { status: string }) {
  const t = await getTranslations("approvals");
  return <Badge variant={status === "pending" ? "secondary" : "outline"}>{t(`status.${status}` as "status.pending")}</Badge>;
}

export async function RequestTable({ rows, empty, showRequester }: { rows: RequestListRow[]; empty: string; showRequester: boolean }) {
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.request")}</TableHead>
          {showRequester ? <TableHead>{t("columns.requester")}</TableHead> : null}
          <TableHead>{t("columns.submitted")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={row.link ?? "/approvals"} className="font-medium hover:underline">
                {t.has(`types.${row.type}` as "types.profile_change") ? t(`types.${row.type}` as "types.profile_change") : row.type}
              </Link>
              <p className="text-xs text-muted-foreground">{row.summary}</p>
            </TableCell>
            {showRequester ? <TableCell>{row.requesterName}</TableCell> : null}
            <TableCell className="whitespace-nowrap">{format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
            <TableCell>
              <RequestStatusBadge status={row.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Who was asked, what they answered, and everything that happened, oldest first. */
export async function RequestHistory({ view }: { view: RequestView }) {
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("history.title")}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {view.steps
          .filter((step) => step.status !== "skipped")
          .map((step, index) => (
            <li key={step.key}>
              <span className="text-muted-foreground">
                {t("history.step", { number: index + 1, mode: step.mode })}
                {step.parallel ? ` ${t("history.parallel")}` : ""}
              </span>{" "}
              {step.assignees
                .map((assignee) => `${assignee.name}${assignee.delegatedFromName ? ` ${t("history.standingInFor", { name: assignee.delegatedFromName })}` : ""} (${t(`assignee.${assignee.status}` as "assignee.pending")})`)
                .join(", ")}
            </li>
          ))}
      </ul>
      <ol className="flex flex-col gap-2 border-l pl-4 text-sm">
        {view.events.map((event) => (
          <li key={event.id}>
            <span className="font-medium">{t(`events.${event.type}` as "events.submitted")}</span>
            <span className="text-muted-foreground">
              {" "}
              · {event.actorName ?? "—"} · {format.dateTime(event.at, { dateStyle: "medium", timeStyle: "short" })}
            </span>
            {typeof event.meta?.toName === "string" ? <span className="text-muted-foreground"> → {event.meta.toName}</span> : null}
            {event.meta?.verifiedSecondChannel ? <Badge variant="outline" className="ml-2">{t("history.verified")}</Badge> : null}
            {event.comment ? <p className="text-muted-foreground">“{event.comment}”</p> : null}
          </li>
        ))}
      </ol>
    </section>
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
    <section className="flex flex-col gap-3">
      <CommentForm requestId={view.request.id} />
      {view.canDecide ? <DelegateForm requestId={view.request.id} people={people} /> : null}
    </section>
  );
}
