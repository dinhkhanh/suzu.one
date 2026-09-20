// A filled-in request, read by an approver. Server component: it renders only the fields the form
// actually asked, in the order it asked them, so a type that changed afterwards does not turn an
// old request into a puzzle.
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { FormDefinition } from "../engine/form";
import { AttachmentLink } from "./attachment-link";

export async function Answers({ form, values, requestId, fileNames }: { form: FormDefinition; values: Record<string, unknown>; requestId: string; fileNames: ReadonlyMap<string, string> }) {
  const locale = await getLocale();
  const t = await getTranslations("requests");
  const format = await getFormatter();
  const label = (field: { labelVi: string; labelEn: string }) => (locale === "en" ? field.labelEn : field.labelVi);
  // A field the form no longer has, but the request answered, is still shown — under its key.
  const answered = form.fields.filter((field) => values[field.key] !== undefined);

  if (answered.length === 0) return <p className="text-sm text-muted-foreground">{t("view.noAnswers")}</p>;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {answered.map((field) => {
        const value = values[field.key];
        return (
          <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
            <dt className="text-xs text-muted-foreground">{label(field)}</dt>
            <dd className="text-sm whitespace-pre-wrap">
              {value === null || value === "" ? (
                "—"
              ) : field.type === "checkbox" ? (
                <Badge variant="outline">{value === true ? t("view.yes") : t("view.no")}</Badge>
              ) : field.type === "money" ? (
                format.number(Number(value), { style: "currency", currency: "VND", maximumFractionDigits: 0 })
              ) : field.type === "date" ? (
                format.dateTime(new Date(`${String(value)}T00:00:00`), { dateStyle: "long" })
              ) : field.type === "select" ? (
                (label((field.options ?? []).find((option) => option.value === value) ?? { labelVi: String(value), labelEn: String(value) }))
              ) : field.type === "multi_select" ? (
                (Array.isArray(value) ? value : [])
                  .map((entry) => label((field.options ?? []).find((option) => option.value === entry) ?? { labelVi: String(entry), labelEn: String(entry) }))
                  .join(", ") || "—"
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
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
