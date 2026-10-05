import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageReviewTemplates, listReviewTemplates } from "@/modules/performance/service";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewTemplates");

/**
 * The review forms (FR-PRF-03, PRF-01): what a cycle asks and what its answers are worth. Anybody
 * who builds cycles reads them here; only group HR (`performance:manage` group-wide) changes them.
 * A cycle that has been launched keeps the form it was launched with.
 */
export default async function ReviewTemplatesPage() {
  const user = await requireUser();
  const [templates, t, tCycle] = await Promise.all([listReviewTemplates(), getTranslations("performance.reviews"), getTranslations("performance.reviews.cycle")]);
  const editable = canManageReviewTemplates(user.principal);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("admin.templateHint")}</p>
      <TableCard>
        <TableCardHeader title={t("admin.templates")} count={templates.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.template")}</TableHead>
              <TableHead kind="text">{t("templates.kinds")}</TableHead>
              <TableHead kind="number">{t("columns.questions")}</TableHead>
              <TableHead kind="number">{t("columns.scale")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
              {editable ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? <TableEmpty>{t("admin.noTemplates")}</TableEmpty> : null}
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell>
                  <Link href={`/performance/admin/templates/${template.id}`} className="font-medium underline-offset-4 hover:underline">
                    {template.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{template.kinds.length === 0 ? t("templates.allKinds") : template.kinds.map((kind) => tCycle(`kinds.${kind}`)).join(", ")}</TableCell>
                <TableCell kind="number">{template.sections.length}</TableCell>
                <TableCell kind="number">{template.ratingScale.length}</TableCell>
                <TableCell>{!template.isActive ? <Badge variant="outline">{t("admin.inactive")}</Badge> : null}</TableCell>
                {editable ? (
                  <TableCell kind="actions">
                    <Link href={`/performance/admin/templates/new?from=${template.id}`} className="text-sm underline-offset-4 hover:underline">
                      {t("templates.copy")}
                    </Link>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {editable ? <TableAddRow label={t("templates.new")} href="/performance/admin/templates/new" /> : null}
      </TableCard>
    </div>
  );
}
