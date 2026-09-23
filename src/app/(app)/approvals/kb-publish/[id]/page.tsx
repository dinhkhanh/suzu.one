import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { decidePageReviewAction } from "@/modules/kb/actions";
import { getPublishReview } from "@/modules/kb/service";
import { DiffView } from "@/modules/kb/ui/diff-view";
import { RenderDoc } from "@/modules/kb/ui/render-doc";
import { WithdrawReviewForm } from "@/modules/kb/ui/review-forms";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("pageReview");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KbPublishReviewPage(props: PageProps<"/approvals/kb-publish/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getPublishReview({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const t = await getTranslations("kb");
  const { request, payload } = view;
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{t("review.title")}</h1>
          <RequestStatusBadge status={request.status} />
          {payload.isMajor ? <Badge variant="outline">{t("fields.isMajor")}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {view.requesterName}
          {view.spaceName ? ` · ${view.spaceName}` : ""}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("review.page")}</dt>
          <dd className="text-sm">
            <Link href={`/kb/pages/${payload.pageId}`} className="hover:underline">
              {view.submitted?.title ?? payload.title}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.changeNote")}</dt>
          <dd className="text-sm">{payload.changeNote ?? "—"}</dd>
        </div>
      </dl>

      {view.isRequester && request.status === "returned" ? (
        <p className="rounded-md border p-3 text-sm">
          {t("review.returnedNote")}{" "}
          <Link href={`/kb/pages/${payload.pageId}/edit`} className="underline underline-offset-2">
            {t("page.edit")}
          </Link>
        </p>
      ) : null}

      {view.diff ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{view.diff.fromVersionNo ? t("review.changesSince", { n: view.diff.fromVersionNo }) : t("review.newPage")}</h2>
          {view.diff.lines.every((line) => line.type === "same") ? <p className="text-sm text-muted-foreground">{t("history.noChanges")}</p> : <DiffView lines={view.diff.lines} />}
        </section>
      ) : null}

      {view.submitted ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("review.submitted")}</h2>
          <div className="rounded-md border p-4">
            <h3 className="mb-3 text-xl font-semibold tracking-tight">{view.submitted.title}</h3>
            <RenderDoc doc={view.submitted.content} />
          </div>
        </section>
      ) : null}

      {view.canDecide ? <DecisionForm requestId={request.id} action={decidePageReviewAction} /> : null}
      {canWithdraw ? <WithdrawReviewForm requestId={request.id} /> : null}
      <RequestTools view={view} viewerPersonId={user.person.id} />
      <RequestHistory view={view} />
    </div>
  );
}
