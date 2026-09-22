// The tab bar shared by a project's task page (work) and its plan pages (projects), so people move
// between the work and the plan in one tap. Links, not state: every tab is its own page and checks
// access itself. Scrolls sideways on a phone rather than wrapping. The retainer tab is there only
// for a retainer project; a caller that does not know the project's kind (the work page) lets the
// tab bar look it up.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { planKindOf } from "../plans";

export const PROJECT_TABS = ["tasks", "overview", "plan", "timeline", "team", "deliverables", "budget", "updates", "risks", "meetings", "documents", "retainer", "changes", "acceptance", "reports", "close"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

const hrefOf = (projectId: string, tab: ProjectTab) => (tab === "tasks" ? `/work/projects/${projectId}` : tab === "overview" ? `/projects/${projectId}` : `/projects/${projectId}/${tab}`);

export async function ProjectTabs({ projectId, current, kind }: { projectId: string; current: ProjectTab; kind?: string }) {
  const t = await getTranslations("projects.tabs");
  const projectKind = kind ?? (await planKindOf(projectId));
  const tabs = PROJECT_TABS.filter((tab) => tab !== "retainer" || projectKind === "retainer");
  return (
    <nav aria-label={t("label")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border p-0.5 text-sm">
        {tabs.map((tab) => (
          <li key={tab}>
            <Link href={hrefOf(projectId, tab)} aria-current={tab === current ? "page" : undefined} className={`block rounded-md px-3 py-1 whitespace-nowrap ${tab === current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
              {t(tab)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
