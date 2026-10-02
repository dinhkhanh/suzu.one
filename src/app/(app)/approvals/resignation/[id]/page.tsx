import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { decideResignationAction } from "@/modules/core-hr/lifecycle-actions";
import { getResignation } from "@/modules/core-hr/resignation";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, PropertySheet, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("resignation");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResignationPage(props: PageProps<"/approvals/resignation/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getResignation({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tApprovals, tRequests, format] = await Promise.all([getTranslations("lifecycle"), getTranslations("approvals"), getTranslations("requests"), getFormatter()]);
  const { request, payload } = view;
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");

  return (
    <Page width="narrow">
      <RequestHeader title={t("resign.detailTitle")} kind={tApprovals("types.resignation")} status={request.status} requestId={request.id} who={<RecordLink kind="person" id={request.requesterPersonId}>{view.requesterName}</RecordLink>} />
      <Section title={tRequests("view.details")}>
        <PropertySheet
          rows={[
            { label: t("fields.lastDay"), value: format.dateTime(new Date(`${payload.lastWorkingDay}T00:00:00`), { dateStyle: "long" }) },
            { label: t("fields.reason"), value: payload.reason, long: true },
          ]}
        />
      </Section>
      {request.status === "approved" ? <Alert variant="info">{t("resign.approvedNote")}</Alert> : null}
      <ApprovalChain view={view} />
      {view.canDecide ? <DecisionForm requestId={request.id} action={decideResignationAction} /> : null}
      {canWithdraw ? <WithdrawForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
