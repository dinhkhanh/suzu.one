import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageReferrals } from "@/modules/recruit/policy";
import { listMyReferrals, listOpeningsForReferral, listReferrals } from "@/modules/recruit/referrals";
import { ReferralForm } from "@/modules/recruit/ui/referral-form";
import { SettleBonusButton } from "@/modules/recruit/ui/settle-bonus";

export const metadata: Metadata = { title: "Referrals" };

/**
 * The referral programme (FR-REC-10). **Everybody's page** — unlike the rest of `/recruit`, it is
 * not gated on recruitment access, because the programme only works if the whole company can find
 * it. What a plain employee sees is the form and their own referrals; the book below it, and the
 * button that settles a bonus, appear only for the recruitment desk.
 */
export default async function ReferralsPage() {
  const user = await requireUser();
  const t = await getTranslations("recruit.referral");
  const tRoot = await getTranslations("recruit");
  const tStatus = await getTranslations("recruit.applicationStatus");
  const format = await getFormatter();

  const manages = canManageReferrals(user.principal);
  const [openings, mine, book] = await Promise.all([listOpeningsForReferral(), listMyReferrals(user.person.id), manages ? listReferrals(user.principal) : Promise.resolve([])]);

  const bonusBadge = (state: string) => (state === "earned" ? "default" : state === "settled" ? "secondary" : "outline");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("newTitle")}</h2>
        <ReferralForm openings={openings} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("mine")}</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noneMine")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {mine.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{row.candidateName}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.openingTitle} · {row.openingCode} · {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </p>
                </div>
                {/* A referrer sees how far their name got, never anybody's scorecard or figure. */}
                <span className="text-xs text-muted-foreground">{row.stageName}</span>
                <Badge variant="outline">{tStatus(row.applicationStatus)}</Badge>
                <Badge variant={bonusBadge(row.bonus)}>{t(`bonus.${row.bonus}` as "bonus.pending")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manages ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("book")}</h2>
            <Link href="/recruit" className="text-sm underline-offset-4 hover:underline">
              {tRoot("title")}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{t("bookHint")}</p>
          {book.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {book.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/recruit/applications/${row.applicationId}`} className="text-sm font-medium hover:underline">
                      {row.candidateName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t("by", { name: row.referredByName })} · {row.openingTitle} · {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                    </p>
                    {row.bonusNote ? <p className="text-xs text-muted-foreground">{row.bonusNote}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{row.stageName}</span>
                  <Badge variant="outline">{tStatus(row.applicationStatus)}</Badge>
                  <Badge variant={bonusBadge(row.bonus)}>{t(`bonus.${row.bonus}` as "bonus.pending")}</Badge>
                  {row.bonus === "earned" ? <SettleBonusButton referralId={row.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
