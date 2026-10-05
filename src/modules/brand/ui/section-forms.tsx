"use client";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { createBrandRuleAction, createBrandSectionAction, deleteBrandRuleAction, deleteBrandSectionAction, moveBrandSectionAction, updateBrandRuleAction, updateBrandSectionAction } from "../actions";
import { BRAND_LIMITS, BRAND_SECTION_KINDS, type BrandRuleVerdict } from "../enums";
import type { BrandRuleRow, BrandSectionRow } from "../service";

/** A picture of the kit that can illustrate a rule. */
export type ExampleOption = { id: string; title: string };

const failureKey = (result: Extract<ActionResult<unknown>, { ok: false }>) => (result.error === "failed" ? result.message : result.error) ?? "generic";

function useKindOptions() {
  const t = useTranslations("brands");
  return BRAND_SECTION_KINDS.map((kind) => (
    <option key={kind} value={kind}>
      {t(`sectionKinds.${kind}`)}
    </option>
  ));
}

/** A small button that runs one action and refreshes the page. */
function ActionButton({ label, icon, run, variant = "ghost", disabled }: { label: string; icon: React.ReactNode; run: () => Promise<ActionResult<unknown>>; variant?: "ghost" | "destructive"; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          if (result.ok) router.refresh();
        })
      }
    >
      {icon}
    </Button>
  );
}

export function AddSectionForm({ kitId }: { kitId: string }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const kindOptions = useKindOptions();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(createBrandSectionAction, {
    extra: { kitId },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });
  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="new-section-title" label={t("sectionTitle")}>
            <Input id="new-section-title" name="title" required maxLength={BRAND_LIMITS.sectionTitle} placeholder={t("sectionTitlePlaceholder")} />
          </Field>
          <Field name="new-section-title-en" label={t("sectionTitleEn")}>
            <Input id="new-section-title-en" name="titleEn" maxLength={BRAND_LIMITS.sectionTitle} />
          </Field>
          <Field name="new-section-kind" label={t("sectionKind")}>
            <Select id="new-section-kind" name="kind" defaultValue="content">
              {kindOptions}
            </Select>
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="brands.errors" errorKey={errorKey} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved ? <span className="mr-auto text-xs text-success">{t("sectionAdded")}</span> : null}
        <Button type="submit" disabled={pending} className="w-full md:w-auto">
          {t("addSection")}
        </Button>
      </div>
    </form>
  );
}

