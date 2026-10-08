import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { listFlaggedPunches } from "@/modules/attendance/punches";
import { ReviewPunchForm } from "@/modules/attendance/ui/check-in";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("flaggedCheckIns");

// Check-ins that were out of policy (FR-ATT-04): the line manager's reports and HR's scope. The
// service returns only what the viewer may review, so everyone may open the page; most see it empty.
export default async function ReviewPunchesPage() {
  const user = await requireUser();
  const [t, tFlags, format] = await Promise.all([getTranslations("attendance.review"), getTranslations("attendance.checkIn"), getFormatter()]);
  const rows = await listFlaggedPunches({ personId: user.person.id, principal: user.principal });
  const waiting = rows.filter((row) => row.reviewStatus === "pending");
  const decided = rows.filter((row) => row.reviewStatus !== "pending");

  const describe = (row: (typeof rows)[number]) => (
    <>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <RecordLink kind="person" id={row.personId} className="font-medium">
          {row.personName}
        </RecordLink>
        <span className="font-mono text-[0.8125rem] tabular-nums">{format.dateTime(row.at, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <Badge variant={row.direction === "in" ? "success" : "secondary"}>{tFlags(row.direction === "in" ? "in" : "out")}</Badge>
      </p>
      <ul className="text-sm text-muted-foreground">
        {row.flags.map((flag) => (
          <li key={flag}>{tFlags(`flags.${flag}`, { distance: row.distanceM ?? 0 })}</li>
        ))}
      </ul>
      <p className="font-mono text-xs text-faint tabular-nums">
        {[
          row.nearestLocationName && row.distanceM !== null ? t("distance", { metres: row.distanceM, location: row.nearestLocationName }) : null,
          row.accuracyM !== null ? t("accuracy", { metres: row.accuracyM }) : null,
          row.latitude !== null && row.longitude !== null ? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}` : null,
          row.ipAddress ? `IP ${row.ipAddress}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {row.note ? <p className="text-sm">“{row.note}”</p> : null}
    </>
  );

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <Section title={t("waiting", { count: waiting.length })}>
        <List>
          {waiting.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {waiting.map((row) => (
            <ListItem key={row.id} className="flex-col items-stretch gap-2 py-4">
              {describe(row)}
              <ReviewPunchForm id={row.id} />
            </ListItem>
          ))}
        </List>
      </Section>
      {decided.length > 0 ? (
        <Section title={t("decided")} count={decided.length}>
          <List>
            {decided.map((row) => (
              <ListItem key={row.id} className="flex-col items-stretch gap-1 py-3">
                {describe(row)}
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge dot variant={statusTone(row.reviewStatus)}>
                    {tFlags(`review.${row.reviewStatus}`)}
                  </Badge>
                  <span className="text-muted-foreground">
                    <RecordLink kind="person" id={row.reviewerPersonId}>
                      {row.reviewerName}
                    </RecordLink>
                    {row.reviewerName && row.reviewNote ? " — " : null}
                    {row.reviewNote}
                  </span>
                </p>
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}
    </Page>
  );
}
