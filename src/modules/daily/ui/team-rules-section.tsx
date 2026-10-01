// The "Daily rules" section of a team's page: a server component, so the team page only places it.
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/ui/page";
import { getTeamRules } from "../team-rules";
import { TeamRulesForm } from "./team-rules-form";

export async function DailyRulesSection({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const [t, rules] = await Promise.all([getTranslations("daily.rules"), getTeamRules(teamId)]);
  return (
    <Section title={t("title")}>
      <p className="px-0.5 text-xs text-muted-foreground">{t("description")}</p>
      {/* What the company asks of everyone (Q17, Q18): a lead's rules here may only tighten it. */}
      <p className="px-0.5 text-xs text-muted-foreground">{t("companyRules")}</p>
      <TeamRulesForm teamId={teamId} rules={rules} canManage={canManage} />
    </Section>
  );
}
