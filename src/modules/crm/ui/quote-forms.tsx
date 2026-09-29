"use client";
// The quote editor (FR-CRM-21): lines from the rate card or free text — picking a service fills its
// unit, price, format and hours — and the quote's steps. Totals are worked out by the server on
// save; the running figure here is only a guide while typing.
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { CHANNELS, CONTENT_FORMATS } from "../../work/enums";
import { quoteTotals } from "../engine/quote";
import { quoteStepAction, saveQuoteAction } from "../quote-actions";
import { CrmButton, CrmForm, textarea } from "./common";

export type ServiceChoice = { id: string; code: string; name: string; unit: string; isRecurring: boolean; format: string | null; channel: string | null; priceVnd: number | null; roleMinutes: { role: string; minutes: number }[] };
type Role = { role: string; hours: string };
type Line = { key: number; serviceId: string; title: string; description: string; quantity: string; unit: string; unitPriceVnd: string; discountPercent: string; months: string; format: string; channel: string; roles: Role[] };
export type QuoteLineValues = { serviceId: string | null; title: string; description: string | null; quantity: number; unit: string | null; unitPriceVnd: number; discountBp: number; months: number | null; format: string | null; channel: string | null; roleMinutes: { role: string; minutes: number }[] };

const hours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
const toLine = (key: number, line?: QuoteLineValues): Line => ({
  key,
  serviceId: line?.serviceId ?? "",
  title: line?.title ?? "",
  description: line?.description ?? "",
  quantity: String(line?.quantity ?? 1),
  unit: line?.unit ?? "",
  unitPriceVnd: line ? String(line.unitPriceVnd) : "",
  discountPercent: line?.discountBp ? String(line.discountBp / 100) : "",
  months: line?.months ? String(line.months) : "",
  format: line?.format ?? "",
  channel: line?.channel ?? "",
  roles: (line?.roleMinutes ?? []).map((entry) => ({ role: entry.role, hours: hours(entry.minutes) })),
});
const number = (value: string) => Number(value.replace(/[.,\s]/g, "")) || 0;

