// Issued papers as a table: the register (`/documents`) with whom each is about, and a person's
// own letters on `/me` without. A server component; the rows arrive already narrowed to what the
// reader may open (`listIssuedDocuments`, `listDocumentsAbout`), and each opens through the PDF
// route, which checks again.
import { getFormatter, getTranslations } from "next-intl/server";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DocumentListRow } from "../service";

export async function IssuedDocumentsTable({ rows, title, empty, showSubject = false }: { rows: DocumentListRow[]; title: string; empty: string; showSubject?: boolean }) {
  const [t, kinds, tiers, format] = await Promise.all([getTranslations("documents"), getTranslations("documents.kind"), getTranslations("documents.tier"), getFormatter()]);
  return (
    <TableCard>
      <TableCardHeader title={title} count={rows.length || null} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="id">{t("columns.number")}</TableHead>
            <TableHead kind="text">{t("columns.template")}</TableHead>
            {showSubject ? <TableHead kind="person">{t("columns.subject")}</TableHead> : null}
            <TableHead kind="select">{t("columns.tier")}</TableHead>
            {showSubject ? <TableHead kind="person">{t("columns.by")}</TableHead> : null}
            <TableHead kind="date">{t("columns.at")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{empty}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell kind="id">{row.number}</TableCell>
              <TableCell>
                {row.templateName}
                <span className="ml-1 text-xs text-muted-foreground">({kinds(row.kind)})</span>
              </TableCell>
              {showSubject ? (
                <TableCell>
                  <RecordLink kind="person" id={row.subjectPersonId}>
                    {row.subjectName}
                  </RecordLink>
                </TableCell>
              ) : null}
              <TableCell>{tiers(row.tier)}</TableCell>
              {showSubject ? <TableCell>{row.generatedByName ? <RecordLink kind="person" id={row.generatedByPersonId}>{row.generatedByName}</RecordLink> : "—"}</TableCell> : null}
              <TableCell>{format.dateTime(row.createdAt, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" })}</TableCell>
              <TableCell kind="actions">
                <a href={`/documents/${row.id}/pdf`} className="text-sm underline">
                  {t("download")}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
