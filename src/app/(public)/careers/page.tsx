import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { listPublicOpenings } from "@/modules/recruit/public";

// Every job on offer. The only identifiers on this page are opaque slugs.
export default async function CareersPage() {
  const t = await getTranslations("recruit.careers");
  const locale = await getLocale();
  const openings = await listPublicOpenings();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      {openings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noOpenings")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {openings.map((opening) => (
            <li key={opening.slug} className="flex flex-col gap-1 p-4">
              <Link href={`/careers/${opening.slug}`} className="text-base font-medium hover:underline">
                {locale === "en" && opening.titleEn ? opening.titleEn : opening.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {[opening.entityName, opening.departmentName, opening.workLocation, t(`workMode.${opening.workMode}` as "workMode.onsite"), t(`employmentType.${opening.employmentType}` as "employmentType.employee")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
