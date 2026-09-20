// The documents panel on a person's record (FR-CHR-06). A server component, and every decision
// it makes is a re-run of the policy: the template list offers only what this viewer may issue
// for this person, and the history lists only what they may open. A salary letter about somebody
// is invisible — not greyed out — to a reader without the compensation tier, because knowing one
// exists is itself worth something.
import { getTranslations } from "next-intl/server";
import { getPersonTarget } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { canGenerate, listDocumentsAbout, listTemplates } from "../service";
import { GenerateDocumentForm } from "./generate-form";

export async function PersonDocuments({ principal, personId }: { principal: Principal; personId: string }) {
  const subject = await getPersonTarget(personId);
  if (!subject) return null;

  const [templates, t, kinds, tiers] = await Promise.all([listTemplates(), getTranslations("documents"), getTranslations("documents.kind"), getTranslations("documents.tier")]);
  const mine = templates.filter((template) => template.isActive && (!template.entityId || template.entityId === subject.entityId) && canGenerate(principal, subject, template.tier));
  const history = await listDocumentsAbout(personId, principal);

  // Nothing to issue and nothing issued that they may see: the panel is not theirs at all.
  if (mine.length === 0 && history.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("heading")}</h2>

      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">{t("columns.number")}</th>
                <th className="p-2 font-medium">{t("columns.template")}</th>
                <th className="p-2 font-medium">{t("columns.tier")}</th>
                <th className="p-2 font-medium">{t("columns.by")}</th>
                <th className="p-2 font-medium">{t("columns.at")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{row.number}</td>
                  <td className="p-2">
                    {row.templateName}
                    <span className="ml-1 text-xs text-muted-foreground">({kinds(row.kind)})</span>
                  </td>
                  <td className="p-2 text-xs">{tiers(row.tier)}</td>
                  <td className="p-2">{row.generatedByName ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap text-xs">{row.createdAt.toLocaleDateString("vi-VN")}</td>
                  <td className="p-2 text-right">
                    <a href={`/documents/${row.id}/pdf`} className="text-sm underline">
                      {t("download")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GenerateDocumentForm subjectPersonId={personId} templates={mine.map((template) => ({ id: template.id, name: template.name, kind: template.kind }))} />
    </section>
  );
}
