import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import {
  canAcknowledgeReview,
  canDecideNomination,
  canNominatePeer,
  canReadAnonymisedPeers,
  canReadReviewForm,
  canRecordSignOff,
  canReleaseReview,
  canReturnReviewForm,
  canSeeNominations,
  canSeeParticipant,
  canWriteManagerReview,
  canWritePeerReview,
  canWriteSelfReview,
  dueDatesOf,
  getPublishedResult,
  isReviewCalibrator,
  isReviewingManager,
  loadParticipant,
  loadReviewEvidence,
  peerCandidates,
} from "@/modules/performance/service";
import type { PeerNominationStatus, ReviewFormKind } from "@/modules/performance/service";
import { EvidencePanel } from "@/modules/performance/ui/evidence";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { BandBadge, ResultTraceTable } from "@/modules/performance/ui/result";
import { FilledForm, ratingText, StageBadge, Timeline } from "@/modules/performance/ui/review";
import { AcknowledgeForm, CalibrateForm, NominatePeerForm, NominationDecisionForm, ReleaseForm, ReturnFormForm, ReviewFormEditor, SignOffForm } from "@/modules/performance/ui/review-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("review");

/**
 * One person's review (FR-PRF-03, FR-PRF-08). Every block on this page is behind
 * `canReadReviewForm`: a draft is its author's (and oversight's) alone, the manager's assessment reaches the subject
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
  // This person's own deadlines (a probation review) win over the cycle's.
  const due = dueDatesOf(participant, cycle);
  const selfOverdue = due.selfDueOn !== null && due.selfDueOn < today;
  const managerBlocked = !selfSubmitted && !selfOverdue;
  // Anonymous peer feedback the subject may read: the content without its author.
  const anonymousPeers = canReadAnonymisedPeers(user.principal, parties) ? forms.filter((form) => form.kind === "peer" && form.status === "submitted") : [];

  // The evidence panel (FR-PRF-07) is for whoever writes or reads this review — it is the same
  // personal-tier data as the review itself, and a nominated peer is not shown it.
  const writesReview = canWriteManagerReview(user.principal, parties) || canWriteSelfReview(user.principal, parties);
  // HR over the person calibrates and releases; the manager writes and proposes (PRF-02).
  const calibrator = isReviewCalibrator(user.principal, parties);
  const showsEvidence = writesReview || calibrator;
  const seesNominations = canSeeNominations(user.principal, parties);
  const mayNominate = canNominatePeer(user.principal, parties);
  const mayDecide = canDecideNomination(user.principal, parties);
  const approvedPeers = nominations.filter((row) => row.status === "approved").length;
  const isSubject = participant.personId === user.person.id;
  // …and only once the cycle has reached its calibration stage.
  const mayRelease = canReleaseReview(user.principal, parties);
  const reviewingManager = !isSubject && isReviewingManager(user.principal, parties);
  const managerSubmitted = forms.some((form) => form.kind === "manager" && form.status === "submitted");
  // The calibrated score: whoever calibrates and releases it, and — once it is released — the
  // subject and the manager who proposed it. Not a nominated peer, nobody else before release.
  const seesScore = calibrator || ((isSubject || reviewingManager) && parties.released);
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
  // HR over the person sends a submitted form back while the review is still being written.
  const mayReturn = canReturnReviewForm(user.principal, parties) && !participant.calibratedAt;
  const returnReasonOf = (form: (typeof forms)[number] | undefined) => (form && form.status === "draft" && form.returnedAt ? form.returnReason : null);
  const writtenCount = nominations.filter((row) => peerWrote.has(row.peerPersonId)).length;

  return (
    <Page className="max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href="/performance/reviews" className="text-link underline-offset-4 hover:underline">
            {t("back")}
          </Link>
        }
        title={
          <RecordLink kind="person" id={participant.personId}>
            {nameOf(participant.personId)}
          </RecordLink>
        }
        description={
          <>
            {cycle.name} · {t(`cycle.kinds.${cycle.kind}`)} · {t(`cycleStatus.${cycle.status}`)}
            {participant.managerPersonId ? " · " : null}
            {participant.managerPersonId
              ? t.rich("manager", {
                  name: nameOf(participant.managerPersonId),
                  person: (chunks) => (
                    <RecordLink kind="person" id={participant.managerPersonId}>
                      {chunks}
                    </RecordLink>
                  ),
                })
              : null}
          </>
        }
        aside={<StageBadge stage={parties.stage} label={t(`stage.${parties.stage}`)} />}
      />
      <PerformanceNav active="reviews" />
      <Timeline
        dates={[
          { key: "selfDueOn", on: due.selfDueOn },
          { key: "managerDueOn", on: due.managerDueOn },
          { key: "peerDueOn", on: cycle.peerDueOn },
          { key: "calibrationOn", on: cycle.calibrationOn },
          { key: "releaseOn", on: cycle.releaseOn },
        ]}
        labels={{ t, formatDate }}
      />

      {shape === null ? <p className="text-sm text-muted-foreground">{t("notLaunched")}</p> : null}

      {evidence ? <EvidencePanel evidence={evidence} labels={{ t, format }} /> : null}

      {shape && canWriteSelfReview(user.principal, parties) && mySelf?.status !== "submitted" ? (
        <Section title={t("form.kind.self")}>
          <ReviewFormEditor value={{ participantId, kind: "self", shape, answers: mySelf?.answers ?? {}, comment: mySelf?.comment ?? null, submitted: false, returnReason: returnReasonOf(mySelf) }} />
        </Section>
      ) : null}

      {shape && canWriteManagerReview(user.principal, parties) && myManager?.status !== "submitted" ? (
        <Section title={t("form.kind.manager")}>
          {managerBlocked ? <p className="text-sm text-warning">{t("form.waitingForSelf", { date: due.selfDueOn ? formatDate(due.selfDueOn) : "—" })}</p> : null}
          <ReviewFormEditor value={{ participantId, kind: "manager", shape, answers: myManager?.answers ?? {}, comment: myManager?.comment ?? null, submitted: false, returnReason: returnReasonOf(myManager) }} />
        </Section>
      ) : null}

      {shape && canWritePeerReview(user.principal, parties, nominated) && myPeer?.status !== "submitted" ? (
        <Section title={t("form.kind.peer")}>
          <ReviewFormEditor value={{ participantId, kind: "peer", shape, answers: myPeer?.answers ?? {}, comment: myPeer?.comment ?? null, submitted: false, returnReason: returnReasonOf(myPeer) }} />
        </Section>
      ) : null}

      {/* Who was asked for 360 feedback. Anonymity hides *who wrote what* (the forms below),
          never the fact that somebody was asked — HR and the manager have to be able to chase them. */}
      {seesNominations ? (
        <TableCard>
          <TableCardHeader
            title={t("peers.title")}
            count={cycle.peersEnabled ? nominations.length || null : null}
            description={cycle.peersEnabled ? t("peers.range", { min: cycle.peerMin, max: cycle.peerMax, approved: approvedPeers }) : undefined}
          />
          {!cycle.peersEnabled ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("peers.disabled")}</p>
          ) : (
            <>
              {cycle.peerAnonymous || (peersByCountOnly && nominations.length > 0) ? (
                <div className="flex flex-col gap-1 border-b px-4 py-2">
                  {cycle.peerAnonymous ? <p className="text-xs text-muted-foreground">{t("peers.anonymous")}</p> : null}
                  {peersByCountOnly && nominations.length > 0 ? <p className="text-xs text-muted-foreground">{t("peers.writtenCount", { written: writtenCount, total: nominations.length })}</p> : null}
                </div>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="person">{t("columns.person")}</TableHead>
                    <TableHead kind="status">{t("columns.status")}</TableHead>
                    {peersByCountOnly ? null : <TableHead kind="check">{t("peers.written")}</TableHead>}
                    <TableHead kind="actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nominations.length === 0 ? <TableEmpty>{t("peers.empty")}</TableEmpty> : null}
                  {nominations.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        <RecordLink kind="person" id={row.peerPersonId}>
                          {nameOf(row.peerPersonId)}
                        </RecordLink>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t(`peers.status.${row.status as PeerNominationStatus}`)}</TableCell>
                      {peersByCountOnly ? null : <TableCell className="text-muted-foreground">{peerWrote.has(row.peerPersonId) ? t("peers.written") : t("peers.notWritten")}</TableCell>}
                      <TableCell kind="actions">
                        {/* Withdrawing is possible only while nothing is written, so on an anonymous
                            cycle the subject is offered it only before approval — when nobody can have
                            written yet — or the button itself would say who has. */}
                        <NominationDecisionForm
                          nominationId={row.id}
                          canDecide={mayDecide && row.status === "pending"}
                          canWithdraw={peersByCountOnly ? row.status === "pending" && row.nominatedByPersonId === user.person.id : !peerWrote.has(row.peerPersonId) && (mayDecide || row.nominatedByPersonId === user.person.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {mayNominate && approvedPeers < cycle.peerMax ? (
                <>
                  {approvedPeers < cycle.peerMin ? <p className="border-t px-4 py-2 text-xs text-warning">{t("peers.needMore", { count: cycle.peerMin - approvedPeers })}</p> : null}
                  <TableAddRow label={t("peers.add")} open={nominations.length === 0}>
                    <div className="flex flex-col gap-2">
                      <NominatePeerForm participantId={participantId} candidates={candidates} />
                      <p className="text-xs text-muted-foreground">{mayDecide ? t("peers.managerHint") : t("peers.selfHint")}</p>
                    </div>
                  </TableAddRow>
                </>
              ) : null}
            </>
          )}
        </TableCard>
      ) : null}

      <Section title={t("submitted.title")}>
        {readable.length === 0 && anonymousPeers.length === 0 ? <p className="text-sm text-muted-foreground">{t("submitted.empty")}</p> : null}
        {shape
          ? readable.map((form) => (
              <div key={form.id} className="flex flex-col gap-2">
                <FilledForm
                  shape={shape}
                  kind={form.kind as ReviewFormKind}
                  answers={form.answers}
                  overallRatingBp={form.overallRatingBp}
                  comment={form.comment}
                  // One's own draft is not signed; somebody else's draft is read only by oversight, which is told whose it is.
                  author={form.status === "draft" && form.authorPersonId === user.person.id ? null : nameOf(form.authorPersonId)}
                  draft={form.status === "draft"}
                  labels={{ t, format }}
                />
                {mayReturn && form.status === "submitted" && form.authorPersonId !== user.person.id ? <ReturnFormForm formId={form.id} /> : null}
              </div>
            ))
          : null}
        {/* The subject's copy of anonymous peer feedback: what was said, never who said it. */}
        {shape
          ? anonymousPeers
              .filter((form) => !readable.some((seen) => seen.id === form.id))
              .map((form) => <FilledForm key={form.id} shape={shape} kind="peer" answers={form.answers} overallRatingBp={form.overallRatingBp} comment={form.comment} author={null} labels={{ t, format }} />)
          : null}
      </Section>

      {seesScore && (participant.reviewScoreBp !== null || (calibrator && participant.calibrationNote)) ? (
        <Section title={t("calibrate.title")}>
          <p className="text-sm tabular-nums">{t("calibrate.current", { value: ratingText(format, participant.reviewScoreBp) })}</p>
          {participant.calibrationNote && calibrator ? <p className="text-xs text-muted-foreground">{participant.calibrationNote}</p> : null}
        </Section>
      ) : null}

      {calibrator && !parties.released ? (
        <Section title={t("release.title")}>
          {mayRelease ? (
            <>
              <CalibrateForm participantId={participantId} currentPercent={participant.reviewScoreBp === null ? "" : String(participant.reviewScoreBp / 100)} />
              <ReleaseForm participantId={participantId} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("release.notYet")}</p>
          )}
        </Section>
      ) : null}

      {/* The manager has written and proposed a rating; levelling it and handing it over is HR's. */}
      {reviewingManager && !calibrator && managerSubmitted && !parties.released ? (
        <Section title={t("release.title")}>
          <p className="text-sm text-muted-foreground">{t("release.waitingForHr")}</p>
        </Section>
      ) : null}

      {/* The sign-off conversation after release (FR-PRF-03): recorded by the manager or HR; read by
          the person, their line and HR — not a nominated peer. */}
      {parties.released && (cycle.signOffRequired || participant.signOffRecordedAt || canRecordSignOff(user.principal, parties)) && (seesNominations || canRecordSignOff(user.principal, parties)) ? (
        <Section title={t("signOff.title")}>
          {participant.signOffOn ? (
            <>
              <p className="text-sm text-muted-foreground">{t("signOff.done", { date: formatDate(participant.signOffOn), name: participant.signOffByPersonId ? nameOf(participant.signOffByPersonId) : "—" })}</p>
              <RichText text={participant.signOffNote} />
            </>
          ) : canRecordSignOff(user.principal, parties) ? (
            <>
              <p className="text-xs text-muted-foreground">{cycle.signOffRequired ? t("signOff.requiredHint") : t("signOff.optionalHint")}</p>
              <SignOffForm participantId={participantId} today={today} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("signOff.waiting")}</p>
          )}
        </Section>
      ) : null}

      {parties.released ? (
        <Section title={t("acknowledge.title")}>
          {participant.acknowledgedAt ? (
            <>
              <p className="text-sm text-muted-foreground">{t("acknowledge.done", { date: format.dateTime(participant.acknowledgedAt, { dateStyle: "medium" }) })}</p>
              {/* The subject's own words about their review: theirs, their line and HR's — not a peer's. */}
              {seesNominations ? <RichText text={participant.acknowledgementNote} /> : null}
            </>
          ) : canAcknowledgeReview(user.principal, parties) ? (
            <AcknowledgeForm participantId={participantId} />
          ) : isSubject && parties.signOffRequired && !parties.signedOff ? (
            <p className="text-sm text-muted-foreground">{t("acknowledge.afterSignOff")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("acknowledge.waiting")}</p>
          )}
        </Section>
      ) : null}

      {/* The settled yearly result, once it has been published (FR-PRF-09). Score, band and
          multiplier — a number, never money: the bonus it drives lives in payroll. */}
      {published ? (
        <Section
          title={tr("title")}
          action={<BandBadge band={published.finalBand} label={published.trace.finalBand ? (locale.startsWith("en") && published.trace.finalBand.labelEn ? published.trace.finalBand.labelEn : published.trace.finalBand.label) : "—"} />}
        >
          <ResultTraceTable trace={published.trace} labels={{ t: tr, format }} locale={locale} provenance={{ months: published.kpiScoreIds.length, goals: published.goalIds.length, weightingFrom: null }} />
        </Section>
      ) : null}
    </Page>
  );
}
