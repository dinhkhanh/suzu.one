"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { quoteOfferAction } from "../offer-actions";
import type { OfferQuote } from "../offers";
import { formatVnd } from "./money";

type EntityOption = { id: string; code: string; shortName: string };

export function NetToGrossForm({ entities, allowances, defaultMonth }: { entities: EntityOption[]; allowances: { code: string; name: string }[]; defaultMonth: string }) {
  const t = useTranslations("payroll.offers");
  const [quote, setQuote] = useState<OfferQuote | null>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(quoteOfferAction, { onSuccess: (data) => setQuote(data as OfferQuote) });

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 rounded-xl border p-4">
        <FieldErrors value={fieldErrors}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="entityId" label={t("entity")}>
              <Select id="entityId" name="entityId" required defaultValue={entities[0]?.id ?? ""}>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.code} — {entity.shortName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name="month" label={t("month")}>
              <Input id="month" name="month" type="month" required defaultValue={defaultMonth} />
            </Field>
            <Field name="netSalary" label={t("netSalary")}>
              <Input id="netSalary" name="netSalary" required inputMode="numeric" autoComplete="off" placeholder="30.000.000" />
            </Field>
            <Field name="dependents" label={t("dependents")}>
              <Input id="dependents" name="dependents" type="number" min={0} max={20} defaultValue={0} />
            </Field>
            <Field name="profile" label={t("profile")}>
              <Select id="profile" name="profile" defaultValue="statutory">
                <option value="statutory">{t("profileStatutory")}</option>
                <option value="simple">{t("profileSimple")}</option>
              </Select>
            </Field>
            <Field name="taxResidency" label={t("residency")}>
              <Select id="taxResidency" name="taxResidency" defaultValue="resident">
                <option value="resident">{t("resident")}</option>
                <option value="non_resident">{t("nonResident")}</option>
              </Select>
            </Field>
            <Field name="insuranceSalary" label={t("insuranceSalary")}>
              <Input id="insuranceSalary" name="insuranceSalary" inputMode="numeric" autoComplete="off" placeholder={t("followGross")} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="insuranceExempt" value="true" className="size-4" />
              {t("insuranceExempt")}
            </label>
          </div>

          {allowances.length > 0 && (
            <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t("allowances")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {allowances.map((allowance) => (
                  <Field key={allowance.code} name={`allowances.${allowance.code}`} label={allowance.name}>
                    <Input id={`allowances.${allowance.code}`} name={`allowances.${allowance.code}`} inputMode="numeric" autoComplete="off" placeholder="0" />
                  </Field>
                ))}
              </div>
            </fieldset>
          )}
        </FieldErrors>
        <FormError errorKey={errorKey} namespace="payroll.errors" />
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? t("calculating") : t("calculate")}
        </Button>
      </form>

      {quote && <QuoteCard quote={quote} />}
    </div>
  );
}

function QuoteCard({ quote }: { quote: OfferQuote }) {
  const t = useTranslations("payroll.offers");
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border p-4 lg:max-w-sm">
      <header>
        <p className="text-sm text-muted-foreground">{t("grossToOffer")}</p>
        <p className="text-2xl font-semibold tracking-tight">{formatVnd(quote.gross)}</p>
        <p className="text-sm text-muted-foreground">{t("netIs", { net: formatVnd(quote.net) })}</p>
      </header>

      {!quote.exact && (
        <Alert variant="warning">
          <p>
            {t("notExact")}
            {quote.nearest?.below && <span className="block">{t("nearestBelow", { gross: formatVnd(quote.nearest.below.gross), net: formatVnd(quote.nearest.below.net) })}</span>}
          </p>
        </Alert>
      )}

      <dl className="flex flex-col gap-1 text-sm">
        <Row label={t("gross")} value={quote.totals.grossEarnings} />
        <Row label={t("insurance")} value={-quote.totals.employeeInsurance} />
        <Row label={t("pit")} value={-quote.totals.pit} />
        <Row label={t("net")} value={quote.totals.net} strong />
        <Row label={t("employerCost")} value={quote.totals.employerCost} muted />
      </dl>

      {quote.unverifiedParameters.length > 0 && <p className="text-xs text-muted-foreground">{t("unverified", { count: quote.unverifiedParameters.length })}</p>}
    </section>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t pt-1 font-medium" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatVnd(value)}</dd>
    </div>
  );
}
