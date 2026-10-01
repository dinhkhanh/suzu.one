// The tab bar shared by a project's task page (work) and its plan pages (projects), so people move
// between the work and the plan in one tap. Links, not state: every tab is its own page and checks
// access itself. The design's `.tab-row`: underlined, the open one in ink, scrolls sideways on a
// phone rather than wrapping. The retainer tab is there only for a retainer project; a caller that
// does not know the project's kind (the work page) lets the tab bar look it up. The kanban board is
// the task page in its board view, with a tab of its own.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { planKindOf } from "../plans";

export const PROJECT_TABS = ["overview", "tasks", "board", "plan", "timeline", "deliverables", "budget", "team", "updates", "risks", "meetings", "documents", "retainer", "changes", "acceptance", "reports", "close"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

const hrefOf = (projectId: string, tab: ProjectTab) => (tab === "tasks" ? `/work/projects/${projectId}` : tab === "board" ? `/work/projects/${projectId}?view=board` : tab === "overview" ? `/projects/${projectId}` : `/projects/${projectId}/${tab}`);

export async function ProjectTabs({ projectId, current, kind }: { projectId: string; current: ProjectTab; kind?: string }) {
  const t = await getTranslations("projects.tabs");
  const projectKind = kind ?? (await planKindOf(projectId));
  const tabs = PROJECT_TABS.filter((tab) => tab !== "retainer" || projectKind === "retainer");
  return (
    <nav aria-label={t("label")} className="tab-row -mx-4 px-4 md:mx-0 md:px-0">
      {tabs.map((tab) => (
        <Link key={tab} href={hrefOf(projectId, tab)} aria-current={tab === current ? "page" : undefined}>
          {t(tab)}
        </Link>
      ))}
    </nav>
  );
}
