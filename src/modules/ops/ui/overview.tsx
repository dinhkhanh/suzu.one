// Server-side pieces shared by the compliance dashboard, list, calendar and archive: the section
// tabs and the filter bar. Filters are plain GET forms and links — every view is a URL (FR-OPS-07).
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AUTHORITIES, OBLIGATION_CATEGORIES } from "../enums";

export const OPS_SECTIONS = ["dashboard", "list", "calendar", "history", "library"] as const;
export type OpsSection = (typeof OPS_SECTIONS)[number];
const SECTION_HREF: Record<OpsSection, string> = { dashboard: "/ops", list: "/ops/list", calendar: "/ops/calendar", history: "/ops/history", library: "/ops/templates" };

export async function OpsNav({ active, reads }: { active: OpsSection; /** Without an ops role only the list (what is theirs) is open. */ reads: boolean }) {
  const t = await getTranslations("ops.nav");
  const sections = reads ? OPS_SECTIONS : (["list"] as const);
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b pb-2">
      {sections.map((section) => (
        <Link key={section} href={SECTION_HREF[section]} className={`rounded-md px-2 py-1 text-sm ${section === active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>
          {t(section)}
        </Link>
      ))}
    </nav>
  );
}

export type OverviewQuery = { authority: string | null; category: string | null; ownerId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Reads the three shared filters from a page's search params; anything unknown is dropped. */
export function overviewQuery(params: Record<string, string | string[] | undefined>): OverviewQuery {
  const authority = typeof params.authority === "string" && (AUTHORITIES as readonly string[]).includes(params.authority) ? params.authority : null;
  const category = typeof params.category === "string" && (OBLIGATION_CATEGORIES as readonly string[]).includes(params.category) ? params.category : null;
  return { authority, category, ownerId: isUuid(params.owner) ? params.owner : null };
}

export function overviewParams(query: OverviewQuery, extra: Record<string, string | null | undefined> = {}): string {
  const search = new URLSearchParams();
  if (query.authority) search.set("authority", query.authority);
  if (query.category) search.set("category", query.category);
  if (query.ownerId) search.set("owner", query.ownerId);
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value);
  return search.size ? `?${search}` : "";
}

export async function OverviewFilters({ action, query, owners, hidden = {} }: { action: string; query: OverviewQuery; owners: { id: string; name: string }[]; /** Params of the page that must survive applying a filter (month, entity…). */ hidden?: Record<string, string | null | undefined> }) {
  const t = await getTranslations("ops");
  const dirty = !!(query.authority || query.category || query.ownerId);
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2 text-sm">
      {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("filters.authority")}</span>
        <Select name="authority" defaultValue={query.authority ?? ""} className="w-44">
          <option value="">{t("filters.all")}</option>
          {AUTHORITIES.map((authority) => (
            <option key={authority} value={authority}>
              {t(`enums.authority.${authority}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("filters.category")}</span>
        <Select name="category" defaultValue={query.category ?? ""} className="w-36">
          <option value="">{t("filters.all")}</option>
          {OBLIGATION_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`enums.category.${category}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("filters.owner")}</span>
        <Select name="owner" defaultValue={query.ownerId ?? ""} className="w-48">
          <option value="">{t("filters.all")}</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="sm" variant="outline">
        {t("filters.apply")}
      </Button>
      {dirty ? (
        <Link href={`${action}${overviewParams({ authority: null, category: null, ownerId: null }, hidden)}`} className="pb-1.5 text-xs underline">
          {t("filters.clear")}
        </Link>
      ) : null}
    </form>
  );
}
