"use client";

import { ArrowUpRight, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";

/** One card on the careers page. Only text written for strangers, and the opaque slug. */
export type CareersCard = {
  slug: string;
  title: string;
  company: string;
  department: string | null;
  summary: string;
  place: string;
  employment: string;
};

const ALL = "__all__";

// The company badge is a category, not a state: a hue per company, the same one on every visit.
const HUES: BadgeVariant[] = ["info", "pink", "success", "indigo", "orange", "violet", "teal"];
const hueOf = (name: string) => HUES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];

/**
 * The open roles as cards, narrowed by department: a row of tabs on a wide screen, a select on a
 * phone. Filtering is in the browser — the whole list is already on the page and is small.
 */
export function CareersOpenings({ cards }: { cards: CareersCard[] }) {
  const t = useTranslations("recruit.careers");
  const [department, setDepartment] = useState(ALL);
  const departments = [...new Set(cards.flatMap((card) => (card.department ? [card.department] : [])))].sort((a, b) => a.localeCompare(b));
  const shown = department === ALL ? cards : cards.filter((card) => card.department === department);
  const options = [{ value: ALL, label: t("allDepartments") }, ...departments.map((name) => ({ value: name, label: name }))];

  return (
    <div className="flex flex-col gap-8 md:gap-12">
      {departments.length > 1 ? (
        <>
          <Select className="md:hidden" aria-label={t("filterDepartment")} value={department} onChange={(event) => setDepartment(event.target.value)}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="hidden justify-center md:flex">
            <Segmented aria-label={t("filterDepartment")} options={options} value={department} onChange={setDepartment} className="max-w-full overflow-x-auto" />
          </div>
        </>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">{t("noOpenings")}</p>
      ) : (
        <ul className="flex flex-col gap-4 md:gap-6">
          {shown.map((card) => (
            <li key={card.slug}>
              <OpeningCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpeningCard({ card }: { card: CareersCard }) {
  const t = useTranslations("recruit.careers");
  const href = `/careers/${card.slug}`;
  const badge = (
    <Badge dot variant={hueOf(card.company)}>
      {card.company}
    </Badge>
  );
  return (
    <article className="relative flex flex-col gap-5 rounded-2xl border border-border bg-background p-6 transition-colors hover:border-foreground/20">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Phone: the department and the badge share the first line, the title gets its own. */}
            <div className="flex min-h-7 items-center gap-2 md:min-h-5">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-link">{card.department ?? card.company}</p>
              <span className="md:hidden">{badge}</span>
            </div>
            <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-base font-semibold text-foreground">
                {/* The whole card is the link; the title carries its name for screen readers. */}
                <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
                  {card.title}
                </Link>
              </h2>
              <span className="hidden md:inline-flex">{badge}</span>
            </div>
          </div>
          <span aria-hidden className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-link md:flex">
            {t("viewJob")}
            <ArrowUpRight className="size-5" />
          </span>
        </div>
        {card.summary ? <p className="line-clamp-2 text-base text-muted-foreground">{card.summary}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin aria-hidden className="size-5 shrink-0 text-faint" />
          {card.place}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock aria-hidden className="size-5 shrink-0 text-faint" />
          {card.employment}
        </span>
      </div>
    </article>
  );
}
