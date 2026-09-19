// Section tabs of the performance module. Week 2 adds the KPI sections here.
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const PERFORMANCE_SECTIONS = ["mine", "alignment"] as const;
export type PerformanceSection = (typeof PERFORMANCE_SECTIONS)[number];
const SECTION_HREF: Record<PerformanceSection, string> = { mine: "/performance", alignment: "/performance/goals" };

export async function PerformanceNav({ active, year }: { active: PerformanceSection | null; year?: number }) {
  const t = await getTranslations("performance.nav");
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b pb-2">
      {PERFORMANCE_SECTIONS.map((section) => (
        <Link key={section} href={`${SECTION_HREF[section]}${year ? `?year=${year}` : ""}`} className={`rounded-md px-2 py-1 text-sm ${section === active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
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
