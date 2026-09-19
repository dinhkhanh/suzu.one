import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideResignationAction } from "@/modules/core-hr/lifecycle-actions";
import { getResignation } from "@/modules/core-hr/resignation";
import { DecisionForm, WithdrawForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Resignation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResignationPage(props: PageProps<"/approvals/resignation/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getResignation({ personId: user.person.id, principal: user.principal }, id) : null;
  if (!view) notFound();

  const t = await getTranslations("lifecycle");
  const format = await getFormatter();
  const { request, payload } = view;
  const canWithdraw = view.isRequester && (request.status === "pending" || request.status === "returned");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("resign.detailTitle")}</h1>
          <RequestStatusBadge status={request.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {view.isRequester ? view.requesterName : <Link href={`/people/${request.requesterPersonId}`} className="hover:underline">{view.requesterName}</Link>}
        </p>
      </header>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.lastDay")}</dt>
          <dd className="text-sm">{format.dateTime(new Date(`${payload.lastWorkingDay}T00:00:00`), { dateStyle: "long" })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.reason")}</dt>
          <dd className="text-sm">{payload.reason ?? "—"}</dd>
        </div>
      </dl>
      {request.status === "approved" ? <p className="text-sm text-muted-foreground">{t("resign.approvedNote")}</p> : null}
      {view.canDecide ? <DecisionForm requestId={request.id} action={decideResignationAction} /> : null}
      {canWithdraw ? <WithdrawForm requestId={request.id} /> : null}
      <RequestHistory view={view} />
    </div>
  );
}
