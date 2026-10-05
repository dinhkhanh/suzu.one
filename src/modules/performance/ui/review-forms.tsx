"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { REVIEW_CYCLE_KINDS, type ReviewCycleKind, type ReviewFormKind, type ReviewFormShape, templateSuits } from "../enums";
import {
  acknowledgeReviewAction,
  addReviewParticipantAction,
  advanceReviewCycleAction,
  calibrateReviewAction,
  decidePeerNominationAction,
  launchReviewCycleAction,
  nominatePeerAction,
  recordSignOffAction,
  releaseCycleAction,
  releaseReviewAction,
  returnReviewFormAction,
  saveReviewCycleAction,
  saveReviewFormAction,
  withdrawPeerNominationAction,
} from "../review-actions";

const ERRORS = "performance.reviews.errors";
type Option = { id: string; name: string };

// ── Writing a review ────────────────────────────────────────────────────────────────────────

export type ReviewFormValue = {
  participantId: string;
  kind: ReviewFormKind;
  shape: ReviewFormShape;
  answers: Record<string, string | number>;
  comment: string | null;
  submitted: boolean;
  /** HR sent it back: why, for its author to read. */
  returnReason?: string | null;
};

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
      {value.returnReason ? (
        <Alert variant="warning">
          <p className="font-medium">{t("returned.title")}</p>
          <p>{value.returnReason}</p>
        </Alert>
      ) : null}
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
                <NoteEditor name={`answers.${section.key}`} id={`answers.${section.key}`} defaultValue={String(value.answers[section.key] ?? "")} rows={4} maxLength={8000} />
              )}
            </Field>
          ))}
          <Field name="comment" label={t("form.comment")}>
            <NoteEditor name="comment" id="comment" defaultValue={value.comment ?? ""} rows={3} maxLength={8000} />
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
    <form onSubmit={form.onSubmit} className="toolbar">
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
          <NoteEditor name="note" id="note" rows={2} maxLength={4000} />
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

