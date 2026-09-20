"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { COMPONENT_CATEGORIES, COMPONENT_KINDS, COMPONENT_SOURCES, DEFAULT_PAYROLL_POLICY, type PayrollPolicyValue, PRORATIONS, ROUNDING_RULE_NAMES, TAX_TREATMENTS } from "../enums";
import { FORMULA_FUNCTIONS } from "../engine/formula";
import { FORMULA_VARIABLES } from "../engine/formula/variables";
import { decideComponentAction, decidePolicyAction, decideProfileAction, proposeComponentAction, proposePolicyAction } from "../rule-actions";

type EntityOption = { id: string; code: string; shortName: string };

function EntitySelect({ entities, label, groupLabel }: { entities: EntityOption[]; label: string; groupLabel: string }) {
  return (
    <Field name="entityId" label={label}>
      <Select id="entityId" name="entityId" defaultValue="">
        <option value="">{groupLabel}</option>
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.code} — {entity.shortName}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function ProposeComponentForm({ entities }: { entities: EntityOption[] }) {
  const t = useTranslations("payroll.components");
  const form = useRef<HTMLFormElement>(null);
  const [source, setSource] = useState<(typeof COMPONENT_SOURCES)[number]>("structure");
  const [tax, setTax] = useState<(typeof TAX_TREATMENTS)[number]>("taxable");
  const { onSubmit, pending, errorKey, fieldErrors, details, saved } = useActionForm(proposeComponentAction, { onSuccess: () => form.current?.reset() });
  const formulaProblem = (details as { formula?: { code: string; position: number | null; subject: string | null } } | null)?.formula;

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("propose.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("propose.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <EntitySelect entities={entities} label={t("scope")} groupLabel={t("groupWide")} />
          <Field name="code" label={t("code")}>
            <Input id="code" name="code" required maxLength={40} pattern="[A-Za-z][A-Za-z0-9_]{1,39}" className="font-mono uppercase" />
          </Field>
          <Field name="validFrom" label={t("validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required />
          </Field>
          <Field name="name" label={t("name")}>
            <Input id="name" name="name" required maxLength={120} />
          </Field>
          <Field name="nameEn" label={t("nameEn")}>
            <Input id="nameEn" name="nameEn" maxLength={120} />
          </Field>
          <Field name="sortOrder" label={t("sortOrder")}>
            <Input id="sortOrder" name="sortOrder" type="number" min={0} max={10000} defaultValue={100} />
          </Field>
          <Field name="kind" label={t("kind")}>
            <Select id="kind" name="kind" defaultValue="earning">
              {COMPONENT_KINDS.map((option) => (
                <option key={option} value={option}>
                  {t(`kinds.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="category" label={t("category")}>
            <Select id="category" name="category" defaultValue="allowance">
              {COMPONENT_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {t(`categories.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="source" label={t("source")}>
            <Select id="source" name="source" value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
              {COMPONENT_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {t(`sources.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="taxTreatment" label={t("taxTreatment")}>
            <Select id="taxTreatment" name="taxTreatment" value={tax} onChange={(event) => setTax(event.target.value as typeof tax)}>
              {TAX_TREATMENTS.map((option) => (
                <option key={option} value={option}>
                  {t(`taxTreatments.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          {tax === "exempt_up_to_cap" ? (
            <Field name="exemptCap" label={t("exemptCap")}>
              <Input id="exemptCap" name="exemptCap" inputMode="numeric" required />
            </Field>
          ) : null}
          <Field name="proration" label={t("proration")}>
            <Select id="proration" name="proration" defaultValue="fixed">
              {PRORATIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`prorations.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="roundingRule" label={t("roundingRule")}>
            <Select id="roundingRule" name="roundingRule" defaultValue="half_up">
              {ROUNDING_RULE_NAMES.map((option) => (
                <option key={option} value={option}>
                  {t(`roundingRules.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:pt-6">
            <input type="checkbox" name="subjectToInsurance" /> {t("subjectToInsurance")}
          </label>
        </div>
        {source === "formula" ? (
          <div className="flex flex-col gap-2">
            <Field name="formula" label={t("formula")}>
              <textarea id="formula" name="formula" required rows={3} maxLength={500} spellCheck={false} className="w-full rounded-md border bg-transparent p-2 font-mono text-xs" placeholder="round_half_up_to(pct(base_salary, 1000), 1000)" />
            </Field>
            {formulaProblem ? (
              <p role="alert" className="text-xs text-destructive">
                {t(`formulaErrors.${formulaProblem.code}` as "formulaErrors.empty")}
                {formulaProblem.subject ? ` — “${formulaProblem.subject}”` : ""}
                {formulaProblem.position !== null ? ` (${t("formulaPosition", { position: formulaProblem.position + 1 })})` : ""}
              </p>
            ) : null}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t("formulaHelp")}</summary>
              <p className="mt-1">{t("formulaHelpText")}</p>
              <p className="mt-1 font-mono">{FORMULA_VARIABLES.join(" · ")} · c_&lt;code&gt;</p>
              <p className="mt-1 font-mono">{FORMULA_FUNCTIONS.join(" · ")} · + − * · == != &lt; &lt;= &gt; &gt;= · and or not</p>
            </details>
          </div>
        ) : null}
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={500} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("propose.saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("propose.submit")}
        </Button>
      </div>
    </form>
  );
}

export function ProposePolicyForm({ entities, current }: { entities: EntityOption[]; current: PayrollPolicyValue | null }) {
  const t = useTranslations("payroll.policy");
  const start = current ?? DEFAULT_PAYROLL_POLICY;
  const [basis, setBasis] = useState(start.prorationBasis);
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(proposePolicyAction);
  const choice = <Key extends "prorationBasis" | "overtimeBase" | "simplePitTreatment" | "payDayShift">(name: Key, options: readonly PayrollPolicyValue[Key][], extra: { value?: string; onChange?: (value: string) => void } = {}) => (
    <Field name={`value.${name}`} label={t(`fields.${name}` as "fields.payDay")}>
      <Select id={`value.${name}`} name={`value.${name}`} {...(extra.value !== undefined ? { value: extra.value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => extra.onChange?.(event.target.value) } : { defaultValue: start[name] })}>
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`options.${name}.${option}` as "options.prorationBasis.working_days")}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("propose.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("propose.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <EntitySelect entities={entities} label={t("scope")} groupLabel={t("groupWide")} />
          <Field name="validFrom" label={t("validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required />
          </Field>
          <span />
          {choice("prorationBasis", ["working_days", "calendar_days", "fixed_days"], { value: basis, onChange: (value) => setBasis(value as typeof basis) })}
          {basis === "fixed_days" ? (
            <Field name="value.fixedDays" label={t("fields.fixedDays")}>
              <Input id="value.fixedDays" name="value.fixedDays" type="number" min={20} max={31} defaultValue={start.fixedDays ?? 26} required />
            </Field>
          ) : null}
          <Field name="value.hoursPerDay" label={t("fields.hoursPerDay")}>
            <Input id="value.hoursPerDay" name="value.hoursPerDay" type="number" min={1} max={12} defaultValue={start.hoursPerDay} required />
          </Field>
          {choice("overtimeBase", ["base_salary", "base_plus_insurable_allowances"])}
          {choice("simplePitTreatment", ["none", "flat_withholding"])}
          <Field name="value.varianceThresholdBp" label={t("fields.varianceThresholdBp")}>
            <Input id="value.varianceThresholdBp" name="value.varianceThresholdBp" type="number" min={0} max={100000} defaultValue={start.varianceThresholdBp} required />
          </Field>
          <Field name="value.payDay" label={t("fields.payDay")}>
            <Input id="value.payDay" name="value.payDay" type="number" min={1} max={28} defaultValue={start.payDay} required />
          </Field>
          {choice("payDayShift", ["previous_working_day", "next_working_day"])}
          <label className="flex items-center gap-2 text-sm sm:pt-6">
            <input type="checkbox" name="value.unionEnabled" defaultChecked={start.unionEnabled} /> {t("fields.unionEnabled")}
          </label>
        </div>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={500} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("propose.saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("propose.submit")}
        </Button>
      </div>
    </form>
  );
}

const DECIDE = { component: decideComponentAction, policy: decidePolicyAction, profile: decideProfileAction } satisfies Record<string, (input: unknown) => Promise<ActionResult<unknown>>>;

/** The owner's approve / reject for a proposed rule or profile. */
export function RuleDecisionButtons({ id, kind }: { id: string; kind: keyof typeof DECIDE }) {
  const t = useTranslations("payroll.rules");
  const { onSubmit, pending, errorKey } = useActionForm(DECIDE[kind], { extra: { id } });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
          {t("approve")}
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="outline" disabled={pending}>
          {t("reject")}
        </Button>
      </div>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
    </form>
  );
}
