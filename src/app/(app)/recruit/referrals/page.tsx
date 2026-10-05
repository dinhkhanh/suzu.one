import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageReferrals } from "@/modules/recruit/policy";
import { listMyReferrals, listOpeningsForReferral, listReferrals } from "@/modules/recruit/referrals";
import { ReferralForm } from "@/modules/recruit/ui/referral-form";
import { SettleBonusButton } from "@/modules/recruit/ui/settle-bonus";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("referrals");

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


  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <TableCard>
        <TableCardHeader title={t("mine")} count={mine.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("fullName")}</TableHead>
              <TableHead kind="text">{t("opening")}</TableHead>
              <TableHead kind="id">{tRoot("columns.code")}</TableHead>
              <TableHead kind="date">{tRoot("columns.createdAt")}</TableHead>
              <TableHead kind="status">{tRoot("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.length === 0 ? <TableEmpty>{t("noneMine")}</TableEmpty> : null}
            {mine.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-64 truncate font-medium">{row.name ?? row.openingTitle}</TableCell>
                <TableCell className="max-w-64 truncate">{row.openingTitle}</TableCell>
                <TableCell kind="id">{row.openingCode}</TableCell>
                <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium" })}</TableCell>
                {/* A referrer sees what they typed and whether a bonus is due — never the stage, the
                    status or the name on file, any of which would say the person was already known. */}
                <TableCell>{row.state === "received" ? <Badge variant="outline">{t("received")}</Badge> : <Badge dot variant={statusTone(row.state)}>{t(`bonus.${row.state}`)}</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* The page's whole point for most readers, so the form stays unfolded. */}
        <TableAddRow label={t("newTitle")} open>
          <ReferralForm openings={openings} />
        </TableAddRow>
      </TableCard>

      {manages ? (
        <TableCard>
          <TableCardHeader
            title={t("book")}
            count={book.length || null}
            description={t("bookHint")}
            actions={
              <Link href="/recruit" className="text-sm underline-offset-4 hover:underline">
                {tRoot("title")}
              </Link>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{tRoot("columns.candidate")}</TableHead>
                <TableHead kind="person">{tRoot("form.referredBy")}</TableHead>
                <TableHead kind="text">{t("opening")}</TableHead>
                <TableHead kind="date">{tRoot("columns.createdAt")}</TableHead>
                <TableHead kind="select">{tRoot("columns.stage")}</TableHead>
                <TableHead kind="status">{tRoot("columns.status")}</TableHead>
                <TableHead kind="status">{t("bonusColumn")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {book.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
              {book.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-64 truncate">
                    <RecordLink kind="application" id={row.applicationId} className="font-medium">
                      {row.candidateName}
                    </RecordLink>
                  </TableCell>
                  <TableCell>
                    <RecordLink kind="person" id={row.referredByPersonId}>{row.referredByName}</RecordLink>
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    <RecordLink kind="opening" id={row.openingId}>{row.openingTitle}</RecordLink>
                  </TableCell>
                  <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium" })}</TableCell>
                  <TableCell>{row.stageName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{tStatus(row.applicationStatus)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <Badge dot variant={statusTone(row.bonus)}>{t(`bonus.${row.bonus}` as "bonus.pending")}</Badge>
                    {row.bonusNote ? <p className="truncate text-xs text-muted-foreground">{row.bonusNote}</p> : null}
                  </TableCell>
                  <TableCell kind="actions">{row.bonus === "earned" ? <SettleBonusButton referralId={row.id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
