import { getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { ChevronRightIcon } from "lucide-react";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
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
    <Page width="narrow">
      <PageHeader eyebrow={t("hub")} title={t("new")} description={t("newDescription")} />
      {types.length === 0 ? (
        <List>
          <ListEmpty>{t("noTypes")}</ListEmpty>
        </List>
      ) : null}
      {REQUEST_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => (
        <Section key={category} title={t(`designer.categories.${category}` as "designer.categories.other")}>
          <List>
            {(byCategory.get(category) ?? []).map((type, index) => (
              <ListItem key={type.id} href={`/requests/new/${type.code}`} className="rise" style={{ "--i": index } as CSSProperties}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{locale === "en" ? type.nameEn : type.nameVi}</span>
                  {(locale === "en" ? type.descriptionEn : type.descriptionVi) ? <span className="text-xs text-muted-foreground">{locale === "en" ? type.descriptionEn : type.descriptionVi}</span> : null}
                </span>
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-faint" />
              </ListItem>
            ))}
          </List>
        </Section>
      ))}
    </Page>
  );
}
