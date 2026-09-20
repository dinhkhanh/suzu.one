import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { listRequestTypes } from "@/modules/requests/service";

export const metadata: Metadata = { title: "Request types" };

// The catalogue an administrator designs (FR-REQ-01). A type's flow lives on its own page, edited
// by the approval engine's editor.
export default async function RequestTypesPage() {
  const user = await requireUser();
  if (!canManageRequestTypes(user.principal)) notFound();
  const t = await getTranslations("requests.designer");
  const locale = await getLocale();
  const [types, entities] = await Promise.all([listRequestTypes(), listEntities()]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/admin/request-types/new" className={buttonVariants({ size: "sm" })}>
          {t("add")}
        </Link>
      </header>
      {types.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border">
        {types.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/request-types/${type.id}`} className="text-sm font-medium hover:underline">
                {locale === "en" ? type.nameEn : type.nameVi}
              </Link>
              <p className="text-xs text-muted-foreground">
                <code>{type.code}</code> · {t("fieldCount", { count: type.form.fields.length })}
                {type.slaRemindAfterDays > 0 ? ` · ${t("remindsAfter", { days: type.slaRemindAfterDays })}` : ""}
              </p>
            </div>
            <Badge variant="secondary">{type.entityId ? (entityName.get(type.entityId) ?? "—") : t("wholeGroup")}</Badge>
            {type.active ? null : <Badge variant="outline">{t("off")}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
