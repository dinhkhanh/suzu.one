"use client";
// The year-end bonus screens' forms (FR-PAY-21). Every one of these posts a compensation action,
// so every one can come back with `step_up_required` — `FormError` renders that like any other.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bonusWhatIfAction, createBonusRunAction, decideBonusSchemeAction, overrideBonusLineAction, payBonusRunAction, proposeBonusSchemeAction, simulateBonusRunAction, stepBonusRunAction } from "../bonus-actions";
import type { BonusStep } from "../bonus";
import type { BonusTotals } from "../engine/bonus";
import { formatVnd } from "./money";

type EntityOption = { id: string; code: string; shortName: string };

const ERRORS = "payroll.bonus.errors";
const textarea = "w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs";

/** The scheme as the form holds it: JSON text, parsed for the action, `null` while it is broken. */
function useJsonValue(initial: unknown) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  let parsed: unknown = null;
  let broken = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    broken = true;
  }
  return { text, setText, parsed, broken };
}

export function NewBonusRunForm({ entities, year, payrollMonth }: { entities: EntityOption[]; year: number; payrollMonth: string }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(entities.map((entity) => entity.id));
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createBonusRunAction, { extra: { entityIds: chosen }, onSuccess: (data) => router.push(`/payroll/bonus/${(data as { id: string }).id}`) });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("new.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("new.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="year" label={t("new.year")}>
            <Input id="year" name="year" inputMode="numeric" defaultValue={year} required />
          </Field>
          <Field name="name" label={t("new.name")}>
            <Input id="name" name="name" maxLength={160} defaultValue={t("new.defaultName", { year })} required />
          </Field>
          <Field name="payrollMonth" label={t("new.payrollMonth")}>
            <Input id="payrollMonth" name="payrollMonth" defaultValue={payrollMonth} placeholder="2027-01" required />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("new.entities")}</legend>
          <p className="text-xs text-muted-foreground">{t("new.entitiesHint")}</p>
          <div className="flex flex-wrap gap-3">
            {entities.map((entity) => (
              <label key={entity.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(entity.id)}
                  onChange={(event) => setChosen((current) => (event.target.checked ? [...current, entity.id] : current.filter((id) => id !== entity.id)))}
                />
                {entity.code} — {entity.shortName}
              </label>
            ))}
          </div>
        </fieldset>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || chosen.length === 0}>
          {pending ? `${t("new.submit")}…` : t("new.submit")}
        </Button>
      </div>
    </form>
  );
}

