import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { listOffers } from "@/modules/recruit/offers";
import { canRunRecruitment } from "@/modules/recruit/policy";
import { notFound } from "next/navigation";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("offers");

// Every offer the reader may see. Deliberately without a figure: a list is glanced at across a
// desk, and `listOffers` does not carry one for anybody. The amount is on the offer's own page,
// for the two roles that may read it.
export default async function OffersPage() {
  const user = await requireUser();
  // The rows are filtered one by one inside the service; this is only the door.
  if (!canRunRecruitment(user.principal)) notFound();

  const t = await getTranslations("recruit.offer");
  const format = await getFormatter();
  const rows = await listOffers(user.principal, user.person.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-56">
                <Link href={`/recruit/offers/${row.id}`} className="text-sm font-medium hover:underline">
                  {row.candidateName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {row.positionName} · {row.openingCode} · {row.number}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("startDate")}: {format.dateTime(new Date(`${row.startDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}
              </span>
              {row.hiredPersonId ? <Badge variant="outline">{t("statuses.converted")}</Badge> : null}
              <Badge dot variant={statusTone(row.status)}>{t(`statuses.${row.status}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