/** One section of the guideline: its words, its place, and its do's and don'ts. */
export function SectionEditor({ section, rules, examples, index, count }: { section: BrandSectionRow; rules: BrandRuleRow[]; examples: ExampleOption[]; index: number; count: number }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const kindOptions = useKindOptions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(updateBrandSectionAction, { extra: { id: section.id }, onSuccess: () => router.refresh() });
  const prefix = `section-${section.id}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-faint tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <h3 className="min-w-0 flex-1 truncate">{section.title}</h3>
        {section.kind !== "content" ? <Badge variant="secondary">{t(`sectionKinds.${section.kind}`)}</Badge> : null}
        <ActionButton label={t("moveUp")} icon={<ArrowUpIcon />} disabled={index === 0} run={() => moveBrandSectionAction({ id: section.id, direction: "up" })} />
        <ActionButton label={t("moveDown")} icon={<ArrowDownIcon />} disabled={index === count - 1} run={() => moveBrandSectionAction({ id: section.id, direction: "down" })} />
        {confirmDelete ? (
          <>
            <ActionButton label={t("deleteSectionYes")} icon={<CheckIcon />} variant="destructive" run={() => deleteBrandSectionAction({ id: section.id })} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={() => setConfirmDelete(false)}>
              <XIcon />
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("deleteSection")} title={t("deleteSection")} onClick={() => setConfirmDelete(true)}>
            <Trash2Icon />
          </Button>
        )}
      </div>
      {confirmDelete ? <p className="-mt-3 text-xs text-destructive">{t("deleteSectionConfirm")}</p> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FieldErrors value={fieldErrors}>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field name={`${prefix}-title`} label={t("sectionTitle")}>
              <Input id={`${prefix}-title`} name="title" required maxLength={BRAND_LIMITS.sectionTitle} defaultValue={section.title} />
            </Field>
            <Field name={`${prefix}-kind`} label={t("sectionKind")}>
              <Select id={`${prefix}-kind`} name="kind" defaultValue={section.kind}>
                {kindOptions}
              </Select>
            </Field>
          </div>
          <Field name={`${prefix}-body`} label={t("sectionBody")}>
            <NoteEditor id={`${prefix}-body`} name="body" defaultValue={section.body ?? ""} rows={5} maxLength={BRAND_LIMITS.sectionBody} placeholder={t(`sectionBodyPlaceholder.${section.kind}`)} draft={false} />
          </Field>
          <Collapsible defaultOpen={!!(section.titleEn || section.bodyEn)}>
            <CollapsibleTrigger className="rounded-md text-left text-[0.8125rem] font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t("englishVersion")}</CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-4">
              <Field name={`${prefix}-title-en`} label={t("sectionTitleEn")}>
                <Input id={`${prefix}-title-en`} name="titleEn" maxLength={BRAND_LIMITS.sectionTitle} defaultValue={section.titleEn ?? ""} />
              </Field>
              <Field name={`${prefix}-body-en`} label={t("sectionBodyEn")}>
                <NoteEditor id={`${prefix}-body-en`} name="bodyEn" defaultValue={section.bodyEn ?? ""} rows={4} maxLength={BRAND_LIMITS.sectionBody} draft={false} />
              </Field>
            </CollapsibleContent>
          </Collapsible>
        </FieldErrors>
        <FormError namespace="brands.errors" errorKey={errorKey} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {saved ? <span className="mr-auto text-xs text-success">{t("saved")}</span> : null}
          <Button type="submit" variant="outline" disabled={pending} className="w-full md:w-auto">
            {pending ? t("saving") : t("saveSection")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <p className="section-label">{t("rules")}</p>
        <TableCard>
          <List>
            {rules.length === 0 ? <ListEmpty>{t("noRules")}</ListEmpty> : null}
            {rules.map((rule) => (
              <ListItem key={rule.id} className="py-3">
                <RuleForm sectionId={section.id} rule={rule} examples={examples} />
              </ListItem>
            ))}
          </List>
          <TableAddRow label={t("addRule")}>
            <RuleForm sectionId={section.id} examples={examples} />
          </TableAddRow>
        </TableCard>
      </div>
    </div>
  );
}

/** A do or a don't: new, or one already written. */
function RuleForm({ sectionId, rule, examples }: { sectionId: string; rule?: BrandRuleRow; examples: ExampleOption[] }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [verdict, setVerdict] = useState<BrandRuleVerdict>(rule?.verdict ?? "do");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(rule ? updateBrandRuleAction : createBrandRuleAction, {
    extra: rule ? { id: rule.id } : { sectionId },
    onSuccess: () => {
      if (!rule) {
        form.current?.reset();
        setVerdict("do");
      }
      router.refresh();
    },
  });
  const exampleOptions = [<option key="" value="">{t("noExample")}</option>, ...examples.map((example) => <option key={example.id} value={example.id}>{example.title}</option>)];
  const prefix = `rule-${rule?.id ?? `new-${sectionId}`}`;

  return (
    <form ref={form} onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <input type="hidden" name="verdict" value={verdict} />
      <FieldErrors value={fieldErrors}>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            aria-label={t("verdict")}
            value={verdict}
            onChange={setVerdict}
            options={[
              { value: "do", label: t("verdicts.do") },
              { value: "dont", label: t("verdicts.dont") },
            ]}
          />
          {saved && rule ? <span className="text-xs text-success">{t("saved")}</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name={`${prefix}-text`} label={t("ruleText")}>
            <Textarea id={`${prefix}-text`} name="text" required rows={2} maxLength={BRAND_LIMITS.ruleText} defaultValue={rule?.text ?? ""} placeholder={t(verdict === "do" ? "ruleTextDoPlaceholder" : "ruleTextDontPlaceholder")} />
          </Field>
          <Field name={`${prefix}-text-en`} label={t("ruleTextEn")}>
            <Textarea id={`${prefix}-text-en`} name="textEn" rows={2} maxLength={BRAND_LIMITS.ruleText} defaultValue={rule?.textEn ?? ""} />
          </Field>
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Field name={`${prefix}-example`} label={t("example")}>
            <Select id={`${prefix}-example`} name="exampleAssetId" defaultValue={rule?.exampleAssetId ?? ""}>
              {exampleOptions}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant={rule ? "outline" : "default"} disabled={pending} className="flex-1 sm:flex-none">
              {rule ? t("save") : t("addRule")}
            </Button>
            {rule ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("deleteRule")}
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    const result = await deleteBrandRuleAction({ id: rule.id });
                    if (result.ok) router.refresh();
                    else setDeleteError(failureKey(result));
                  })
                }
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </div>
        </div>
      </FieldErrors>
      {examples.length === 0 && !rule ? <p className="text-xs text-muted-foreground">{t("exampleHint")}</p> : null}
      <FormError namespace="brands.errors" errorKey={errorKey ?? deleteError} />
    </form>
  );
}
