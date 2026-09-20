import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import {
  canAcknowledgeReview,
  canReadAnonymisedPeers,
  canReadReviewForm,
  canReleaseReview,
  canSeeParticipant,
  canWriteManagerReview,
  canWriteSelfReview,
  loadParticipant,
} from "@/modules/performance/service";
import type { ReviewFormKind } from "@/modules/performance/service";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { FilledForm, ratingText, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AcknowledgeForm, CalibrateForm, ReleaseForm, ReviewFormEditor } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Review" };

/**
 * One person's review (FR-PRF-03, FR-PRF-08). Every block on this page is behind
 * `canReadReviewForm`: a draft is its author's alone, the manager's assessment reaches the subject
 * only after release, and peers stay anonymous when the cycle says so.
 */
export default async function ReviewPage({ params }: PageProps<"/performance/reviews/[participantId]">) {
  const user = await requireUser();
  const { participantId } = await params;
  const loaded = await loadParticipant(participantId);
  if (!loaded || !canSeeParticipant(user.principal, loaded.parties)) notFound();

  const { participant, cycle, parties, shape, forms, directory } = loaded;
  const [t, format] = await Promise.all([getTranslations("performance.reviews"), getFormatter()]);
  const today = todayInVietnam();
  const nameOf = (personId: string) => directory.get(personId)?.fullName ?? "—";
  const readable = forms.filter((form) => canReadReviewForm(user.principal, parties, { kind: form.kind as ReviewFormKind, authorPersonId: form.authorPersonId, status: form.status as "draft" | "submitted" }));
  const mySelf = forms.find((form) => form.kind === "self" && form.authorPersonId === user.person.id);
  const myManager = forms.find((form) => form.kind === "manager" && form.authorPersonId === user.person.id);
  const selfSubmitted = forms.some((form) => form.kind === "self" && form.status === "submitted");
  const selfOverdue = cycle.selfDueOn !== null && cycle.selfDueOn < today;
  const managerBlocked = !selfSubmitted && !selfOverdue;
  // Anonymous peer feedback the subject may read: the content without its author.
  const anonymousPeers = canReadAnonymisedPeers(user.principal, parties) ? forms.filter((form) => form.kind === "peer" && form.status === "submitted") : [];
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/performance/reviews" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{nameOf(participant.personId)}</h1>
          <StageBadge stage={parties.stage} label={t(`stage.${parties.stage}`)} />
        </div>
        <p className="text-sm text-muted-foreground">
          {cycle.name} · {t(`cycle.kinds.${cycle.kind}`)} · {t(`cycleStatus.${cycle.status}`)}
          {participant.managerPersonId ? ` · ${t("manager", { name: nameOf(participant.managerPersonId) })}` : ""}
        </p>
      </header>
      <PerformanceNav active="reviews" />
      <Timeline
        dates={[
          { key: "selfDueOn", on: cycle.selfDueOn },
          { key: "managerDueOn", on: cycle.managerDueOn },
          { key: "peerDueOn", on: cycle.peerDueOn },
          { key: "calibrationOn", on: cycle.calibrationOn },
          { key: "releaseOn", on: cycle.releaseOn },
        ]}
        labels={{ t, formatDate }}
      />

      {shape === null ? <p className="text-sm text-muted-foreground">{t("notLaunched")}</p> : null}

      {shape && canWriteSelfReview(user.principal, parties) && mySelf?.status !== "submitted" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t("form.kind.self")}</h2>
          <ReviewFormEditor value={{ participantId, kind: "self", shape, answers: mySelf?.answers ?? {}, comment: mySelf?.comment ?? null, submitted: false }} />
        </section>
      ) : null}

      {shape && canWriteManagerReview(user.principal, parties) && myManager?.status !== "submitted" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t("form.kind.manager")}</h2>
          {managerBlocked ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("form.waitingForSelf", { date: cycle.selfDueOn ? formatDate(cycle.selfDueOn) : "—" })}</p> : null}
          <ReviewFormEditor value={{ participantId, kind: "manager", shape, answers: myManager?.answers ?? {}, comment: myManager?.comment ?? null, submitted: false }} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("submitted.title")}</h2>
        {readable.length === 0 && anonymousPeers.length === 0 ? <p className="text-sm text-muted-foreground">{t("submitted.empty")}</p> : null}
        {shape
          ? readable.map((form) => (
              <FilledForm
                key={form.id}
                shape={shape}
                kind={form.kind as ReviewFormKind}
                answers={form.answers}
                overallRatingBp={form.overallRatingBp}
                comment={form.comment}
                author={form.status === "draft" ? null : nameOf(form.authorPersonId)}
                labels={{ t, format }}
              />
            ))
          : null}
        {/* The subject's copy of anonymous peer feedback: what was said, never who said it. */}
        {shape
          ? anonymousPeers
              .filter((form) => !readable.some((seen) => seen.id === form.id))
              .map((form) => <FilledForm key={form.id} shape={shape} kind="peer" answers={form.answers} overallRatingBp={form.overallRatingBp} comment={form.comment} author={null} labels={{ t, format }} />)
          : null}
      </section>

      {participant.reviewScoreBp !== null || participant.calibrationNote ? (
        <section className="flex flex-col gap-1 rounded-xl border p-3">
          <h2 className="text-sm font-medium">{t("calibrate.title")}</h2>
          <p className="text-sm tabular-nums">{t("calibrate.current", { value: ratingText(format, participant.reviewScoreBp) })}</p>
          {participant.calibrationNote && canReleaseReview(user.principal, parties) ? <p className="text-xs text-muted-foreground">{participant.calibrationNote}</p> : null}
        </section>
      ) : null}

      {canReleaseReview(user.principal, parties) && !parties.released ? (
        <section className="flex flex-col gap-3 rounded-xl border p-3">
          <h2 className="text-sm font-medium">{t("release.title")}</h2>
          <CalibrateForm participantId={participantId} currentPercent={participant.reviewScoreBp === null ? "" : String(participant.reviewScoreBp / 100)} />
          <ReleaseForm participantId={participantId} />
        </section>
      ) : null}

      {parties.released ? (
        <section className="flex flex-col gap-3 rounded-xl border p-3">
          <h2 className="text-sm font-medium">{t("acknowledge.title")}</h2>
          {participant.acknowledgedAt ? (
            <p className="text-sm text-muted-foreground">
              {t("acknowledge.done", { date: format.dateTime(participant.acknowledgedAt, { dateStyle: "medium" }) })}
              {participant.acknowledgementNote ? ` — ${participant.acknowledgementNote}` : ""}
            </p>
          ) : canAcknowledgeReview(user.principal, parties) ? (
            <AcknowledgeForm participantId={participantId} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("acknowledge.waiting")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