/** The sign-off conversation (FR-PRF-03): the day it was held and what was agreed. */
export function SignOffForm({ participantId, today }: { participantId: string; today: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(recordSignOffAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="participantId" value={participantId} />
        <Field name="heldOn" label={t("signOff.heldOn")}>
          <DatePicker name="heldOn" id="heldOn" defaultValue={today} max={today} required className="w-48" />
        </Field>
        <Field name="note" label={t("signOff.note")}>
          <NoteEditor name="note" id="sign-off-note" rows={2} maxLength={4000} />
        </Field>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("signOff.action")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

/** HR sends a submitted form back to its author, with the reason they will read. */
export function ReturnFormForm({ formId }: { formId: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useActionForm(returnReviewFormAction, { onSuccess: () => router.refresh() });
  if (!open)
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        {t("returned.action")}
      </Button>
    );
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="formId" value={formId} />
        <Field name="reason" label={t("returned.reason")}>
          <Input name="reason" id={`return-${formId}`} maxLength={2000} required />
        </Field>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("returned.yes")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          {t("form.cancel")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

// ── Peer / 360 nominations (week 2) ─────────────────────────────────────────────────────────

export function NominatePeerForm({ participantId, candidates }: { participantId: string; candidates: { id: string; fullName: string }[] }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(nominatePeerAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="toolbar">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="participantId" value={participantId} />
        <Field name="peerPersonId" label={t("peers.add")}>
          <Select name="peerPersonId" id="peerPersonId" defaultValue="" required className="w-64">
            <option value="">{t("peers.choose")}</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="note" label={t("peers.note")}>
          <Input name="note" id="note" maxLength={500} className="w-64" />
        </Field>
      </FieldErrors>
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("peers.submit")}
      </Button>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
    </form>
  );
}

export function NominationDecisionForm({ nominationId, canDecide, canWithdraw }: { nominationId: string; canDecide: boolean; canWithdraw: boolean }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const decide = useActionForm(decidePeerNominationAction, { onSuccess: () => router.refresh() });
  const withdraw = useActionForm(withdrawPeerNominationAction, { onSuccess: () => router.refresh() });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {canDecide ? (
        <form onSubmit={decide.onSubmit} className="inline-flex items-center gap-1">
          <input type="hidden" name="nominationId" value={nominationId} />
          <Button type="submit" name="decision" value="approve" size="sm" disabled={decide.pending}>
            {t("peers.approve")}
          </Button>
          <Button type="submit" name="decision" value="decline" size="sm" variant="outline" disabled={decide.pending}>
            {t("peers.decline")}
          </Button>
          <FormError namespace={ERRORS} errorKey={decide.errorKey} />
        </form>
      ) : null}
      {canWithdraw ? (
        <form onSubmit={withdraw.onSubmit} className="inline-flex items-center gap-1">
          <input type="hidden" name="nominationId" value={nominationId} />
          <Button type="submit" size="sm" variant="outline" disabled={withdraw.pending}>
            {t("peers.withdraw")}
          </Button>
          <FormError namespace={ERRORS} errorKey={withdraw.errorKey} />
        </form>
      ) : null}
    </span>
  );
}

export function ReleaseCycleForm({ cycleId }: { cycleId: string }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<{ released: number; skipped: unknown[] } | null>(null);
  const form = useActionForm(releaseCycleAction, {
    onSuccess: (data) => {
      setSummary(data);
      router.refresh();
    },
  });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="cycleId" value={cycleId} />
      {confirming ? (
        <>
          <span className="text-sm">{t("release.cycleConfirm")}</span>
          <Button type="submit" disabled={form.pending}>
            {t("release.yes")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
            {t("form.cancel")}
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirming(true)} disabled={form.pending}>
          {t("release.cycleAction")}
        </Button>
      )}
      {summary ? <span className="text-sm text-muted-foreground">{t("release.cycleDone", { released: summary.released, skipped: summary.skipped.length })}</span> : null}
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
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
  signOffRequired: boolean;
  isRolling: boolean;
};

const DATES = ["periodStart", "periodEnd", "selfDueOn", "managerDueOn", "peerDueOn", "calibrationOn", "releaseOn"] as const;
// A rolling probation cycle has no deadlines of its own: each person gets theirs from their probation.
const ROLLING_DATES = ["periodStart", "periodEnd"] as const;

export type TemplateOption = Option & { kinds: ReviewCycleKind[] };

/** A labelled checkbox that posts "on" under `name`, as the actions' `checkbox` fields read it. */
function CheckField({ name, label, defaultChecked, onChange }: { name: string; label: string; defaultChecked: boolean; onChange?: (checked: boolean) => void }) {
  return (
    <Label className="flex items-center gap-2 font-normal">
      <Checkbox name={name} value="on" defaultChecked={defaultChecked} onCheckedChange={(checked) => onChange?.(checked === true)} />
      {label}
    </Label>
  );
}

export function CycleForm({ value, entities, templates, groupWide = true }: { value: CycleFormValue; entities: Option[]; templates: TemplateOption[]; groupWide?: boolean }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const [kind, setKind] = useState<ReviewCycleKind>(value.kind);
  const [rolling, setRolling] = useState(value.isRolling);
  const form = useActionForm(saveReviewCycleAction, { onSuccess: () => router.refresh() });
  // Only the forms meant for this kind of cycle are offered; the server refuses any other.
  const suitable = templates.filter((template) => templateSuits(template, kind));
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
              {groupWide ? <option value="">{t("cycle.wholeGroup")}</option> : null}
              {entities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="kind" label={t("cycle.kind")}>
            <Select name="kind" id="kind" value={kind} onChange={(event) => setKind(event.target.value as ReviewCycleKind)}>
              {REVIEW_CYCLE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`cycle.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="templateId" label={t("cycle.template")}>
            <Select key={kind} name="templateId" id="templateId" defaultValue={suitable.some((option) => option.id === value.templateId) ? value.templateId : ""} required>
              <option value="">—</option>
              {suitable.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="year" label={t("cycle.year")}>
            <Input name="year" id="year" type="number" defaultValue={value.year} min={2000} max={2100} required />
          </Field>
          {(rolling && kind === "probation" ? ROLLING_DATES : DATES).map((key) => (
            <Field key={key} name={key} label={t(`timeline.${key}`)}>
              <DatePicker name={key} id={key} defaultValue={value[key] ?? ""} required={key === "periodStart" || key === "periodEnd"} />
            </Field>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {kind === "probation" ? <CheckField name="isRolling" label={t("cycle.isRolling")} defaultChecked={value.isRolling} onChange={setRolling} /> : null}
          {kind === "probation" && rolling ? <p className="text-xs text-muted-foreground">{t("cycle.rollingHint")}</p> : null}
          <CheckField name="signOffRequired" label={t("cycle.signOffRequired")} defaultChecked={value.signOffRequired} />
        </div>
        <fieldset className="flex flex-wrap items-end gap-4 rounded-xl border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("cycle.peers")}</legend>
          <CheckField name="peersEnabled" label={t("cycle.peersEnabled")} defaultChecked={value.peersEnabled} />
          <Field name="peerMin" label={t("cycle.peerMin")}>
            <Input name="peerMin" id="peerMin" type="number" defaultValue={value.peerMin} min={0} max={20} className="w-20" />
          </Field>
          <Field name="peerMax" label={t("cycle.peerMax")}>
            <Input name="peerMax" id="peerMax" type="number" defaultValue={value.peerMax} min={0} max={20} className="w-20" />
          </Field>
          <CheckField name="peerAnonymous" label={t("cycle.peerAnonymous")} defaultChecked={value.peerAnonymous} />
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

/**
 * Putting one person into a cycle by hand: somebody the launch missed, or a probation HR does not
 * want to wait for. Their own deadlines win over the cycle's; a rolling cycle's people need them.
 */
export function AddParticipantForm({ cycleId, candidates, needsDates }: { cycleId: string; candidates: Option[]; needsDates: boolean }) {
  const t = useTranslations("performance.reviews");
  const router = useRouter();
  const form = useActionForm(addReviewParticipantAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <input type="hidden" name="cycleId" value={cycleId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="personId" label={t("columns.person")}>
            <Select name="personId" id="add-personId" defaultValue="" required>
              <option value="">{t("peers.choose")}</option>
              {candidates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="selfDueOn" label={t("timeline.selfDueOn")}>
            <DatePicker name="selfDueOn" id="add-selfDueOn" required={needsDates} />
          </Field>
          <Field name="managerDueOn" label={t("timeline.managerDueOn")}>
            <DatePicker name="managerDueOn" id="add-managerDueOn" required={needsDates} />
          </Field>
        </div>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{needsDates ? t("admin.addRollingHint") : t("admin.addHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("admin.add")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
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
