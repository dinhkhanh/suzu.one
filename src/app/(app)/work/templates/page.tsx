import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listTemplatePlans, PROJECT_KINDS, type TemplatePlanRow } from "@/modules/projects/service";
import { TemplatePlanEditor, TemplateProjectForm } from "@/modules/projects/ui/template-forms";
import { checklistChoices, canAdminTeam, canManageTemplate, listAssignableByTeam, listCreateTargets, listTeams, listWorkTemplates, loadViewer, teamFacts } from "@/modules/work/service";
import { TemplateCard, TemplateCreateForm } from "@/modules/work/ui/planning-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("templates");

// Task and project templates (FR-WRK-10): shared ones and those of the viewer's teams. A project
// template also carries its plan half (FR-PJM-15): phases, milestones, register lines, hours by
// role and the brief — and a project made from it gets both halves and starts at the kick-off gate.
export default async function WorkTemplatesPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const [t, tWork, tProjects, teams, all, targets, checklists] = await Promise.all([getTranslations("work.templates"), getTranslations("work"), getTranslations("projects.templates"), listTeams(), listWorkTemplates(), listCreateTargets(viewer), checklistChoices()]);
  const teamOf = (id: string | null) => teams.find((team) => team.id === id);
  const canShare = canManageTemplate(viewer, null);
  const owners = teams.filter((team) => team.isActive && canAdminTeam(viewer, teamFacts(team)));
  // A team's templates are its own business: its members and whoever runs it.
  const templates = all.filter((template) => !template.ownerId || viewer.teamRoles.has(template.ownerId) || owners.some((team) => team.id === template.ownerId));
  const createTeams = targets.teams.filter((team) => team.canCreateProject);
  const peopleByTeam = Object.fromEntries(await listAssignableByTeam(createTeams.map((team) => team.id)));
  const plans = await listTemplatePlans(templates.filter((template) => template.purpose === "work_project").map((template) => template.id));
  const canManage = (ownerId: string | null) => (ownerId ? owners.some((team) => team.id === ownerId) : canShare);

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {tWork("title")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      <Section title={t("newProject")}>
        <div className="rounded-[14px] border border-border bg-background p-4">
        <TemplateProjectForm
          templates={templates.filter((template) => template.purpose === "work_project" && template.isActive && template.items.length > 0).map(({ id, name, ownerId, roleKeys }) => ({ id, name, ownerId, roleKeys }))}
          teams={createTeams.map(({ id, name, defaultVisibility }) => ({ id, name, defaultVisibility }))}
          peopleByTeam={peopleByTeam}
          today={todayInVietnam()}
        />
        </div>
      </Section>

      <Section title={t("library", { count: templates.length })}>
        {templates.map((template) => (
          <div key={template.id} className="flex flex-col gap-2">
            <TemplateCard
              template={{
                id: template.id,
                purpose: template.purpose,
                name: template.name,
                description: template.description,
                ownerId: template.ownerId,
                ownerName: teamOf(template.ownerId)?.name ?? null,
                isActive: template.isActive,
                canManage: canManage(template.ownerId),
                roleKeys: template.roleKeys,
                items: template.items.map(({ id, parentItemId, title, roleKey, dueOffsetDays, estimateMinutes, checklistIds }) => ({ id, parentItemId, title, roleKey, dueOffsetDays, estimateMinutes, checklistIds })),
              }}
              checklists={checklists}
            />
            {template.purpose === "work_project" && canManage(template.ownerId) ? <PlanParts templateId={template.id} plan={plans.get(template.id)} summary={tProjects("planParts", { phases: plans.get(template.id)?.phases.length ?? 0, milestones: plans.get(template.id)?.milestones.length ?? 0, lines: plans.get(template.id)?.deliverables.length ?? 0 })} /> : null}
          </div>
        ))}
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      </Section>

      {owners.length > 0 || canShare ? (
        <Section title={t("newTemplate")}>
          <div className="rounded-[14px] border border-border bg-background p-4">
            <TemplateCreateForm owners={owners.map(({ id, name }) => ({ id, name }))} canShare={canShare} />
          </div>
        </Section>
      ) : null}
    </Page>
  );
}

/** The plan half of a project template, folded away: most visits are about the steps. */
function PlanParts({ templateId, plan, summary }: { templateId: string; plan: TemplatePlanRow | undefined; summary: string }) {
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <div className="pt-4">
        <TemplatePlanEditor templateId={templateId} kinds={PROJECT_KINDS} values={{ kind: plan?.kind ?? "client", updateCadenceDays: plan?.updateCadenceDays ?? 7, phases: plan?.phases ?? [], milestones: plan?.milestones ?? [], deliverables: plan?.deliverables ?? [], budgetByRole: plan?.budgetByRole ?? [], brief: plan?.brief ?? {} }} />
      </div>
    </details>
  );
}