export function QuoteEditor({ quoteId, quote, lines: initial, services, vatRates }: { quoteId: string; quote: { title: string; validUntil: string | null; vatRateBp: number; intro: string | null; terms: string | null }; lines: QuoteLineValues[]; services: ServiceChoice[]; vatRates: number[] }) {
  const t = useTranslations("crm.quote");
  const tFormats = useTranslations("work.formats");
  const tChannels = useTranslations("work.channels");
  const format = useFormatter();
  const [lines, setLines] = useState<Line[]>(() => (initial.length ? initial.map((line, index) => toLine(index, line)) : [toLine(0)]));
  const [vat, setVat] = useState(quote.vatRateBp);
  const [next, setNext] = useState(initial.length + 1);
  const update = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const pick = (key: number, serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return update(key, { serviceId: "" });
    const quantity = number(lines.find((row) => row.key === key)?.quantity ?? "1") || 1;
    update(key, { serviceId, title: service.name, unit: service.unit, unitPriceVnd: service.priceVnd === null ? "" : String(service.priceVnd), format: service.format ?? "", channel: service.channel ?? "", months: service.isRecurring ? "12" : "", roles: service.roleMinutes.map((entry) => ({ role: entry.role, hours: hours(entry.minutes * quantity * (service.isRecurring ? 12 : 1)) })) });
  };
  const totals = useMemo(() => quoteTotals(lines.map((line) => ({ quantity: number(line.quantity), unitPriceVnd: number(line.unitPriceVnd), discountBp: Math.round(Number(line.discountPercent || 0) * 100), months: line.months ? number(line.months) : null })), vat), [lines, vat]);
  const money = (value: number) => format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 });

  return (
    <CrmForm action={saveQuoteAction} extra={{ quoteId }} submit={t("save")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field name="title" label={t("title")}>
            <Input id="quote-title" name="title" required maxLength={200} defaultValue={quote.title} />
          </Field>
        </div>
        <Field name="validUntil" label={t("validUntil")}>
          <DatePicker id="quote-valid" name="validUntil" defaultValue={quote.validUntil ?? ""} />
        </Field>
      </div>
      <Field name="intro" label={t("intro")}>
        <textarea id="quote-intro" name="intro" rows={2} maxLength={4000} defaultValue={quote.intro ?? ""} className={textarea} />
      </Field>
      <ol className="flex flex-col gap-3">
        {lines.map((line, index) => (
          <li key={line.key} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Select id={`line-service-${line.key}`} name={`lines.${index}.serviceId`} value={line.serviceId} onChange={(event) => pick(line.key, event.target.value)} aria-label={t("service")}>
                  <option value="">{t("freeLine")}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.code} · {service.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-4">
                <Input name={`lines.${index}.title`} required maxLength={200} value={line.title} onChange={(event) => update(line.key, { title: event.target.value })} placeholder={t("lineTitle")} aria-label={t("lineTitle")} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-6">
              <Input name={`lines.${index}.quantity`} type="number" min={1} value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} aria-label={t("quantity")} placeholder={t("quantity")} />
              <Input name={`lines.${index}.unit`} maxLength={40} value={line.unit} onChange={(event) => update(line.key, { unit: event.target.value })} aria-label={t("unit")} placeholder={t("unit")} />
              <Input name={`lines.${index}.unitPriceVnd`} inputMode="numeric" value={line.unitPriceVnd} onChange={(event) => update(line.key, { unitPriceVnd: event.target.value })} aria-label={t("unitPrice")} placeholder={t("unitPrice")} />
              <Input name={`lines.${index}.discountPercent`} inputMode="decimal" value={line.discountPercent} onChange={(event) => update(line.key, { discountPercent: event.target.value })} aria-label={t("discount")} placeholder={t("discount")} />
              <Input name={`lines.${index}.months`} type="number" min={1} max={120} value={line.months} onChange={(event) => update(line.key, { months: event.target.value })} aria-label={t("months")} placeholder={t("monthsHint")} />
              <p className="self-center text-right text-sm tabular-nums">{money(Math.max(0, number(line.quantity) * number(line.unitPriceVnd) * (line.months ? number(line.months) : 1) * (1 - Number(line.discountPercent || 0) / 100)))}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select id={`line-format-${line.key}`} name={`lines.${index}.format`} value={line.format} onChange={(event) => update(line.key, { format: event.target.value })} aria-label={t("format")}>
                <option value="">{t("format")}</option>
                {CONTENT_FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {tFormats(value)}
                  </option>
                ))}
              </Select>
              <Select id={`line-channel-${line.key}`} name={`lines.${index}.channel`} value={line.channel} onChange={(event) => update(line.key, { channel: event.target.value })} aria-label={t("channel")}>
                <option value="">{t("channel")}</option>
                {CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {tChannels(value)}
                  </option>
                ))}
              </Select>
              <Input name={`lines.${index}.description`} maxLength={1000} value={line.description} onChange={(event) => update(line.key, { description: event.target.value })} placeholder={t("description")} aria-label={t("description")} />
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{t("hoursByRole", { hours: line.roles.reduce((sum, role) => sum + Number(role.hours || 0), 0) })}</summary>
              <div className="flex flex-col gap-2 pt-2">
                {[...line.roles, { role: "", hours: "" }].map((role, roleIndex) => (
                  <div key={roleIndex} className="grid gap-2 sm:grid-cols-2">
                    <Input
                      name={`lines.${index}.roles.${roleIndex}.role`}
                      maxLength={80}
                      value={role.role}
                      placeholder={t("role")}
                      aria-label={t("role")}
                      onChange={(event) => update(line.key, { roles: Object.assign([...line.roles], { [roleIndex]: { ...role, role: event.target.value } }) })}
                    />
                    <Input
                      name={`lines.${index}.roles.${roleIndex}.hours`}
                      inputMode="decimal"
                      value={role.hours}
                      placeholder={t("hours")}
                      aria-label={t("hours")}
                      onChange={(event) => update(line.key, { roles: Object.assign([...line.roles], { [roleIndex]: { ...role, hours: event.target.value } }) })}
                    />
                  </div>
                ))}
              </div>
            </details>
            <button type="button" className="self-start text-xs text-destructive underline" onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}>
              {t("removeLine")}
            </button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setLines((rows) => [...rows, toLine(next)]);
          setNext((value) => value + 1);
        }}
      >
        {t("addLine")}
      </Button>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="vatRateBp" label={t("vat")}>
          <Select id="quote-vat" name="vatRateBp" value={String(vat)} onChange={(event) => setVat(Number(event.target.value))}>
            {vatRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate / 100}%
              </option>
            ))}
          </Select>
        </Field>
        <dl className="grid grid-cols-2 gap-x-3 text-sm sm:col-span-2">
          <dt className="text-muted-foreground">{t("subtotal")}</dt>
          <dd className="text-right tabular-nums">{money(totals.subtotalVnd)}</dd>
          <dt className="text-muted-foreground">{t("discountTotal")}</dt>
          <dd className="text-right tabular-nums">−{money(totals.discountVnd)}</dd>
          <dt className="text-muted-foreground">{t("vatAmount")}</dt>
          <dd className="text-right tabular-nums">{money(totals.vatVnd)}</dd>
          <dt className="font-medium">{t("total")}</dt>
          <dd className="text-right font-medium tabular-nums">{money(totals.totalVnd)}</dd>
        </dl>
      </div>
      <Field name="terms" label={t("terms")}>
        <textarea id="quote-terms" name="terms" rows={3} maxLength={4000} defaultValue={quote.terms ?? ""} className={textarea} />
      </Field>
    </CrmForm>
  );
}

/** The steps a quote allows now: submit or send a draft, record the client's answer, revise. */
export function QuoteSteps({ quoteId, dealId, steps }: { quoteId: string; dealId: string; steps: string[] }) {
  const t = useTranslations("crm.quote.steps");
  const [answering, setAnswering] = useState<"accept" | "reject" | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {steps.includes("submit") ? <CrmButton action={quoteStepAction} input={{ quoteId, step: "submit" }} label={t("submit")} /> : null}
        {steps.includes("withdraw") ? <CrmButton action={quoteStepAction} input={{ quoteId, step: "withdraw" }} label={t("withdraw")} /> : null}
        {steps.includes("send") ? <CrmButton action={quoteStepAction} input={{ quoteId, step: "send" }} label={t("send")} variant="default" /> : null}
        {steps.includes("accept") ? (
          <Button type="button" size="xs" onClick={() => setAnswering("accept")}>
            {t("accept")}
          </Button>
        ) : null}
        {steps.includes("reject") ? (
          <Button type="button" size="xs" variant="outline" onClick={() => setAnswering("reject")}>
            {t("reject")}
          </Button>
        ) : null}
        {steps.includes("revise") ? <CrmButton action={quoteStepAction} input={{ quoteId, step: "revise" }} label={t("revise")} navigateTo={(data) => `/crm/deals/${dealId}/quotes/${(data as { id: string }).id}`} /> : null}
      </div>
      {answering ? (
        <CrmForm action={quoteStepAction} extra={{ quoteId, step: answering }} submit={t(answering)} className="flex flex-wrap items-end gap-3">
          <Field name="note" label={t("clientNote")}>
            <Input id="quote-answer-note" name="note" maxLength={1000} />
          </Field>
        </CrmForm>
      ) : null}
    </div>
  );
}
