import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { jobTitle } from "@/lib/job-levels";
import { decideLifecycleChangeAction } from "@/modules/core-hr/lifecycle-actions";
import { type AssignmentChangePayload, getLifecycleChange, placementNames, type TerminationPayload } from "@/modules/core-hr/lifecycle-approvals";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, PropertySheet, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("lifecycleChange");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A transfer, a promotion or a termination waiting for its approval (FR-CHR-09): what HR proposed,
// about whom and from when. The final approval carries it out; until then nothing has changed.
export default async function LifecycleChangePage(props: PageProps<"/approvals/lifecycle/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getLifecycleChange({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tPeople, tApprovals, tRequests, format] = await Promise.all([getTranslations("lifecycle"), getTranslations("people"), getTranslations("approvals"), getTranslations("requests"), getFormatter()]);
  const { request } = view;
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "long" });
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");
  const subject = request.subjectPersonId ? (
    <RecordLink kind="person" id={request.subjectPersonId}>
      {view.subjectName}
    </RecordLink>
  ) : null;

  let rows: { label: string; value: ReactNode; long?: boolean }[];
  if (view.kind === "termination") {
    const payload = view.payload as TerminationPayload;
    rows = [
      { label: t("change.person"), value: subject },
      { label: t("fields.lastDay"), value: date(payload.lastDay) },
      { label: t("fields.terminationReason"), value: t.has(`reasons.${payload.reason}`) ? t(`reasons.${payload.reason}` as "reasons.other") : payload.reason },
      { label: t("fields.note"), value: payload.note, long: true },
    ];
  } else {
    const payload = view.payload as AssignmentChangePayload;
    const names = await placementNames(payload.placement);
    rows = [
      { label: t("change.person"), value: subject },
      { label: tPeople("fields.validFrom"), value: date(payload.validFrom) },
      { label: tPeople("fields.workforceType"), value: tPeople(`workforceType.${payload.placement.workforceType}`) },
      { label: tPeople("fields.position"), value: payload.placement.positionName },
      { label: tPeople("fields.jobTitle"), value: jobTitle(tPeople, payload.placement) },
      { label: tPeople("fields.team"), value: names.unit },
      { label: tPeople("fields.managerId"), value: names.manager ? <RecordLink kind="person" id={payload.placement.managerId}>{names.manager}</RecordLink> : null },
      { label: tPeople("fields.branch"), value: names.branch },
      { label: tPeople("fields.changeReason"), value: payload.changeReason, long: true },
    ];
  }

  return (
    <Page width="narrow">
      <RequestHeader title={t(`change.title.${view.kind}`)} kind={tApprovals(`types.${request.type}` as "types.resignation")} status={request.status} requestId={request.id} who={<RecordLink kind="person" id={request.requesterPersonId}>{view.requesterName}</RecordLink>} />
      <Section title={tRequests("view.details")}>
        <PropertySheet rows={rows} />
      </Section>
      {request.status === "approved" ? <Alert variant="info">{t("change.appliedNote")}</Alert> : null}
      <ApprovalChain view={view} />
      {view.canDecide ? <DecisionForm requestId={request.id} action={decideLifecycleChangeAction} /> : null}
      {canWithdraw ? <WithdrawForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
