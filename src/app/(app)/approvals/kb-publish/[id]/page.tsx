import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { decidePageReviewAction } from "@/modules/kb/actions";
import { getPublishReview } from "@/modules/kb/service";
import { DiffView } from "@/modules/kb/ui/diff-view";
import { PageDoc } from "@/modules/kb/ui/page-doc";
import { WithdrawReviewForm } from "@/modules/kb/ui/review-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { ApprovalChain, PropertySheet, RequestEvents, RequestHeader, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("pageReview");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KbPublishReviewPage(props: PageProps<"/approvals/kb-publish/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getPublishReview({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const [t, tApprovals, tRequests] = await Promise.all([getTranslations("kb"), getTranslations("approvals"), getTranslations("requests")]);
  const { request, payload } = view;
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");

  return (
    <Page width="narrow">
      <RequestHeader
        title={t("review.title")}
        kind={tApprovals("types.kb_publish")}
        status={request.status}
        requestId={request.id}
        who={
          <>
            <RecordLink kind="person" id={request.requesterPersonId}>
              {view.requesterName}
            </RecordLink>
            {view.spaceName ? (
              <>
                {" · "}
                <RecordLink kind="kbSpace" id={view.spaceKey}>
                  {view.spaceName}
                </RecordLink>
              </>
            ) : null}
            {payload.isMajor ? (
              <Badge variant="outline" className="ml-2">
                {t("fields.isMajor")}
              </Badge>
            ) : null}
          </>
        }
      />

      <Section title={tRequests("view.details")}>
        <PropertySheet
          rows={[
            {
              label: t("review.page"),
              value: (
                <RecordLink kind="kbPage" id={payload.pageId} className="text-link">
                  {view.submitted?.title ?? payload.title}
                </RecordLink>
              ),
            },
            { label: t("fields.changeNote"), value: payload.changeNote, long: true },
          ]}
        />
      </Section>

      {view.isRequester && request.status === "returned" ? (
        <Alert variant="warning">
          {t("review.returnedNote")}{" "}
          <Link href={`/kb/pages/${payload.pageId}/edit`} className="underline underline-offset-2">
            {t("page.edit")}
          </Link>
        </Alert>
      ) : null}

      {view.diff ? (
        <Section title={view.diff.fromVersionNo ? t("review.changesSince", { n: view.diff.fromVersionNo }) : t("review.newPage")}>
          {view.diff.lines.every((line) => line.type === "same") ? <p className="text-sm text-muted-foreground">{t("history.noChanges")}</p> : <DiffView lines={view.diff.lines} />}
        </Section>
      ) : null}

      {view.submitted ? (
        <Section title={t("review.submitted")}>
          <Card>
            <CardContent>
              <h3 className="mb-3 text-xl font-semibold tracking-tight">{view.submitted.title}</h3>
              <PageDoc doc={view.submitted.content} />
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <ApprovalChain view={view} />
      {view.canDecide ? <DecisionForm requestId={request.id} action={decidePageReviewAction} /> : null}
      {canWithdraw ? <WithdrawReviewForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestEvents view={view} />
    </Page>
  );
}
