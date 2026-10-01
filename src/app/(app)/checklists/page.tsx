import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { LifecycleTemplates } from "@/modules/core-hr/ui/lifecycle-templates";
import { requireUser } from "@/modules/platform/auth/session";
import { orgUnitOptions } from "@/modules/platform/org/service";
import { canManageTemplates } from "@/modules/platform/tasks-engine/policy";
import { canKeepChecklists, canManageChecklist, canUseChecklists, checklistOwners, checklistUsage, listChecklists, listTeams, loadViewer, teamFacts } from "@/modules/work/service";
import { type ChecklistCard, ChecklistLibrary, type OwnerChoice } from "@/modules/work/ui/checklists";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("checklists");

const TABS = ["library", "lifecycle"] as const;
type Tab = (typeof TABS)[number];

// Checklists: the library every department keeps and hooks into its work (stages, hand-off
// packages, intake forms, template steps, tasks) — open to the whole company — and, for HR, the
// onboarding and offboarding templates whose steps become assigned tasks. Two tabs, in the URL.
export default async function ChecklistsPage({ searchParams }: PageProps<"/checklists">) {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const hr = canManageTemplates(user.principal);
  const library = canUseChecklists(viewer);
  if (!library && !hr) notFound();
  const t = await getTranslations("checklists");
  const params = await searchParams;
  const tabs = TABS.filter((tab) => (tab === "library" ? library : hr));
  const tab: Tab = tabs.includes(params.tab as Tab) ? (params.tab as Tab) : tabs[0];

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
    <Page>
      <PageHeader title={t("pageTitle")} description={t("pageDescription")}>
        {tabs.length > 1 ? (
          <nav aria-label={t("tabs.label")} className="tab-row -mx-4 mt-2 px-4 md:mx-0 md:px-0">
            {tabs.map((each) => (
              <Link key={each} href={each === tabs[0] ? "/checklists" : `/checklists?tab=${each}`} aria-current={each === tab ? "page" : undefined}>
                {t(`tabs.${each}`)}
                <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{each === "library" ? cards.length : null}</span>
              </Link>
            ))}
          </nav>
        ) : null}
      </PageHeader>
      {tab === "library" ? (
        <Section title={t("library.title")}>
          <ChecklistLibrary checklists={cards} owners={ownerChoices} canCreate={ownerChoices.length > 0} />
        </Section>
      ) : (
        <Section title={t("title")}>
          <p className="-mt-1 px-0.5 text-sm text-muted-foreground">{t("description")}</p>
          <LifecycleTemplates principal={user.principal} />
        </Section>
      )}
    </Page>
  );
}