export function SimulateButton({ runId, label }: { runId: string; label: string }) {
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(simulateBonusRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? `${label}…` : label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/** One step of the lifecycle. A return to HR must carry a reason, so it is required for that one. */
export function BonusStepForm({ runId, step, label, destructive }: { runId: string; step: Exclude<BonusStep, "simulate" | "pay">; label: string; destructive?: boolean }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(stepBonusRunAction, {
    extra: { runId, step },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });
  const needsReason = step === "return";

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={fieldErrors}>
        <Field name="comment" label={needsReason ? t("steps.reason") : t("steps.comment")}>
          <Input id={`comment-${step}`} name="comment" maxLength={1000} required={needsReason} />
        </Field>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" variant={destructive ? "outline" : "default"} disabled={pending}>
          {pending ? `${label}…` : label}
        </Button>
      </div>
    </form>
  );
}

export function PayBonusRunButton({ runId }: { runId: string }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(payBonusRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? `${t("steps.pay")}…` : t("steps.pay")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("steps.payHint")}</p>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/** The owner's adjustment of one person's amount. The reason is the record, so it is required. */
export function OverrideLineForm({ runId, personId, currentAmount, currentReason }: { runId: string; personId: string; currentAmount: number | null; currentReason: string | null }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(overrideBonusLineAction, { extra: { runId, personId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("override.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("override.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field name="amount" label={t("override.amount")}>
            <Input id="amount" name="amount" inputMode="numeric" defaultValue={currentAmount ?? ""} className="text-right tabular-nums" />
          </Field>
          <Field name="reason" label={t("override.reason")}>
            <Input id="reason" name="reason" maxLength={500} defaultValue={currentReason ?? ""} />
          </Field>
        </div>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("override.clearHint")}</p>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? `${t("override.save")}…` : t("override.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("override.saved")}</span> : null}
      </div>
    </form>
  );
}

// ── The scheme (versioned configuration) ────────────────────────────────────────────────────

/**
 * The scheme is a nested set of band tables, and the schema is the authority on its shape — so the
 * form edits it as JSON, pre-filled from the version in force, and the action's validation is the
 * same `bonusSchemeSchema` the engine reads. A friendlier band-table editor can come later
 * without changing anything behind it.
 */
export function ProposeSchemeForm({ entities, current }: { entities: EntityOption[]; current: unknown }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const { text, setText, parsed, broken } = useJsonValue(current);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(proposeBonusSchemeAction, { extra: { value: parsed }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("scheme.propose")}</h2>
      <p className="text-sm text-muted-foreground">{t("scheme.proposeHint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="entityId" label={t("scheme.scope")}>
            <Select id="entityId" name="entityId" defaultValue="">
              <option value="">{t("scheme.groupWide")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} — {entity.shortName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("scheme.validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required />
          </Field>
          <Field name="note" label={t("scheme.note")}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>
        <Field name="value" label={t("scheme.value")}>
          <textarea id="value" value={text} onChange={(event) => setText(event.target.value)} rows={18} spellCheck={false} className={textarea} />
        </Field>
      </FieldErrors>
      {broken ? <p className="text-sm text-destructive">{t("errors.scheme_not_json")}</p> : null}
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || broken}>
          {pending ? `${t("scheme.submit")}…` : t("scheme.submit")}
        </Button>
      </div>
    </form>
  );
}

export function SchemeDecisionButtons({ id }: { id: string }) {
  const t = useTranslations("payroll.bonus");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(decideBonusSchemeAction, { extra: { id }, onSuccess: () => router.refresh() });
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} onClick={() => setDecision("approve")}>
          {t("scheme.approve")}
        </Button>
        <Button type="submit" variant="outline" disabled={pending} onClick={() => setDecision("reject")}>
          {t("scheme.reject")}
        </Button>
      </div>
      <input type="hidden" name="decision" value={decision} />
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/**
 * "What would this cost under a different multiplier table?" (FR-PAY-21). Stores nothing: the
 * figures come back from the action and are shown here.
 */
export function WhatIfForm({ runId, current }: { runId: string; current: unknown }) {
  const t = useTranslations("payroll.bonus");
  const { text, setText, parsed, broken } = useJsonValue(current);
  const [result, setResult] = useState<{ totals: BonusTotals; byEntity: { entityId: string; entityName: string; totals: BonusTotals }[] } | null>(null);
  const { onSubmit, pending, errorKey } = useActionForm(bonusWhatIfAction, { extra: { runId, value: parsed }, onSuccess: (data) => setResult(data as { totals: BonusTotals; byEntity: { entityId: string; entityName: string; totals: BonusTotals }[] }) });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("whatIf.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("whatIf.hint")}</p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={12} spellCheck={false} className={textarea} aria-label={t("whatIf.title")} />
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" variant="outline" disabled={pending || broken}>
          {pending ? `${t("whatIf.submit")}…` : t("whatIf.submit")}
        </Button>
      </div>
      {result ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t pt-3 text-sm">
          <dt className="font-medium">{t("whatIf.total")}</dt>
          <dd className="text-right font-medium tabular-nums">{formatVnd(result.totals.totalVnd)}</dd>
          {result.byEntity.map((entity) => (
            <div key={entity.entityId} className="contents">
              <dt className="text-muted-foreground">{entity.entityName}</dt>
              <dd className="text-right tabular-nums">{formatVnd(entity.totals.totalVnd)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </form>
  );
}
