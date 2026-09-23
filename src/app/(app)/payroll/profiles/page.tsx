import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
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
      {proposals.length === 0 ? <p className="text-sm text-muted-foreground">{t("profiles.noProposals")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="flex flex-col gap-1">
              <Link href={`/payroll/salaries/${proposal.personId}`} className="font-medium hover:underline">
                {proposal.personName}
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                {proposal.currentProfile ? <Badge variant="secondary">{t(`profiles.kinds.${proposal.currentProfile}`)}</Badge> : null}→<Badge variant="outline">{t(`profiles.kinds.${proposal.profile}`)}</Badge>
                {proposal.simpleBasis ? t(`profiles.bases.${proposal.simpleBasis}`) : null} · {day(proposal.validFrom)} · {proposal.proposedByName}
              </span>
              {proposal.note ? <span className="text-muted-foreground">{proposal.note}</span> : null}
            </div>
            {canDecide ? <RuleDecisionButtons id={proposal.id} kind="profile" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
