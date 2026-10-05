import { getLocale, getTranslations } from "next-intl/server";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { listPublicOpenings } from "@/modules/recruit/public";
import { CareersOpenings, type CareersCard } from "@/modules/recruit/ui/careers-openings";

// Every job on offer. The only identifiers on this page are opaque slugs.
export default async function CareersPage() {
  const t = await getTranslations("recruit.careers");
  const locale = await getLocale();
  const openings = await listPublicOpenings();

  // Only what a card prints crosses to the browser: not the requirements, the salary or the form's questions.
  const cards: CareersCard[] = openings.map((opening) => {
    const workMode = t(`workMode.${opening.workMode}` as "workMode.onsite");
    return {
      slug: opening.slug,
      title: locale === "en" && opening.titleEn ? opening.titleEn : opening.title,
      company: opening.entityName,
      department: opening.departmentName,
      summary: noteToPlainText(opening.description).slice(0, 240),
      place: opening.workLocation ? `${opening.workLocation} · ${workMode}` : workMode,
      employment: t(`employmentType.${opening.employmentType}` as "employmentType.employee"),
    };
  });

  return (
    <div className="flex flex-col gap-12 py-8 md:gap-16 md:py-16">
      <header className="flex flex-col gap-4 text-center md:gap-5">
        <h1 className="text-[1.875rem] leading-[2.375rem] font-semibold md:text-4xl md:leading-[2.75rem] md:tracking-[-0.02em]">{t("title")}</h1>
        <p className="text-lg text-muted-foreground md:text-xl">{t("intro")}</p>
      </header>
      <CareersOpenings cards={cards} />
    </div>
  );
}
