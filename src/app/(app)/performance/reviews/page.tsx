import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listMyParticipations, listPeerInvitations, listReviewsIOwe } from "@/modules/performance/service";
import { Page, PageHeader } from "@/components/ui/page";
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
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <PerformanceNav active="reviews" />

      <TableCard>
        <TableCardHeader title={t("mine.title")} count={mine.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.cycle")}</TableHead>
              <TableHead kind="status">{t("columns.stage")}</TableHead>
              <TableHead kind="status">{t("mine.self")}</TableHead>
              <TableHead kind="percent">{t("calibrate.title")}</TableHead>
              <TableHead kind="date">{t("timeline.selfDueOn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.length === 0 ? <TableEmpty>{t("mine.empty")}</TableEmpty> : null}
            {mine.map((line) => (
              <TableRow key={line.participantId}>
                <TableCell>
                  <Link href={`/performance/reviews/${line.participantId}`} className="font-medium underline-offset-4 hover:underline">
                    {line.cycleName}
                  </Link>
                </TableCell>
                <TableCell>
                  <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
                </TableCell>
                <TableCell>
                  <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                </TableCell>
                <TableCell kind="percent">{line.released ? ratingText(format, line.reviewScoreBp) : null}</TableCell>
                <TableCell className="text-warning">{line.selfDueOn && line.selfStatus !== "submitted" ? format.dateTime(new Date(`${line.selfDueOn}T00:00:00Z`), { dateStyle: "medium" }) : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* 360 feedback other people asked of me (FR-PRF-03). Nothing here says what anybody else
          wrote — only that somebody is waiting on me. */}
      {invitations.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("peers.invitations")} count={invitations.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("columns.person")}</TableHead>
                <TableHead kind="text">{t("columns.cycle")}</TableHead>
                <TableHead kind="status">{t("columns.status")}</TableHead>
                <TableHead kind="date">{t("timeline.peerDueOn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.nominationId}>
                  <TableCell>
                    <Link href={`/performance/reviews/${invitation.participantId}`} className="font-medium underline-offset-4 hover:underline">
                      {invitation.subjectName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{invitation.cycleName}</TableCell>
                  <TableCell>
                    <FormStatusBadge status={invitation.submitted ? "submitted" : invitation.written ? "draft" : null} label={t(`formStatus.${invitation.submitted ? "submitted" : invitation.written ? "draft" : "none"}`)} />
                  </TableCell>
                  <TableCell className="text-warning">{invitation.peerDueOn && !invitation.submitted ? format.dateTime(new Date(`${invitation.peerDueOn}T00:00:00Z`), { dateStyle: "medium" }) : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {owed.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("owed.title")} count={owed.length} description={t("owed.description")} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("columns.person")}</TableHead>
                <TableHead kind="text">{t("columns.cycle")}</TableHead>
                <TableHead kind="status">{t("owed.selfLabel")}</TableHead>
                <TableHead kind="status">{t("owed.managerLabel")}</TableHead>
                <TableHead kind="status">{t("columns.stage")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owed.map((line) => (
                <TableRow key={line.participantId}>
                  <TableCell>
                    <Link href={`/performance/reviews/${line.participantId}`} className="font-medium underline-offset-4 hover:underline">
                      {line.personName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.cycleName}</TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.selfStatus} label={t(`formStatus.${line.selfStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell>
                    <FormStatusBadge status={line.managerStatus} label={t(`formStatus.${line.managerStatus ?? "none"}`)} />
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={line.stage} label={t(`stage.${line.stage}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </Page>
  );
}
