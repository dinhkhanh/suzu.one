import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { LifecycleTemplates } from "@/modules/core-hr/ui/lifecycle-templates";
import { requireUser } from "@/modules/platform/auth/session";
import { orgUnitOptions } from "@/modules/platform/org/service";
import { canManageTemplates } from "@/modules/platform/tasks-engine/policy";
import { canKeepChecklists, canManageChecklist, canUseChecklists, checklistOwners, checklistUsage, listChecklists, listTeams, loadViewer, teamFacts } from "@/modules/work/service";
import { type ChecklistCard, ChecklistLibrary, type OwnerChoice } from "@/modules/work/ui/checklists";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("checklists");

// Checklists: the library every department keeps and hooks into its work (stages, hand-off
// packages, intake forms, template steps, tasks) — open to the whole company — and, for HR, the
// onboarding and offboarding templates whose steps become assigned tasks.
export default async function ChecklistsPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const hr = canManageTemplates(user.principal);
  if (!canUseChecklists(viewer) && !hr) notFound();
  const t = await getTranslations("checklists");

  const [rows, usage, units, teams] = await Promise.all([listChecklists(), checklistUsage(), orgUnitOptions({ activeOnly: true }), listTeams()]);
  const owners = await checklistOwners(rows);
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const none = { stages: 0, packages: 0, forms: 0, steps: 0 };

  const cards: ChecklistCard[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    owner: row.ownerUnitId ? `unit:${row.ownerUnitId}` : row.ownerTeamId ? `team:${row.ownerTeamId}` : "",
    ownerName: row.ownerUnitId ? (unitName.get(row.ownerUnitId) ?? null) : row.ownerTeamId ? t("library.teamOwner", { name: teamName.get(row.ownerTeamId) ?? "—" }) : null,
    items: row.items,
    isActive: row.isActive,
    canManage: canManageChecklist(viewer, owners.get(row)!),
    usage: usage.get(row.id) ?? none,
  }));
  // Where this viewer may file a new checklist: the company, the units their grants reach, the teams they run.
  const ownerChoices: OwnerChoice[] = canKeepChecklists(viewer)
    ? [
        ...(canManageChecklist(viewer, { unit: null, team: null }) ? [{ value: "", name: t("library.companyWide") }] : []),
        ...units.filter((unit) => canManageChecklist(viewer, { unit: { id: unit.id, entityId: unit.entityId, path: unit.path }, team: null })).map((unit) => ({ value: `unit:${unit.id}`, name: `${"— ".repeat(unit.depth)}${unit.name}` })),
        ...teams.filter((team) => team.isActive && canManageChecklist(viewer, { unit: null, team: teamFacts(team) })).map((team) => ({ value: `team:${team.id}`, name: t("library.teamOwner", { name: team.name }) })),
      ]
    : [];

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1>{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </header>
      {canUseChecklists(viewer) ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-medium">{t("library.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("library.description")}</p>
          </div>
          <ChecklistLibrary checklists={cards} owners={ownerChoices} canCreate={ownerChoices.length > 0} />
        </section>
      ) : null}
      {hr ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-medium">{t("title")}</h2>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <LifecycleTemplates principal={user.principal} />
        </section>
      ) : null}
    </div>
  );
}
