// Section tabs of the performance module: goals (week 1) and KPIs (week 2). What is shown follows
// what the viewer may open — cosmetic only; every page checks again.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { can } from "../../platform/rbac/policy";
import { getCurrentUser } from "../../platform/auth/session";
import { hasReports } from "../people";
import { canOpenKpiAdmin, canOpenOverview } from "../policy";

export const PERFORMANCE_SECTIONS = ["mine", "alignment", "kpis", "reviews", "team", "overview", "admin"] as const;
export type PerformanceSection = (typeof PERFORMANCE_SECTIONS)[number];
const SECTION_HREF: Record<PerformanceSection, string> = { mine: "/performance", alignment: "/performance/goals", kpis: "/performance/kpis", team: "/performance/team", overview: "/performance/overview", admin: "/performance/admin/periods", reviews: "/performance/reviews" };
// Goal pages carry the year along; the KPI pages pick their own month.
const TAKES_YEAR: readonly PerformanceSection[] = ["mine", "alignment"];

export async function PerformanceNav({ active, year }: { active: PerformanceSection | null; year?: number }) {
  const [t, user] = await Promise.all([getTranslations("performance.nav"), getCurrentUser()]);
  const principal = user?.principal;
  const shown = {
    mine: true,
    alignment: true,
    kpis: true,
    // Everyone has reviews of their own, or owes one; the page itself shows what there is.
    reviews: true,
    team: !!principal && !!user && (can(principal, "performance:read") || can(principal, "performance:manage") || (await hasReports(user.person.id))),
    overview: !!principal && canOpenOverview(principal),
    admin: !!principal && canOpenKpiAdmin(principal),
  } satisfies Record<PerformanceSection, boolean>;
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b pb-2">
      {PERFORMANCE_SECTIONS.filter((section) => shown[section]).map((section) => (
        <Link key={section} href={`${SECTION_HREF[section]}${year && TAKES_YEAR.includes(section) ? `?year=${year}` : ""}`} className={`rounded-md px-2 py-1 text-sm ${section === active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
          {t(section)}
        </Link>
      ))}
    </nav>
  );
}

/** The years on offer: last year, this one and the next (goals for 2027 are set in 2026). */
export const yearChoices = (today: string): number[] => {
  const current = Number(today.slice(0, 4));
  return [current - 1, current, current + 1];
};

export function readYear(value: unknown, today: string): number {
  const year = typeof value === "string" && /^\d{4}$/.test(value) ? Number(value) : Number(today.slice(0, 4));
  return year >= 2000 && year <= 2100 ? year : Number(today.slice(0, 4));
}
