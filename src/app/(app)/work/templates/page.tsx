import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canAdminTeam, canManageTemplate, listAssignableByTeam, listCreateTargets, listTeams, listWorkTemplates, loadViewer, teamFacts } from "@/modules/work/service";
import { TemplateCard, TemplateCreateForm, TemplateUseForm } from "@/modules/work/ui/planning-forms";

export const metadata: Metadata = { title: "Templates" };

// Task and project templates (FR-WRK-10): shared ones and those of the viewer's teams.
export default async function WorkTemplatesPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const [t, tWork, teams, all, targets] = await Promise.all([getTranslations("work.templates"), getTranslations("work"), listTeams(), listWorkTemplates(), listCreateTargets(viewer)]);
  const teamOf = (id: string | null) => teams.find((team) => team.id === id);
  const canShare = canManageTemplate(viewer, null);
  const owners = teams.filter((team) => team.isActive && canAdminTeam(viewer, teamFacts(team)));
  // A team's templates are its own business: its members and whoever runs it.
  const templates = all.filter((template) => !template.ownerId || viewer.teamRoles.has(template.ownerId) || owners.some((team) => team.id === template.ownerId));
  const createTeams = targets.teams.filter((team) => team.canCreateProject);
  const peopleByTeam = Object.fromEntries(await listAssignableByTeam(createTeams.map((team) => team.id)));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {tWork("title")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{t("newProject")}</h2>
        <TemplateUseForm
          templates={templates.filter((template) => template.isActive && template.items.length > 0).map(({ id, name, ownerId, roleKeys }) => ({ id, name, ownerId, roleKeys }))}
          teams={createTeams.map(({ id, name, defaultVisibility }) => ({ id, name, defaultVisibility }))}
          peopleByTeam={peopleByTeam}
          today={todayInVietnam()}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("library", { count: templates.length })}</h2>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={{
              id: template.id,
              purpose: template.purpose,
              name: template.name,
              description: template.description,
              ownerId: template.ownerId,
              ownerName: teamOf(template.ownerId)?.name ?? null,
              isActive: template.isActive,
              canManage: template.ownerId ? owners.some((team) => team.id === template.ownerId) : canShare,
              roleKeys: template.roleKeys,
              items: template.items.map(({ id, parentItemId, title, roleKey, dueOffsetDays, estimateMinutes }) => ({ id, parentItemId, title, roleKey, dueOffsetDays, estimateMinutes })),
            }}
          />
        ))}
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      </section>

      {owners.length > 0 || canShare ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("newTemplate")}</h2>
          <TemplateCreateForm owners={owners.map(({ id, name }) => ({ id, name }))} canShare={canShare} />
        </section>
      ) : null}
    </div>
  );
}
