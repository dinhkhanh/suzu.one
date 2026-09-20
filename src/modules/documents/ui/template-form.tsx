"use client";
// The template designer. Its one job beyond the obvious is to make the tier rule *visible*: as
// the body is typed, the form works out which tier the placeholders in it demand and says so, so
// nobody discovers at save time that their letter has become a compensation document.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TIERS, type Tier } from "@/modules/platform/rbac/roles";
import { saveDocumentTemplateAction } from "../actions";
import { DOCUMENT_KINDS, type DocumentKind, type LetterheadFields } from "../enums";
import { atLeast, PLACEHOLDERS, placeholdersIn, requiredTier, unknownPlaceholders } from "../engine/template";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs";

export type TemplateFormValue = {
  id: string | null;
  code: string;
  name: string;
  entityId: string | null;
  kind: DocumentKind;
  tier: Tier;
  body: string;
  letterhead: LetterheadFields;
  isActive: boolean;
};

const LETTERHEAD_FIELDS = ["companyName", "address", "taxCode", "phone", "representative", "representativeTitle", "place"] as const;

export function DocumentTemplateForm({ value, entities }: { value: TemplateFormValue | null; entities: { id: string; code: string; shortName: string | null }[] }) {
  const t = useTranslations("documents.designer");
  const tiers = useTranslations("documents.tier");
  const kinds = useTranslations("documents.kind");
  const router = useRouter();
  const [body, setBody] = useState(value?.body ?? "");
  const [tier, setTier] = useState<Tier>(value?.tier ?? "personal");
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(saveDocumentTemplateAction, {
    extra: value?.id ? { templateId: value.id } : {},
    onSuccess: () => router.push("/admin/document-templates"),
  });

  const used = useMemo(() => placeholdersIn(body), [body]);
  const unknown = useMemo(() => unknownPlaceholders(body), [body]);
  const needed = useMemo(() => requiredTier(used), [used]);
  const tierTooLow = !atLeast(tier, needed);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="code" label={t("code")}>
            <Input id="code" name="code" required maxLength={24} defaultValue={value?.code ?? ""} placeholder="XN-CONG-TAC" readOnly={!!value?.id} />
          </Field>
          <Field name="name" label={t("name")}>
            <Input id="name" name="name" required maxLength={200} defaultValue={value?.name ?? ""} />
          </Field>
          <Field name="kind" label={t("kind")}>
            <Select id="kind" name="kind" defaultValue={value?.kind ?? "confirmation_letter"}>
              {DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kinds(kind)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" defaultValue={value?.entityId ?? ""}>
              <option value="">{t("groupWide")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.shortName ?? entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="tier" label={t("tier")}>
            <Select id="tier" name="tier" value={tier} onChange={(event) => setTier(event.target.value as Tier)}>
              {TIERS.map((option) => (
                <option key={option} value={option}>
                  {tiers(option)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field name="body" label={t("body")}>
          <textarea id="body" name="body" required rows={20} maxLength={20_000} value={body} onChange={(event) => setBody(event.target.value)} className={textarea} />
        </Field>
      </FieldErrors>

      {/* The rule, said out loud while it is still cheap to act on. */}
      <div className={`rounded-md border p-3 text-sm ${tierTooLow || unknown.length ? "border-destructive/60 bg-destructive/5" : "bg-muted/30"}`}>
        <p>
          {t("needsTier")} <strong>{tiers(needed)}</strong>
          {tierTooLow ? <span className="ml-2 text-destructive">{t("tierTooLow", { tier: tiers(needed) })}</span> : null}
        </p>
        {unknown.length > 0 ? <p className="mt-1 text-destructive">{t("unknown", { keys: unknown.join(", ") })}</p> : null}
        {used.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("using", { keys: used.join(", ") })}</p> : null}
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("catalogue")}</summary>
        <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          {PLACEHOLDERS.map((placeholder) => (
            <li key={placeholder.key} className="flex items-baseline justify-between gap-2">
              <code className="font-mono">{`{{${placeholder.key}}}`}</code>
              <span className="text-muted-foreground">{tiers(placeholder.tier)}</span>
            </li>
          ))}
        </ul>
      </details>

      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("letterhead")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LETTERHEAD_FIELDS.map((field) => (
            <label key={field} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t(`letterheadFields.${field}`)}
              <input name={`letterhead.${field}`} defaultValue={value?.letterhead?.[field] ?? ""} maxLength={300} className="h-9 rounded-md border bg-transparent px-3 text-sm text-foreground" />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={value?.isActive ?? true} className="size-4" />
        {t("active")}
      </label>

      <FormError namespace="documents.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
