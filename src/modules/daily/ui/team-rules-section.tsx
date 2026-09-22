// The "Daily rules" section of a team's page: a server component, so the team page only places it.
import { getTranslations } from "next-intl/server";
import { getTeamRules } from "../team-rules";
import { TeamRulesForm } from "./team-rules-form";

export async function DailyRulesSection({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const [t, rules] = await Promise.all([getTranslations("daily.rules"), getTeamRules(teamId)]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <TeamRulesForm teamId={teamId} rules={rules} canManage={canManage} />
    </section>
  );
}
