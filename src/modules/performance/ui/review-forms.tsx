"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { REVIEW_CYCLE_KINDS, type ReviewCycleKind, type ReviewFormKind, type ReviewFormShape } from "../enums";
import { acknowledgeReviewAction, advanceReviewCycleAction, calibrateReviewAction, launchReviewCycleAction, releaseReviewAction, saveReviewCycleAction, saveReviewFormAction } from "../review-actions";

const ERRORS = "performance.reviews.errors";
type Option = { id: string; name: string };

// ── Writing a review ────────────────────────────────────────────────────────────────────────

export type ReviewFormValue = { participantId: string; kind: ReviewFormKind; shape: ReviewFormShape; answers: Record<string, string | number>; comment: string | null; submitted: boolean };

/**
 * The form one author fills in. Saving keeps a draft (private to the author); submitting scores it
 * and hands it on — which is why the submit button asks first.
 */
export function ReviewFormEditor({ value }: { value: ReviewFormValue }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const form = useActionForm(saveReviewFormAction, { onSuccess: () => router.refresh() });
  const asked = value.shape.sections.filter((section) => section.askedOf.includes(value.kind));

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="participantId" value={value.participantId} />
        <input type="hidden" name="kind" value={value.kind} />
        <div className="flex flex-col gap-4">
          {asked.map((section) => (
            <Field key={section.key} name={`answers.${section.key}`} label={`${section.title}${section.required ? " *" : ""}`}>
              {section.kind === "rating" ? (
                <Select name={`answers.${section.key}`} id={`answers.${section.key}`} defaultValue={String(value.answers[section.key] ?? "")}>
                  <option value="">{t("form.choose")}</option>
                  {value.shape.ratingScale.map((point) => (
                    <option key={point.value} value={point.value}>
                      {point.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <textarea
                  name={`answers.${section.key}`}
                  id={`answers.${section.key}`}
                  defaultValue={String(value.answers[section.key] ?? "")}
                  rows={4}
                  maxLength={8000}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              )}
            </Field>
          ))}
          <Field name="comment" label={t("form.comment")}>
            <textarea name="comment" id="comment" defaultValue={value.comment ?? ""} rows={3} maxLength={8000} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
          </Field>
        </div>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="submit" value="" variant="outline" disabled={form.pending}>
          {t("form.saveDraft")}
        </Button>
        {confirming ? (
          <>
            <span className="text-sm">{t("form.submitConfirm")}</span>
            <Button type="submit" name="submit" value="on" disabled={form.pending}>
              {t("form.submitYes")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {t("form.cancel")}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)} disabled={form.pending}>
            {t("form.submit")}
          </Button>
        )}
        {form.saved ? <span className="text-sm text-muted-foreground">{t("form.saved")}</span> : null}
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
      <p className="text-xs text-muted-foreground">{t("form.draftHint")}</p>
    </form>
  );
}

// ── Calibration, release, acknowledgement ───────────────────────────────────────────────────

export function CalibrateForm({ participantId, currentPercent }: { participantId: string; currentPercent: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(calibrateReviewAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-end gap-2">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="participantId" value={participantId} />
        <Field name="ratingPercent" label={t("calibrate.rating")}>
          <Input name="ratingPercent" id="ratingPercent" defaultValue={currentPercent} inputMode="decimal" maxLength={8} className="w-24" />
        </Field>
        <Field name="note" label={t("calibrate.note")}>
          <Input name="note" id="note" maxLength={2000} required className="w-72" />
        </Field>
      </FieldErrors>
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("calibrate.save")}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

export function ReleaseForm({ participantId }: { participantId: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const form = useActionForm(releaseReviewAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="participantId" value={participantId} />
      {confirming ? (
        <>
          <span className="text-sm">{t("release.confirm")}</span>
          <Button type="submit" disabled={form.pending}>
            {t("release.yes")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
            {t("form.cancel")}
          </Button>
        </>
      ) : (
        <Button type="button" onClick={() => setConfirming(true)}>
          {t("release.action")}
        </Button>
      )}
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

export function AcknowledgeForm({ participantId }: { participantId: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(acknowledgeReviewAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="participantId" value={participantId} />
        <Field name="note" label={t("acknowledge.note")}>
          <textarea name="note" id="note" rows={2} maxLength={4000} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
        </Field>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("acknowledge.action")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

// ── HR: the cycle builder ───────────────────────────────────────────────────────────────────

export type CycleFormValue = {
  id: string | null;
  entityId: string | null;
  name: string;
  kind: ReviewCycleKind;
  year: number;
  periodStart: string;
  periodEnd: string;
  templateId: string;
  selfDueOn: string | null;
  managerDueOn: string | null;
  peerDueOn: string | null;
  calibrationOn: string | null;
  releaseOn: string | null;
  peersEnabled: boolean;
  peerMin: number;
  peerMax: number;
  peerAnonymous: boolean;
};

const DATES = ["periodStart", "periodEnd", "selfDueOn", "managerDueOn", "peerDueOn", "calibrationOn", "releaseOn"] as const;

export function CycleForm({ value, entities, templates }: { value: CycleFormValue; entities: Option[]; templates: Option[] }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(saveReviewCycleAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        {value.id ? <input type="hidden" name="cycleId" value={value.id} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label={t("cycle.name")}>
            <Input name="name" id="name" defaultValue={value.name} maxLength={200} required />
          </Field>
          <Field name="entityId" label={t("cycle.entity")}>
            <Select name="entityId" id="entityId" defaultValue={value.entityId ?? ""}>
              <option value="">{t("cycle.wholeGroup")}</option>
              {entities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="kind" label={t("cycle.kind")}>
            <Select name="kind" id="kind" defaultValue={value.kind}>
              {REVIEW_CYCLE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`cycle.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="templateId" label={t("cycle.template")}>
            <Select name="templateId" id="templateId" defaultValue={value.templateId} required>
              <option value="">—</option>
              {templates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="year" label={t("cycle.year")}>
            <Input name="year" id="year" type="number" defaultValue={value.year} min={2000} max={2100} required />
          </Field>
          {DATES.map((key) => (
            <Field key={key} name={key} label={t(`timeline.${key}`)}>
              <Input name={key} id={key} type="date" defaultValue={value[key] ?? ""} required={key === "periodStart" || key === "periodEnd"} />
            </Field>
          ))}
        </div>
        <fieldset className="flex flex-wrap items-end gap-4 rounded-xl border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("cycle.peers")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="peersEnabled" defaultChecked={value.peersEnabled} />
            {t("cycle.peersEnabled")}
          </label>
          <Field name="peerMin" label={t("cycle.peerMin")}>
            <Input name="peerMin" id="peerMin" type="number" defaultValue={value.peerMin} min={0} max={20} className="w-20" />
          </Field>
          <Field name="peerMax" label={t("cycle.peerMax")}>
            <Input name="peerMax" id="peerMax" type="number" defaultValue={value.peerMax} min={0} max={20} className="w-20" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="peerAnonymous" defaultChecked={value.peerAnonymous} />
            {t("cycle.peerAnonymous")}
          </label>
        </fieldset>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("cycle.save")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("cycle.saved")}</span> : null}
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

export function LaunchCycleForm({ cycleId }: { cycleId: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const form = useActionForm(launchReviewCycleAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="cycleId" value={cycleId} />
      {confirming ? (
        <>
          <span className="text-sm">{t("cycle.launchConfirm")}</span>
          <Button type="submit" disabled={form.pending}>
            {t("cycle.launchYes")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
            {t("form.cancel")}
          </Button>
        </>
      ) : (
        <Button type="button" onClick={() => setConfirming(true)}>
          {t("cycle.launch")}
        </Button>
      )}
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

export function AdvanceCycleForm({ cycleId, to, label }: { cycleId: string; to: string; label: string }) {
  const router = useRouter();
  const form = useActionForm(advanceReviewCycleAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="to" value={to} />
      <Button type="submit" variant="outline" disabled={form.pending}>
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}
