import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import {
  canAcknowledgeReview,
  canDecideNomination,
  canNominatePeer,
  canReadAnonymisedPeers,
  canReadReviewForm,
  canReleaseReview,
  canSeeNominations,
  canSeeParticipant,
  canWriteManagerReview,
  canWritePeerReview,
  canWriteSelfReview,
  getPublishedResult,
  loadParticipant,
  loadReviewEvidence,
  peerCandidates,
} from "@/modules/performance/service";
import type { PeerNominationStatus, ReviewFormKind } from "@/modules/performance/service";
import { EvidencePanel } from "@/modules/performance/ui/evidence";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { BandBadge, ResultTraceTable } from "@/modules/performance/ui/result";
import { FilledForm, ratingText, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AcknowledgeForm, CalibrateForm, NominatePeerForm, NominationDecisionForm, ReleaseForm, ReviewFormEditor } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("review");

/**
 * One person's review (FR-PRF-03, FR-PRF-08). Every block on this page is behind
 * `canReadReviewForm`: a draft is its author's alone, the manager's assessment reaches the subject
 * only after release, and peers stay anonymous when the cycle says so.
 */
export default async function ReviewPage({ params }: PageProps<"/performance/reviews/[participantId]">) {
  const user = await requireUser();
  const { participantId } = await params;
  const loaded = await loadParticipant(participantId);
  const nominated = !!loaded?.nominations.some((row) => row.peerPersonId === user.person.id && row.status === "approved");
  if (!loaded || !canSeeParticipant(user.principal, loaded.parties, nominated)) notFound();

  const { participant, cycle, parties, shape, forms, nominations, directory } = loaded;

  const today = todayInVietnam();
  const nameOf = (personId: string) => directory.get(personId)?.fullName ?? "—";
  const readable = forms.filter((form) => canReadReviewForm(user.principal, parties, { kind: form.kind as ReviewFormKind, authorPersonId: form.authorPersonId, status: form.status as "draft" | "submitted" }));
  const mySelf = forms.find((form) => form.kind === "self" && form.authorPersonId === user.person.id);
  const myManager = forms.find((form) => form.kind === "manager" && form.authorPersonId === user.person.id);
  const myPeer = forms.find((form) => form.kind === "peer" && form.authorPersonId === user.person.id);
  const selfSubmitted = forms.some((form) => form.kind === "self" && form.status === "submitted");
  const selfOverdue = cycle.selfDueOn !== null && cycle.selfDueOn < today;
  const managerBlocked = !selfSubmitted && !selfOverdue;
  // Anonymous peer feedback the subject may read: the content without its author.
  const anonymousPeers = canReadAnonymisedPeers(user.principal, parties) ? forms.filter((form) => form.kind === "peer" && form.status === "submitted") : [];

  // The evidence panel (FR-PRF-07) is for whoever writes or reads this review — it is the same
  // personal-tier data as the review itself, and a nominated peer is not shown it.
  const writesReview = canWriteManagerReview(user.principal, parties) || canWriteSelfReview(user.principal, parties);
  const showsEvidence = writesReview || canReleaseReview(user.principal, parties);
  const seesNominations = canSeeNominations(user.principal, parties);
  const mayNominate = canNominatePeer(user.principal, parties);
  const mayDecide = canDecideNomination(user.principal, parties);
  const approvedPeers = nominations.filter((row) => row.status === "approved").length;
  const isSubject = participant.personId === user.person.id;
  const mayRelease = canReleaseReview(user.principal, parties);
  // The calibrated score: whoever calibrates and releases it, and the subject once it is released
  // to them. Not a nominated peer, not the subject before release.
  const seesScore = mayRelease || (isSubject && parties.released);
  // On an anonymous cycle the subject is told how many peers have written, never which ones: a
  // per-name "written" beside a per-name list is the author of every form, one by one.
  const peersByCountOnly = isSubject && cycle.peerAnonymous && !mayDecide;
  const [t, tr, format, locale, evidence, published, candidates] = await Promise.all([
    getTranslations("performance.reviews"),
    getTranslations("performance.results"),
    getFormatter(),
    getLocale(),
    showsEvidence ? loadReviewEvidence({ personId: participant.personId, year: cycle.year }) : null,
    // The person's own settled result, once it has been published to them (FR-PRF-09).
    seesNominations ? getPublishedResult(participant.personId, cycle.year) : null,
    cycle.peersEnabled && mayNominate ? peerCandidates(participantId) : [],
  ]);
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });
  const peerWrote = new Set(forms.filter((form) => form.kind === "peer").map((form) => form.authorPersonId));
  const writtenCount = nominations.filter((row) => peerWrote.has(row.peerPersonId)).length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/performance/reviews" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1>{nameOf(participant.personId)}</h1>
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

      {evidence ? <EvidencePanel evidence={evidence} labels={{ t, format }} /> : null}

      {shape && canWriteSelfReview(user.principal, parties) && mySelf?.status !== "submitted" ? (
        <section className="flex flex-col gap-3">
          <h2>{t("form.kind.self")}</h2>
          <ReviewFormEditor value={{ participantId, kind: "self", shape, answers: mySelf?.answers ?? {}, comment: mySelf?.comment ?? null, submitted: false }} />
        </section>
      ) : null}

      {shape && canWriteManagerReview(user.principal, parties) && myManager?.status !== "submitted" ? (
        <section className="flex flex-col gap-3">
          <h2>{t("form.kind.manager")}</h2>
          {managerBlocked ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("form.waitingForSelf", { date: cycle.selfDueOn ? formatDate(cycle.selfDueOn) : "—" })}</p> : null}
          <ReviewFormEditor value={{ participantId, kind: "manager", shape, answers: myManager?.answers ?? {}, comment: myManager?.comment ?? null, submitted: false }} />
        </section>
      ) : null}

      {shape && canWritePeerReview(user.principal, parties, nominated) && myPeer?.status !== "submitted" ? (
        <section className="flex flex-col gap-3">
          <h2>{t("form.kind.peer")}</h2>
          <ReviewFormEditor value={{ participantId, kind: "peer", shape, answers: myPeer?.answers ?? {}, comment: myPeer?.comment ?? null, submitted: false }} />
        </section>
      ) : null}

      {/* Who was asked for 360 feedback. Anonymity hides *who wrote what* (the forms below),
          never the fact that somebody was asked — HR and the manager have to be able to chase them. */}
      {seesNominations ? (
        <section className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{t("peers.title")}</h2>
            {cycle.peersEnabled ? <span className="text-xs text-muted-foreground">{t("peers.range", { min: cycle.peerMin, max: cycle.peerMax, approved: approvedPeers })}</span> : null}
          </div>
          {!cycle.peersEnabled ? (
            <p className="text-sm text-muted-foreground">{t("peers.disabled")}</p>
          ) : (
            <>
              {cycle.peerAnonymous ? <p className="text-xs text-muted-foreground">{t("peers.anonymous")}</p> : null}
              {peersByCountOnly && nominations.length > 0 ? <p className="text-xs text-muted-foreground">{t("peers.writtenCount", { written: writtenCount, total: nominations.length })}</p> : null}
              {nominations.length === 0 ? <p className="text-sm text-muted-foreground">{t("peers.empty")}</p> : null}
              <ul className="flex flex-col divide-y">
                {nominations.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      {nameOf(row.peerPersonId)}
                      <span className="pl-2 text-xs text-muted-foreground">
                        {t(`peers.status.${row.status as PeerNominationStatus}`)}
                        {peersByCountOnly ? null : <> · {peerWrote.has(row.peerPersonId) ? t("peers.written") : t("peers.notWritten")}</>}
                      </span>
                    </span>
                    {/* Withdrawing is possible only while nothing is written, so on an anonymous
                        cycle the subject is offered it only before approval — when nobody can have
                        written yet — or the button itself would say who has. */}
                    <NominationDecisionForm
                      nominationId={row.id}
                      canDecide={mayDecide && row.status === "pending"}
                      canWithdraw={peersByCountOnly ? row.status === "pending" && row.nominatedByPersonId === user.person.id : !peerWrote.has(row.peerPersonId) && (mayDecide || row.nominatedByPersonId === user.person.id)}
                    />
                  </li>
                ))}
              </ul>
              {mayNominate && approvedPeers < cycle.peerMax ? (
                <>
                  <NominatePeerForm participantId={participantId} candidates={candidates} />
                  <p className="text-xs text-muted-foreground">{mayDecide ? t("peers.managerHint") : t("peers.selfHint")}</p>
                  {approvedPeers < cycle.peerMin ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("peers.needMore", { count: cycle.peerMin - approvedPeers })}</p> : null}
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2>{t("submitted.title")}</h2>
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

      {seesScore && (participant.reviewScoreBp !== null || (mayRelease && participant.calibrationNote)) ? (
        <section className="flex flex-col gap-1 rounded-xl border p-3">
          <h2 className="text-sm font-medium">{t("calibrate.title")}</h2>
          <p className="text-sm tabular-nums">{t("calibrate.current", { value: ratingText(format, participant.reviewScoreBp) })}</p>
          {participant.calibrationNote && mayRelease ? <p className="text-xs text-muted-foreground">{participant.calibrationNote}</p> : null}
        </section>
      ) : null}

      {mayRelease && !parties.released ? (
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
              {/* The subject's own words about their review: theirs, their line and HR's — not a peer's. */}
              {participant.acknowledgementNote && seesNominations ? ` — ${participant.acknowledgementNote}` : ""}
            </p>
          ) : canAcknowledgeReview(user.principal, parties) ? (
            <AcknowledgeForm participantId={participantId} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("acknowledge.waiting")}</p>
          )}
        </section>
      ) : null}

      {/* The settled yearly result, once it has been published (FR-PRF-09). Score, band and
          multiplier — a number, never money: the bonus it drives lives in payroll. */}
      {published ? (
        <section className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-medium">{tr("title")}</h2>
            <BandBadge band={published.finalBand} label={published.trace.finalBand ? (locale.startsWith("en") && published.trace.finalBand.labelEn ? published.trace.finalBand.labelEn : published.trace.finalBand.label) : "—"} />
          </div>
          <ResultTraceTable trace={published.trace} labels={{ t: tr, format }} locale={locale} provenance={{ months: published.kpiScoreIds.length, goals: published.goalIds.length, weightingFrom: null }} />
        </section>
      ) : null}
    </div>
  );
}
