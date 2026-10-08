// A filled-in request, read by an approver, as the property sheet of the design: one row per
// field the form actually asked, in the order it asked them, so a type that changed afterwards
// does not turn an old request into a puzzle. Server component.
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import type { FormDefinition } from "../engine/form";
import { AttachmentLink } from "./attachment-link";

export async function Answers({
  form,
  values,
  requestId,
  fileNames,
  recordNames,
}: {
  form: FormDefinition;
  values: Record<string, unknown>;
  requestId: string;
  fileNames: ReadonlyMap<string, string>;
  /** A person's or entity's name by id, for the fields that name one; an unknown id shows as itself. */
  recordNames: ReadonlyMap<string, string>;
}) {
  const locale = await getLocale();
  const t = await getTranslations("requests");
  const format = await getFormatter();
  const label = (field: { labelVi: string; labelEn: string }) => (locale === "en" ? field.labelEn : field.labelVi);
  // A field the form no longer has, but the request answered, is still shown — under its key.
  const answered = form.fields.filter((field) => values[field.key] !== undefined);

  if (answered.length === 0) return <p className="text-sm text-muted-foreground">{t("view.noAnswers")}</p>;
  return (
    <Table numbered={false}>
      <TableBody>
        {answered.map((field) => {
          const value = values[field.key];
          const long = field.type === "textarea";
          return (
            <TableRow key={field.key} className="hover:bg-transparent">
              <TableCell className="w-44 align-top text-xs text-muted-foreground md:w-56 md:text-sm">{label(field)}</TableCell>
              <TableCell className={long ? "whitespace-normal" : field.type === "money" ? "whitespace-normal font-mono text-[0.9375rem] font-medium tabular-nums" : "whitespace-pre-wrap"}>
                {value === null || value === "" ? (
                  <span className="text-faint">—</span>
                ) : field.type === "checkbox" ? (
                  <Badge variant="outline">{value === true ? t("view.yes") : t("view.no")}</Badge>
                ) : field.type === "money" ? (
                  format.number(Number(value), { style: "currency", currency: "VND", maximumFractionDigits: 0 })
                ) : field.type === "date" ? (
                  format.dateTime(new Date(`${String(value)}T00:00:00`), { dateStyle: "long" })
                ) : field.type === "select" ? (
                  label((field.options ?? []).find((option) => option.value === value) ?? { labelVi: String(value), labelEn: String(value) })
                ) : field.type === "multi_select" ? (
                  (Array.isArray(value) ? value : []).map((entry) => label((field.options ?? []).find((option) => option.value === entry) ?? { labelVi: String(entry), labelEn: String(entry) })).join(", ") || "—"
                ) : field.type === "person" || field.type === "entity" ? (
                  (Array.isArray(value) ? value : [value]).map((entry, index) => (
                    <span key={String(entry)}>
                      {index ? ", " : ""}
                      <RecordLink kind={field.type === "person" ? "person" : "entity"} id={recordNames.has(String(entry)) ? String(entry) : null}>
                        {recordNames.get(String(entry)) ?? String(entry)}
                      </RecordLink>
                    </span>
                  ))
                ) : field.type === "textarea" ? (
                  <RichText text={String(value)} />
                ) : field.type === "file" ? (
                  <ul className="flex flex-col gap-1">
                    {(Array.isArray(value) ? value : []).map((fileId) => (
                      <li key={String(fileId)}>
                        <AttachmentLink requestId={requestId} fileId={String(fileId)} fileName={fileNames.get(String(fileId)) ?? String(fileId)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  String(value)
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
