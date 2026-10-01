"use client";
// The template designer. Its one job beyond the obvious is to make the tier rule *visible*: as
// the body is typed, the form works out which tier the placeholders in it demand and says so, so
// nobody discovers at save time that their letter has become a compensation document.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { TIERS, type Tier } from "@/modules/platform/rbac/roles";
import { saveDocumentTemplateAction } from "../actions";
import { DOCUMENT_KINDS, type DocumentKind, type LetterheadFields } from "../enums";
import { atLeast, PLACEHOLDERS, placeholdersIn, requiredTier, unknownPlaceholders } from "../engine/template";

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
  const activeId = useId();
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
    <form onSubmit={onSubmit} className="flex flex-col gap-6 md:gap-8">
      <FieldErrors value={fieldErrors}>
        <Section title={t("basics")}>
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name="code" label={t("code")}>
                <Input id="code" name="code" required maxLength={24} defaultValue={value?.code ?? ""} placeholder="XN-CONG-TAC" readOnly={!!value?.id} className="font-mono" />
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
              <Label htmlFor={activeId} className="h-10 cursor-pointer gap-2.5 self-end font-normal md:h-9">
                <Checkbox id={activeId} name="isActive" defaultChecked={value?.isActive ?? true} />
                {t("active")}
              </Label>
            </CardContent>
          </Card>
        </Section>

        <Section title={t("body")}>
          <Field name="body" label={t("body")}>
            <Textarea id="body" name="body" required rows={20} maxLength={20_000} value={body} onChange={(event) => setBody(event.target.value)} className="min-h-96 font-mono text-xs leading-relaxed md:text-xs" spellCheck={false} />
          </Field>
          {/* The rule, said out loud while it is still cheap to act on. */}
          <Alert variant={tierTooLow || unknown.length ? "destructive" : "neutral"}>
            <span>
              {t("needsTier")} <strong>{tiers(needed)}</strong>
              {tierTooLow ? <span className="ml-2">{t("tierTooLow", { tier: tiers(needed) })}</span> : null}
            </span>
            {unknown.length > 0 ? <span className="w-full">{t("unknown", { keys: unknown.join(", ") })}</span> : null}
            {used.length > 0 ? <span className="w-full font-mono text-xs text-muted-foreground">{t("using", { keys: used.join(", ") })}</span> : null}
          </Alert>
        </Section>
      </FieldErrors>

      <Section title={t("catalogue")}>
        <TableCard>
          <TableCardHeader title={t("catalogue")} count={PLACEHOLDERS.length} />
          <Table numbered={false} containerClassName="max-h-72 overflow-y-auto">
            <TableBody>
              {PLACEHOLDERS.map((placeholder) => (
                <TableRow key={placeholder.key}>
                  <TableCell className="h-9 py-1 font-mono text-xs">{`{{${placeholder.key}}}`}</TableCell>
                  <TableCell className="h-9 py-1 text-right">
                    <Badge variant={placeholder.tier === "compensation" ? "destructive" : placeholder.tier === "restricted" ? "warning" : "outline"}>{tiers(placeholder.tier)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      <Section title={t("letterhead")}>
        <Card>
          <CardHeader>
            <CardTitle>{t("letterhead")}</CardTitle>
            <CardDescription>{t("letterheadHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {LETTERHEAD_FIELDS.map((field) => (
              <Field key={field} name={`letterhead.${field}`} label={t(`letterheadFields.${field}`)}>
                <Input id={`letterhead.${field}`} name={`letterhead.${field}`} defaultValue={value?.letterhead?.[field] ?? ""} maxLength={300} />
              </Field>
            ))}
          </CardContent>
        </Card>
      </Section>

      <FormError namespace="documents.errors" errorKey={errorKey} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} size="lg" className="w-full md:w-auto">
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
