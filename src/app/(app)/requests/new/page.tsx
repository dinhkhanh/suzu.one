import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { getPersonTarget } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listAvailableTypes } from "@/modules/requests/service";
import { REQUEST_CATEGORIES } from "@/modules/requests/enums";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newRequest");

// The picker. Only types that are switched on and belong to the person's entity (or the group).
export default async function NewRequestPage() {
  const user = await requireUser();
  const [t, locale, target] = await Promise.all([getTranslations("requests"), getLocale(), getPersonTarget(user.person.id)]);
  // The catalogue comes from the shared cache: no second round trip to the database.
  const types = await listAvailableTypes(target?.entityId ?? null);
  const byCategory = Map.groupBy(types, (type) => type.category);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <Link href="/requests" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("new")}</h1>
        <p className="text-sm text-muted-foreground">{t("newDescription")}</p>
      </header>
      {types.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTypes")}</p> : null}
      {REQUEST_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t(`designer.categories.${category}` as "designer.categories.other")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(byCategory.get(category) ?? []).map((type) => (
              <li key={type.id}>
                <Link href={`/requests/new/${type.code}`} className="flex h-full flex-col gap-1 rounded-xl border p-4 hover:bg-accent">
                  <span className="text-sm font-medium">{locale === "en" ? type.nameEn : type.nameVi}</span>
                  <span className="text-xs text-muted-foreground">{(locale === "en" ? type.descriptionEn : type.descriptionVi) ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
