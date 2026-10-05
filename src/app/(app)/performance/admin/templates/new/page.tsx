import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageReviewTemplates, findReviewTemplate } from "@/modules/performance/service";
import { ReviewTemplateEditor, type TemplateDraft } from "@/modules/performance/ui/review-template-editor";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewTemplate");

// A blank form to start from: one scored question for both the person and their manager, and a
// three-point scale whose middle point is worth 100 %. `?from=<id>` starts from a copy instead.
const BLANK: TemplateDraft = {
  id: null,
  name: "",
  nameEn: null,
  description: null,
  kinds: [],
  isActive: true,
  sections: [{ key: "q1", title: "", titleEn: null, kind: "rating", weight: 1, required: true, askedOf: ["self", "manager"] }],
  ratingScale: [
    { value: 1, label: "", labelEn: null, scoreBp: 5000 },
    { value: 2, label: "", labelEn: null, scoreBp: 10000 },
    { value: 3, label: "", labelEn: null, scoreBp: 12000 },
  ],
};

/** A new review form (PRF-01): group HR only. */
export default async function NewReviewTemplatePage({ searchParams }: PageProps<"/performance/admin/templates/new">) {
  const user = await requireUser();
  if (!canManageReviewTemplates(user.principal)) notFound();
  const params = await searchParams;
  const [source, t] = await Promise.all([typeof params.from === "string" && /^[0-9a-f-]{36}$/.test(params.from) ? findReviewTemplate(params.from) : null, getTranslations("performance.reviews.templates")]);
  const draft: TemplateDraft = source
    ? { id: null, name: t("copyName", { name: source.name }), nameEn: source.nameEn, description: source.description, kinds: source.kinds, isActive: true, sections: source.sections, ratingScale: source.ratingScale }
    : BLANK;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/performance/admin/templates" className="text-sm text-link underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <h2>{source ? t("copyTitle", { name: source.name }) : t("new")}</h2>
      <ReviewTemplateEditor draft={draft} editable />
    </div>
  );
}
