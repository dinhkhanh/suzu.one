import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { listFlaggedPunches } from "@/modules/attendance/punches";
import { ReviewPunchForm } from "@/modules/attendance/ui/check-in";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Flagged check-ins" };

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
        <span className="font-medium">{row.personName}</span>
        <span className="font-mono">{format.dateTime(row.at, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <Badge variant="secondary">{tFlags(row.direction === "in" ? "in" : "out")}</Badge>
      </p>
      <ul className="text-sm text-muted-foreground">
        {row.flags.map((flag) => (
          <li key={flag}>{tFlags(`flags.${flag}`, { distance: row.distanceM ?? 0 })}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
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
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("waiting", { count: waiting.length })}</h2>
        {waiting.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-3">
          {waiting.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-xl border p-4">
              {describe(row)}
              <ReviewPunchForm id={row.id} />
            </li>
          ))}
        </ul>
      </section>
      {decided.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("decided")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {decided.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 p-3">
                {describe(row)}
                <p className="text-sm">
                  <Badge variant={row.reviewStatus === "rejected" ? "destructive" : "outline"}>{tFlags(`review.${row.reviewStatus}`)}</Badge> <span className="text-muted-foreground">{[row.reviewerName, row.reviewNote].filter(Boolean).join(" — ")}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
