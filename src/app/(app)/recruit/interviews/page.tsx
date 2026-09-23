import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listMyInterviews } from "@/modules/recruit/interviews";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("interviews");

/**
 * My interviews (FR-REC-06). For an interviewer who is on no hiring team this is the whole of
 * their access to recruitment: the conversations they are in, and the cards they still owe. It
 * needs no permission at all — the list is keyed on being in the room.
 */
export default async function MyInterviewsPage() {
  const user = await requireUser();
  const t = await getTranslations("recruit.interview");
  const format = await getFormatter();
  const rows = await listMyInterviews(user.person.id);
  // "Still ahead" is decided by the database's clock (`MyInterviewRow.upcoming`): a server
  // component may not read the wall clock, and a page that did would be a page that re-renders
  // into a different answer.
  const upcoming = rows.filter((row) => row.upcoming).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = rows.filter((row) => !row.upcoming);

  const list = (items: typeof rows) => (
    <ul className="flex flex-col divide-y rounded-xl border">
      {items.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1 basis-56">
            <Link href={`/recruit/interviews/${row.id}`} className="text-sm font-medium hover:underline">
              {row.title} — {row.candidateName}
            </Link>
            <p className="text-xs text-muted-foreground">
              {row.openingTitle} · {t(`modes.${row.mode}`)}
              {row.location ? ` · ${row.location}` : ""}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{format.dateTime(row.startAt, { dateStyle: "medium", timeStyle: "short" })}</span>
          {row.status === "scheduled" ? (
            <Badge variant={row.scorecardSubmitted ? "outline" : "secondary"}>{row.scorecardSubmitted ? t("cardIn") : t("cardDue")}</Badge>
          ) : (
            <Badge variant="outline">{t(`statuses.${row.status}`)}</Badge>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1>{t("mine")}</h1>
        <p className="text-sm text-muted-foreground">{t("mineDescription")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("upcoming")}</h2>
        {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">{t("noneUpcoming")}</p> : list(upcoming)}
      </section>

      {past.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("past")}</h2>
          {list(past)}
        </section>
      ) : null}
    </div>
  );
}
