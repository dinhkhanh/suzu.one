"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { PerformanceWeightingValue } from "../enums";
import { computeResultsAction, decideWeightingAction, lockResultAction, overrideResultAction, proposeWeightingAction, publishResultAction, recomputeResultAction, unlockResultAction } from "../result-actions";

const ERRORS = "performance.results.errors";
type Option = { id: string; name: string };

// ── Computing ───────────────────────────────────────────────────────────────────────────────

export function ComputeResultsForm({ year, personIds }: { year: number; personIds: string[] }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<{ computed: number; skipped: unknown[] } | null>(null);
  const form = useActionForm(computeResultsAction, {
    onSuccess: (data) => {
      setSummary(data);
      router.refresh();
    },
  });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="year" value={year} />
      {/* "[]" collects every value posted under the name into one array (use-action-form.ts). */}
      {personIds.map((personId) => (
        <input key={personId} type="hidden" name="personIds[]" value={personId} />
      ))}
      {confirming ? (
        <>
          <span className="text-sm">{t("compute.confirm")}</span>
          <Button type="submit" disabled={form.pending}>
            {t("compute.yes")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
            {t("compute.one")}
          </Button>
        </>
      ) : (
        <Button type="button" onClick={() => setConfirming(true)} disabled={form.pending || personIds.length === 0}>
          {t("compute.action")}
        </Button>
      )}
      {summary ? <span className="text-sm text-muted-foreground">{t("compute.done", { computed: summary.computed, skipped: summary.skipped.length })}</span> : null}
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

export function RecomputeResultForm({ personId, year }: { personId: string; year: number }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const form = useActionForm(recomputeResultAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="inline-flex items-center gap-2">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="year" value={year} />
      <Button type="submit" variant="outline" size="sm" disabled={form.pending}>
        {t("compute.one")}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

// ── The owner's override, and settling the row ──────────────────────────────────────────────

export function OverrideResultForm({ resultId, currentPercent, reason }: { resultId: string; currentPercent: string; reason: string }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const form = useActionForm(overrideResultAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="resultId" value={resultId} />
        <div className="flex flex-wrap items-end gap-2">
          <Field name="scorePercent" label={t("override.score")}>
            <Input name="scorePercent" id="scorePercent" defaultValue={currentPercent} inputMode="decimal" maxLength={8} className="w-24" />
          </Field>
          <Field name="reason" label={t("override.reason")}>
            <Input name="reason" id="reason" defaultValue={reason} maxLength={2000} required className="w-96 max-w-full" />
          </Field>
        </div>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={form.pending}>
          {t("override.save")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
      <p className="text-xs text-muted-foreground">{t("override.hint")}</p>
    </form>
  );
}

const STEPS = { lock: lockResultAction, publish: publishResultAction, unlock: unlockResultAction } as const;

export function ResultStepForm({ resultId, step }: { resultId: string; step: keyof typeof STEPS }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const form = useActionForm(STEPS[step], { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="inline-flex items-center gap-2">
      <input type="hidden" name="resultId" value={resultId} />
      <Button type="submit" variant={step === "unlock" ? "outline" : "default"} size="sm" disabled={form.pending}>
        {t(`lock.${step === "lock" ? "action" : step}`)}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

// ── The weighting: HR proposes, the owner decides ───────────────────────────────────────────

const bp = (value: number) => String(value / 100);

export function WeightingForm({ entities, start }: { entities: Option[]; start: PerformanceWeightingValue }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const form = useActionForm(proposeWeightingAction, { onSuccess: () => router.refresh() });
  const [bands, setBands] = useState(start.bands);
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="entityId" label={t("weighting.entity")}>
            <Select name="entityId" id="entityId" defaultValue="">
              <option value="">{t("weighting.wholeGroup")}</option>
              {entities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("weighting.validFrom")}>
            <Input name="validFrom" id="validFrom" type="date" required />
          </Field>
          <Field name="note" label={t("weighting.note")}>
            <Input name="note" id="note" maxLength={2000} />
          </Field>
        </div>

        <fieldset className="grid gap-3 rounded-xl border p-3 sm:grid-cols-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("weighting.weights")}</legend>
          <Field name="reviewPercent" label={t("weighting.review")}>
            <Input name="reviewPercent" id="reviewPercent" defaultValue={bp(start.reviewBp)} inputMode="decimal" className="w-24" />
          </Field>
          <Field name="kpiPercent" label={t("weighting.kpi")}>
            <Input name="kpiPercent" id="kpiPercent" defaultValue={bp(start.kpiBp)} inputMode="decimal" className="w-24" />
          </Field>
          <Field name="okrPercent" label={t("weighting.okr")}>
            <Input name="okrPercent" id="okrPercent" defaultValue={bp(start.okrBp)} inputMode="decimal" className="w-24" />
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl border p-3 sm:grid-cols-5">
          <legend className="px-1 text-xs text-muted-foreground">{t("weighting.okrMix")}</legend>
          <Field name="okrIndividualPercent" label={t("weighting.individual")}>
            <Input name="okrIndividualPercent" id="okrIndividualPercent" defaultValue={bp(start.okrMix.individualBp)} inputMode="decimal" className="w-20" />
          </Field>
          <Field name="okrTeamPercent" label={t("weighting.team")}>
            <Input name="okrTeamPercent" id="okrTeamPercent" defaultValue={bp(start.okrMix.teamBp)} inputMode="decimal" className="w-20" />
          </Field>
          <Field name="okrDepartmentPercent" label={t("weighting.department")}>
            <Input name="okrDepartmentPercent" id="okrDepartmentPercent" defaultValue={bp(start.okrMix.departmentBp)} inputMode="decimal" className="w-20" />
          </Field>
          <Field name="okrEntityPercent" label={t("weighting.entityLevel")}>
            <Input name="okrEntityPercent" id="okrEntityPercent" defaultValue={bp(start.okrMix.entityBp)} inputMode="decimal" className="w-20" />
          </Field>
          <Field name="okrGroupPercent" label={t("weighting.group")}>
            <Input name="okrGroupPercent" id="okrGroupPercent" defaultValue={bp(start.okrMix.groupBp)} inputMode="decimal" className="w-20" />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("weighting.bands")}</legend>
          {bands.map((band, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-4">
              <Field name={`bands.${index}.key`} label={t("weighting.bandKey")}>
                <Input name={`bands.${index}.key`} id={`bands.${index}.key`} defaultValue={band.key} maxLength={40} required />
              </Field>
              <Field name={`bands.${index}.label`} label={t("weighting.bandLabel")}>
                <Input name={`bands.${index}.label`} id={`bands.${index}.label`} defaultValue={band.label} maxLength={120} required />
              </Field>
              <Field name={`bands.${index}.minPercent`} label={t("weighting.bandMin")}>
                <Input name={`bands.${index}.minPercent`} id={`bands.${index}.minPercent`} defaultValue={bp(band.minScoreBp)} inputMode="decimal" />
              </Field>
              <Field name={`bands.${index}.multiplierPercent`} label={t("weighting.bandMultiplier")}>
                <Input name={`bands.${index}.multiplierPercent`} id={`bands.${index}.multiplierPercent`} defaultValue={bp(band.multiplierBp)} inputMode="decimal" />
              </Field>
              <input type="hidden" name={`bands.${index}.labelEn`} value={band.labelEn ?? ""} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setBands([...bands, { key: `band${bands.length + 1}`, label: "", labelEn: null, minScoreBp: 0, multiplierBp: 10_000 }])}>
              {t("weighting.addBand")}
            </Button>
            {bands.length > 1 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setBands(bands.slice(0, -1))}>
                {t("weighting.removeBand")}
              </Button>
            ) : null}
          </div>
        </fieldset>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("weighting.propose")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("weighting.proposed")}</span> : null}
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
      <p className="text-xs text-muted-foreground">{t("weighting.sumHint")}</p>
    </form>
  );
}

export function DecideWeightingForm({ id }: { id: string }) {
  const t = useTranslations("performance.results");
  const router = useRouter();
  const form = useActionForm(decideWeightingAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" name="decision" value="approve" size="sm" disabled={form.pending}>
        {t("weighting.approve")}
      </Button>
      <Button type="submit" name="decision" value="reject" variant="outline" size="sm" disabled={form.pending}>
        {t("weighting.reject")}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}
