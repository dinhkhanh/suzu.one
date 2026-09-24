import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { listMyParticipations, listPeerInvitations, listReviewsIOwe } from "@/modules/performance/service";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { FormStatusBadge, ratingText, StageBadge } from "@/modules/performance/ui/review";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviews");

// My reviews (FR-PRF-03) and the ones I owe as somebody's manager. Everything else — reading
// another person's review, writing it — is decided on the review's own page.
export default async function ReviewsPage() {
  const user = await requireUser();
  const [mine, owed, invitations, t, format] = await Promise.all([listMyParticipations(user.person.id), listReviewsIOwe(user.person.id), listPeerInvitations(user.person.id), getTranslations("performance.reviews"), getFormatter()]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <PerformanceNav active="reviews" />

      <section className="flex flex-col gap-2">
        <h2>{t("mine.title")}</h2>
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("mine.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {mine.map((line) => (
            <li key={line.participantId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Link href={`/performance/reviews/${line.participantId}`} className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline">
                {line.cycleName}
              </Link>
              <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
              <span className="text-xs text-muted-foreground">{t("mine.self")}</span>
              <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
              {line.released ? <span className="text-xs tabular-nums">{ratingText(format, line.reviewScoreBp)}</span> : null}
              {line.selfDueOn && line.selfStatus !== "submitted" ? <span className="text-xs text-warning">{t("mine.selfDue", { date: format.dateTime(new Date(`${line.selfDueOn}T00:00:00Z`), { dateStyle: "medium" }) })}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* 360 feedback other people asked of me (FR-PRF-03). Nothing here says what anybody else
          wrote — only that somebody is waiting on me. */}
      {invitations.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2>{t("peers.invitations")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {invitations.map((invitation) => (
              <li key={invitation.nominationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <Link href={`/performance/reviews/${invitation.participantId}`} className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline">
                  {invitation.subjectName}
                </Link>
                <span className="text-xs text-muted-foreground">{invitation.cycleName}</span>
                <FormStatusBadge status={invitation.submitted ? "submitted" : invitation.written ? "draft" : null} label={t(`formStatus.${invitation.submitted ? "submitted" : invitation.written ? "draft" : "none"}`)} />
                {invitation.peerDueOn && !invitation.submitted ? (
                  <span className="text-xs text-warning">{t("peers.invitationDue", { date: format.dateTime(new Date(`${invitation.peerDueOn}T00:00:00Z`), { dateStyle: "medium" }) })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {owed.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2>{t("owed.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("owed.description")}</p>
          <ul className="flex flex-col divide-y rounded-xl border">
            {owed.map((line) => (
              <li key={line.participantId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <Link href={`/performance/reviews/${line.participantId}`} className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline">
                  {line.personName}
                </Link>
                <span className="text-xs text-muted-foreground">{line.cycleName}</span>
                <span className="text-xs text-muted-foreground">{t("owed.selfLabel")}</span>
                <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                <span className="text-xs text-muted-foreground">{t("owed.managerLabel")}</span>
                <FormStatusBadge status={line.managerStatus} label={t(`formStatus.${line.managerStatus ?? "none"}`)} />
                <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
