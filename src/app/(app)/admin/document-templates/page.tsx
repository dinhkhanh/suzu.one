import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates, canReadTemplates, listTemplates, tierNeededFor } from "@/modules/documents/service";

export const metadata: Metadata = { title: "Mẫu văn bản" };

// The template library (FR-CHR-06). Writing templates is HR's; the tier on each is enforced by
// the engine, so this screen only has to show it.
export default async function DocumentTemplatesPage() {
  const user = await requireUser();
  if (!canReadTemplates(user.principal)) notFound();

  const [rows, t, tiers, kinds] = await Promise.all([listTemplates(), getTranslations("documents.designer"), getTranslations("documents.tier"), getTranslations("documents.kind")]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canManageTemplates(user.principal) ? (
          <Link href="/admin/document-templates/new" className="h-9 rounded-md bg-primary px-3 text-sm font-medium leading-9 text-primary-foreground">
            {t("new")}
          </Link>
        ) : null}
      </header>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">{t("code")}</th>
              <th className="p-2 font-medium">{t("name")}</th>
              <th className="p-2 font-medium">{t("kind")}</th>
              <th className="p-2 font-medium">{t("entity")}</th>
              <th className="p-2 font-medium">{t("tier")}</th>
              <th className="p-2 font-medium">{t("version")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-t ${row.isActive ? "" : "text-muted-foreground"}`}>
                <td className="p-2 font-mono text-xs">
                  <Link href={`/admin/document-templates/${row.id}`} className="hover:underline">
                    {row.code}
                  </Link>
                </td>
                <td className="p-2">{row.name}</td>
                <td className="p-2">{kinds(row.kind)}</td>
                <td className="p-2">{row.entityName ?? t("groupWide")}</td>
                <td className="p-2">
                  {tiers(row.tier)}
                  {/* What the body actually demands, so a mismatch is visible at a glance. */}
                  {row.tier !== tierNeededFor(row.body) ? <span className="ml-1 text-xs text-muted-foreground">({t("needs")} {tiers(tierNeededFor(row.body))})</span> : null}
                </td>
                <td className="p-2 tabular-nums">v{row.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
