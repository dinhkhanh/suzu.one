// The documents panel on a person's record (FR-CHR-06). A server component, and every decision
// it makes is a re-run of the policy: the template list offers only what this viewer may issue
// for this person, and the history lists only what they may open. A salary letter about somebody
// is invisible — not greyed out — to a reader without the compensation tier, because knowing one
// exists is itself worth something.
import { getTranslations } from "next-intl/server";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
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
    <TableCard>
      <TableCardHeader title={t("heading")} count={history.length || null} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="id">{t("columns.number")}</TableHead>
            <TableHead kind="text">{t("columns.template")}</TableHead>
            <TableHead kind="select">{t("columns.tier")}</TableHead>
            <TableHead kind="person">{t("columns.by")}</TableHead>
            <TableHead kind="date">{t("columns.at")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {history.map((row) => (
            <TableRow key={row.id}>
              <TableCell kind="id">{row.number}</TableCell>
              <TableCell>
                {row.templateName}
                <span className="ml-1 text-xs text-muted-foreground">({kinds(row.kind)})</span>
              </TableCell>
              <TableCell>{tiers(row.tier)}</TableCell>
              <TableCell>{row.generatedByName ? <RecordLink kind="person" id={row.generatedByPersonId}>{row.generatedByName}</RecordLink> : "—"}</TableCell>
              <TableCell>{row.createdAt.toLocaleDateString("vi-VN")}</TableCell>
              <TableCell kind="actions">
                <a href={`/documents/${row.id}/pdf`} className="text-sm underline">
                  {t("download")}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TableAddRow label={t("new")} open={history.length === 0}>
        <GenerateDocumentForm subjectPersonId={personId} templates={mine.map((template) => ({ id: template.id, name: template.name, kind: template.kind }))} />
      </TableAddRow>
    </TableCard>
  );
}
