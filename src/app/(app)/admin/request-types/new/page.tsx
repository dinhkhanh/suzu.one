import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { listRequestTypes } from "@/modules/requests/service";
import { TypeDesigner } from "@/modules/requests/ui/type-designer";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newRequestType");

export default async function NewRequestTypePage() {
  const user = await requireUser();
  if (!canManageRequestTypes(user.principal)) notFound();
  const t = await getTranslations("requests.designer");
  const [entities, types] = await Promise.all([listEntities(), listRequestTypes()]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <Link href="/admin/request-types" className="text-sm text-link hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("add")}</h1>
        <p className="text-sm text-muted-foreground">{t("addHint")}</p>
      </header>
      <TypeDesigner
        draft={{ id: null, code: "", nameVi: "", nameEn: "", descriptionVi: null, descriptionEn: null, category: "other", entityId: null, icon: null, sortOrder: 0, active: true, slaRemindAfterDays: 0, slaEscalateAfterDays: 0, slaEscalateTo: null, form: { fields: [] }, followUps: [], standalone: true }}
        entities={entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }))}
        canGroup={can(user.principal, "org:manage", {})}
        catalogue={types.map((row) => ({ code: row.code, nameVi: row.nameVi, nameEn: row.nameEn, followUps: row.followUps }))}
      />
    </div>
  );
}
