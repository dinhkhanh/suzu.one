import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { listFileNames } from "@/modules/platform/files/service";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { decideChangeAction } from "@/modules/projects/commercial-actions";
import { canManageChanges, CHANGE_REQUESTERS, changeEditable, type ChangeLedger, type ChangeStatus, type ChangeView, getChangeLedger, getChangeRequest, listChanges, listStructure, openChangesForApprover, openProject } from "@/modules/projects/service";
import { ChangeButtons, ChangeForm, EvidenceLink } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("changeRequests");


/**
 * Change requests (FR-PJM-11): original + changes = current for hours, fee and due date; each
 * change with its impact, the client's evidence and where it stands in approval. An approver who
 * may not open the project (the commercial step's finance approver) sees the changes they are
 * asked about and nothing else. Fees only for `pjm:commercial`.
 */
export default async function ProjectChangesPage({ params }: PageProps<"/projects/[projectId]/changes">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  const [t, tWork, format] = await Promise.all([getTranslations("projects.changes"), getTranslations("work"), getFormatter()]);
  const money = (value: number | null | undefined, signed = false) => (value === null || value === undefined ? "—" : `${signed && value > 0 ? "+" : ""}${format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 })}`);
  const hours = (minutes: number | null | undefined, signed = false) => (minutes === null || minutes === undefined ? "—" : `${signed && minutes > 0 ? "+" : ""}${format.number(minutes / 60, { maximumFractionDigits: 1 })} h`);
  const date = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");

  const impactOf = (change: ChangeView, seesFees: boolean) => (
    <ul className="flex flex-col gap-0.5 text-sm">
      {(change.impact.deliverables ?? []).map((line, index) => (
        <li key={`add-${index}`}>
          + {line.quantity} × {line.title}
          {line.format ? <span className="text-xs text-muted-foreground"> · {tWork(`formats.${line.format as "post"}`)}</span> : null}
        </li>
      ))}
      {change.cancelTitles.map((title, index) => (
        <li key={`cancel-${index}`} className="text-muted-foreground line-through">
          {title}
        </li>
      ))}
      {change.impact.minutesDelta ? <li>{t("impact.hours", { hours: hours(change.impact.minutesDelta, true) })}</li> : null}
      {seesFees && change.impact.feeDeltaVnd ? <li>{t("impact.fee", { fee: money(change.impact.feeDeltaVnd, true) })}</li> : null}
      {change.impact.dueDateTo ? <li>{t("impact.dueDate", { date: date(change.impact.dueDateTo) })}</li> : null}
    </ul>
  );

  if (!context) {
    const approver = await openChangesForApprover({ personId: user.person.id, principal: user.principal }, projectId);
    if (!approver) notFound();
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2">
            {approver.jobNumber ? <span className="font-mono text-base text-muted-foreground">{approver.jobNumber}</span> : null}
            {approver.projectName}
          </h1>
          <p className="text-sm text-muted-foreground">{t("approverOnly")}</p>
        </header>
        <List>
          {approver.changes.map((change) => (
            <ListItem key={change.id} className="flex-col items-stretch gap-3 py-4">
              <h2 className="text-base font-medium">
                CR-{change.number} · {change.title}
              </h2>
              <RichText text={change.description} className="text-sm" />
              {impactOf(change, approver.seesFees)}
              {change.request.canDecide ? <DecisionForm requestId={change.request.request.id} action={decideChangeAction} /> : null}
              <RequestTools view={change.request} viewerPersonId={user.person.id} />
              <RequestHistory view={change.request} />
            </ListItem>
          ))}
        </List>
      </div>
    );
  }

  const { project, can, viewer, facts } = context;
  const [changes, ledger, structure] = await Promise.all([listChanges(project.id, can.seeFees), getChangeLedger(project.id, can.seeFees), listStructure(project.id)]);
  const requests = await Promise.all(changes.map((change) => getChangeRequest({ personId: user.person.id, principal: user.principal }, change)));
  const fileNames = await listFileNames(changes.flatMap((change) => (change.evidenceFileId ? [change.evidenceFileId] : [])));
  const manage = canManageChanges(viewer, facts);
  const register = structure.deliverables.filter((line) => !line.cancelledAt && !line.retainerPeriodId).map((line) => ({ id: line.id, title: line.title, quantity: line.quantity }));

  const figures = (key: string, label: string, values: ChangeLedger["original"]) => (
    <TableRow key={key}>
      <TableCell className="whitespace-normal">{label}</TableCell>
      <TableCell kind="time">{hours(values.budgetMinutes)}</TableCell>
      {can.seeFees ? <TableCell kind="money">{money(values.feeVnd)}</TableCell> : null}
      <TableCell className="text-right">{date(values.dueDate)}</TableCell>
    </TableRow>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="changes" />

      <TableCard>
        <TableCardHeader title={t("ledger")} />
        <Table numbered={false} className="min-w-[28rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="text" />
              <TableHead kind="time">{t("budget")}</TableHead>
              {can.seeFees ? <TableHead kind="money">{t("fee")}</TableHead> : null}
              <TableHead kind="date" className="text-right">{t("dueDate")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {figures("original", t("original"), ledger.original)}
            {ledger.steps.map((step) => figures(`cr-${step.number}`, `+ CR-${step.number} · ${step.title}`, step.after))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>{t("current")}</TableCell>
              <TableCell kind="time">{hours(ledger.current.budgetMinutes)}</TableCell>
              {can.seeFees ? <TableCell kind="money">{money(ledger.current.feeVnd)}</TableCell> : null}
              <TableCell className="text-right">{date(ledger.current.dueDate)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("list")} count={changes.length || null} />
        <List>
          {changes.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {changes.map((change, index) => {
            const request = requests[index];
            const status = change.status as ChangeStatus;
            const mine = change.createdByPersonId === user.person.id;
            return (
              <ListItem key={change.id} className="flex-col items-stretch gap-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">CR-{change.number}</span>
                  <h3 className="font-medium">{change.title}</h3>
                  <Badge dot variant={statusTone(status)}>{t(`status.${status}`)}</Badge>
                  <Badge variant="outline">{t(`requesters.${change.requestedBy as "client"}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{[change.authorName, format.dateTime(change.createdAt, { dateStyle: "medium" }), change.appliedAt ? t("appliedOn", { date: format.dateTime(change.appliedAt, { dateStyle: "medium" }) }) : null].filter(Boolean).join(" · ")}</p>
                <RichText text={change.description} className="text-sm" />
                {impactOf(change, can.seeFees)}
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("evidence")}:</span>
                  {change.evidenceFileId ? <EvidenceLink projectId={project.id} fileId={change.evidenceFileId} fileName={fileNames.get(change.evidenceFileId) ?? t("evidenceFile")} /> : null}
                  {change.evidenceUrl ? (
                    <a href={change.evidenceUrl} target="_blank" rel="noreferrer" className="underline">
                      {t("evidenceLink")}
                    </a>
                  ) : null}
                  {!change.evidenceFileId && !change.evidenceUrl ? <span>—</span> : null}
                </p>
                {manage ? <ChangeButtons changeId={change.id} canSubmit={changeEditable(status)} canWithdraw={mine && (status === "submitted" || status === "draft")} resubmit={!!change.approvalRequestId} /> : null}
                {request?.canDecide ? <DecisionForm requestId={request.request.id} action={decideChangeAction} /> : null}
                {request ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">{t("approval")}</summary>
                    <div className="flex flex-col gap-2 pt-2">
                      <RequestTools view={request} viewerPersonId={user.person.id} />
                      <RequestHistory view={request} />
                    </div>
                  </details>
                ) : null}
                {manage && changeEditable(status) ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">{t("editDraft")}</summary>
                    <div className="pt-2">
                      <ChangeForm
                        projectId={project.id}
                        register={register}
                        requesters={CHANGE_REQUESTERS}
                        editFee={can.editFees}
                        change={{ id: change.id, title: change.title, description: change.description, requestedBy: change.requestedBy, lines: change.impact.deliverables ?? [], cancelIds: change.impact.cancelDeliverableIds ?? [], minutesDelta: change.impact.minutesDelta ?? null, ...(can.seeFees ? { feeDeltaVnd: change.impact.feeDeltaVnd ?? null } : {}), dueDateTo: change.impact.dueDateTo ?? null, evidenceUrl: change.evidenceUrl, evidence: change.evidenceFileId ? { fileId: change.evidenceFileId, fileName: fileNames.get(change.evidenceFileId) ?? t("evidenceFile") } : null }}
                      />
                    </div>
                  </details>
                ) : null}
              </ListItem>
            );
          })}
        </List>
        {manage ? (
          <TableAddRow label={t("new")} open={changes.length === 0}>
            <ChangeForm projectId={project.id} register={register} requesters={CHANGE_REQUESTERS} editFee={can.editFees} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
