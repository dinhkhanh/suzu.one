import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { canDecidePayRules, canSeeSimpleProfileReport, compensationReach } from "@/modules/payroll/policy";
import { listProfileProposals } from "@/modules/payroll/profiles";
import { RuleDecisionButtons } from "@/modules/payroll/ui/rule-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payProfiles");

// Moves between the Statutory and Simple profiles that wait for the owner (FR-PAY-07).
export default async function ProfilesPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  const canDecide = canDecidePayRules(user.principal);
  if (!canDecide && !reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/profiles");
  const [t, format, proposals] = await Promise.all([getTranslations("payroll"), getFormatter(), listProfileProposals(reach)]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <Link href="/payroll" className="text-sm text-link hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("profiles.proposalsTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("profiles.proposalsDescription")}</p>
        {canSeeSimpleProfileReport(user.principal) ? (
          <Link href="/payroll/profiles/simple" className="text-sm hover:underline">
            {t("desk.simpleReport.title")} →
          </Link>
        ) : null}
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("salaries.person")}</TableHead>
            <TableHead kind="select">{t("profiles.profile")}</TableHead>
            <TableHead kind="select">{t("profiles.basis")}</TableHead>
            <TableHead kind="date">{t("profiles.validFrom")}</TableHead>
            <TableHead kind="person">{t("profiles.proposedBy")}</TableHead>
            <TableHead kind="text">{t("profiles.note")}</TableHead>
            {canDecide ? <TableHead kind="actions" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.length === 0 ? <TableEmpty>{t("profiles.noProposals")}</TableEmpty> : null}
          {proposals.map((proposal) => (
            <TableRow key={proposal.id}>
              <TableCell>
                <Link href={`/payroll/salaries/${proposal.personId}`} className="font-medium hover:underline">
                  {proposal.personName}
                </Link>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {proposal.currentProfile ? <Badge variant="secondary">{t(`profiles.kinds.${proposal.currentProfile}`)}</Badge> : null}→<Badge variant="outline">{t(`profiles.kinds.${proposal.profile}`)}</Badge>
                </span>
              </TableCell>
              <TableCell>{proposal.simpleBasis ? t(`profiles.bases.${proposal.simpleBasis}`) : "—"}</TableCell>
              <TableCell>{day(proposal.validFrom)}</TableCell>
              <TableCell>{proposal.proposedByName ?? "—"}</TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">{proposal.note ?? "—"}</TableCell>
              {canDecide ? (
                <TableCell kind="actions">
                  <RuleDecisionButtons id={proposal.id} kind="profile" />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
