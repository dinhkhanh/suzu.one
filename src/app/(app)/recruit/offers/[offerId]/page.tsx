import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { getOfferView } from "@/modules/recruit/offers";
import { ConvertToEmployee, OfferDecision, OfferMoves, OfferResponse } from "@/modules/recruit/ui/offer-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("offer");

/**
 * One offer.
 *
 * The figure is behind two gates, not one. `getOfferView` gives `money: null` to anybody without a
 * compensation-tier recruitment grant — so a recruiter's page simply has no row to render — and
 * the reader who *does* hold it is shown the amount only if they proved who they are in the last
 * few minutes (FR-PLT-06), exactly as the payslip route requires. Everything else on the page —
 * the job, the dates, the approval, the buttons — works without the step-up, because a recruiter
 * who has to record an acceptance should not have to re-authenticate to do it.
 */
export default async function OfferPage({ params }: PageProps<"/recruit/offers/[offerId]">) {
  const { offerId } = await params;
  const user = await requireUser();
  const view = await getOfferView({ principal: user.principal, personId: user.person.id }, offerId);
  if (!view) notFound();

  const t = await getTranslations("recruit.offer");
  const tApprovals = await getTranslations("approvals");
  const format = await getFormatter();
  const fresh = isStepUpFresh(user.reauthAt);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{view.candidateName}</h1>
          <p className="text-sm text-muted-foreground">
            {view.offer.positionName} ·{" "}
            <Link href={`/recruit/applications/${view.offer.applicationId}`} className="underline underline-offset-4">
              {view.openingTitle}
            </Link>{" "}
            · {view.offer.number}
          </p>
        </div>
        <Badge dot variant={statusTone(view.status)}>{t(`statuses.${view.status}`)}</Badge>
      </header>

      <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("startDate")}</dt>
          <dd>{day(view.offer.startDate)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("expiresOn")}</dt>
          <dd>{day(view.offer.expiresOn)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("employmentType")}</dt>
          <dd>{view.offer.employmentType}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("probationMonths")}</dt>
          <dd>{view.offer.probationMonths}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("department")}</dt>
          <dd>{view.departmentName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("manager")}</dt>
          <dd>{view.managerName ?? "—"}</dd>
        </div>
      </dl>

      {/* The money. Two gates: the tier (already applied in the service) and a fresh proof of
          identity. Neither is a footnote — the page says which one is missing. */}
      {view.money ? (
        fresh ? (
          <dl className="grid gap-2 rounded-xl border border-dashed p-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("baseSalary")}</dt>
              <dd className="font-mono">{format.number(view.money.baseSalaryVnd)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("allowances")}</dt>
              <dd className="font-mono">{format.number(view.money.allowancesVnd)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("total")}</dt>
              <dd className="font-mono font-medium">{format.number(view.money.totalVnd)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("probationPay")}</dt>
              <dd className="font-mono">{format.number(view.money.probationMonthlyVnd)}</dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <Link href={`/step-up?next=${encodeURIComponent(`/recruit/offers/${offerId}`)}`} className="underline underline-offset-4">
              {t("stepUp")}
            </Link>
          </p>
        )
      ) : null}

      {view.offer.letterTemplateId ? (
        <section className="flex flex-col gap-1 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("letter")}</h2>
          <a href={`/recruit/offers/${offerId}/letter`} className="text-sm underline underline-offset-4">
            {t("downloadLetter")}
          </a>
          <p className="text-xs text-muted-foreground">{t("letterNote")}</p>
        </section>
      ) : null}

      {view.approval ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t("approval")}</h2>
            <Link href={`/approvals/request/${view.offer.approvalRequestId}`} className="text-xs underline underline-offset-4">
              {tApprovals("open")}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{tApprovals(`status.${view.approval.request.status}` as "status.pending")}</p>
          {/* It is this reader's turn: the decision is taken here, beside the offer it is about. */}
          {view.approval.canDecide ? <OfferDecision requestId={view.offer.approvalRequestId!} /> : null}
        </section>
      ) : null}

      <OfferMoves offerId={offerId} canSubmit={view.canSubmit} canSend={view.canSend} canWithdraw={view.canWithdraw} />

      {view.canEdit ? (
        <Link href={`/recruit/offers/${offerId}/edit`} className="text-sm underline underline-offset-4">
          {t("edit")}
        </Link>
      ) : null}

      {view.status === "sent" && view.canRespond ? <OfferResponse offerId={offerId} /> : null}

      {view.canConvert ? <ConvertToEmployee offerId={offerId} /> : null}

      {view.hiredPersonId ? (
        <p className="text-sm">
          <Link href={`/people/${view.hiredPersonId}`} className="underline underline-offset-4">
            {t("openPerson")}
          </Link>
        </p>
      ) : null}

      {view.offer.declineReason ? <p className="text-sm text-muted-foreground">{t("declinedBecause", { reason: view.offer.declineReason })}</p> : null}
    </div>
  );
}
