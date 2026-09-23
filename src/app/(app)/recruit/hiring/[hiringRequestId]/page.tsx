import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { getHiringRequestView } from "@/modules/recruit/hiring";
import { canOpenFromHiringRequest } from "@/modules/recruit/service";
import { HiringDecisionForm } from "@/modules/recruit/ui/hiring-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("hiringRequest");

// The ask and its approval trail. The budget row is only drawn for a compensation-tier grant, and
// the "create an opening" button only once the ask has actually cleared its flow.
export default async function HiringRequestPage({ params }: PageProps<"/recruit/hiring/[hiringRequestId]">) {
  const { hiringRequestId } = await params;
  const user = await requireUser();
  const view = await getHiringRequestView({ principal: user.principal, personId: user.person.id }, hiringRequestId);
  if (!view) notFound();

  const t = await getTranslations("recruit");
  const tApprovals = await getTranslations("approvals");
  const format = await getFormatter();
  const { hiringRequest } = view;
  const canOpen = hiringRequest.status === "approved" && !hiringRequest.openingId && canOpenFromHiringRequest(user.principal, { entityId: hiringRequest.entityId, departmentId: hiringRequest.departmentId, teamId: hiringRequest.teamId });
  const myTurn = view.approval?.canDecide ?? false;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            {hiringRequest.positionTitle} × {hiringRequest.headcount}
          </h1>
          <p className="text-sm text-muted-foreground">{[view.entityName, view.departmentName, view.requesterName].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge variant={hiringRequest.status === "pending" ? "secondary" : "outline"}>{t(`hiringStatus.${hiringRequest.status}`)}</Badge>
      </header>

      <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("form.employmentType")}</dt>
          <dd>{t(`employmentType.${hiringRequest.employmentType}`)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("form.hiringManager")}</dt>
          <dd>{view.hiringManagerName ?? "—"}</dd>
        </div>
        {hiringRequest.targetStartDate ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("form.targetStartDate")}</dt>
            <dd>{hiringRequest.targetStartDate}</dd>
          </div>
        ) : null}
        {view.budget ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("columns.budget")}</dt>
            <dd>
              {[view.budget.minVnd, view.budget.maxVnd]
                .filter((value): value is number => value !== null)
                .map((value) => format.number(value))
                .join(" – ") || "—"}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <dt className="text-muted-foreground">{t("columns.reason")}</dt>
          <dd className="whitespace-pre-line">{hiringRequest.reason}</dd>
        </div>
      </dl>

      {myTurn ? <HiringDecisionForm requestId={view.approval!.request.id} /> : null}

      {canOpen ? (
        <Link href={`/recruit/openings/new?from=${hiringRequestId}`} className={buttonVariants({ size: "sm" })}>
          {t("actions.createOpening")}
        </Link>
      ) : null}
      {hiringRequest.openingId ? (
        <Link href={`/recruit/${hiringRequest.openingId}`} className="text-sm underline underline-offset-4">
          {t("actions.openOpening")}
        </Link>
      ) : null}

      {view.approval ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("history")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {view.approval.events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1 basis-56">
                  {tApprovals(`event.${event.type}` as "event.submitted")}
                  {event.comment ? <span className="block text-xs text-muted-foreground">{event.comment}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">{event.actorName ?? ""}</span>
                <span className="text-xs text-muted-foreground">{format.dateTime(event.at, { dateStyle: "medium", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
