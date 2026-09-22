"use client";
// The forms of the commercial pages — retainer, change requests, acceptance, billing, client
// reports, close-out. Each posts to one server action, which re-checks access and ignores money
// fields from anyone without `pjm:commercial`; the page decides which forms and fields to show.
// Mobile first: fields stack on a phone and sit in a row from `sm`.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { CHANNELS, CONTENT_FORMATS } from "../../work/enums";
import {
  beginChangeEvidenceAction,
  beginSignedScanAction,
  closeProjectAction,
  completeChangeEvidenceAction,
  completeSignedScanAction,
  createAcceptanceAction,
  createManualBillingAction,
  decideBillingAction,
  openChangeEvidenceAction,
  openSignedScanAction,
  publishLessonsAction,
  refreshAcceptanceAction,
  saveChangeAction,
  saveClientReportAction,
  saveRetainerAction,
  saveRetroAction,
  sendAcceptanceAction,
  signAcceptanceAction,
  submitChangeAction,
  voidAcceptanceAction,
  withdrawChangeAction,
} from "../commercial-actions";
import { ActionButton, ActionForm } from "./plan-forms";

type Line = { title: string; quantity: number; format: string | null; channel: string | null };
type Upload = { fileId: string; uploadUrl: string; contentType: string };
type Stored = { fileId: string; fileName: string };

const textarea = "min-h-20 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm";
const hoursOf = (minutes: number | null | undefined) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : "");

/** Rows of register lines — a retainer's monthly template, or the lines a change adds. Two blank rows to fill. */
function LineRows({ name, lines, idPrefix }: { name: string; lines: readonly Line[]; idPrefix: string }) {
  const t = useTranslations("projects");
  const tWork = useTranslations("work");
  const rows = [...lines, { title: "", quantity: 0, format: null, channel: null }, { title: "", quantity: 0, format: null, channel: null }];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((line, index) => (
        <div key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[5rem_1fr_9rem_9rem] sm:border-0 sm:p-0">
          <Input aria-label={t("fields.quantity")} id={`${idPrefix}-q-${index}`} name={`${name}.${index}.quantity`} type="number" min={1} max={1000} defaultValue={line.quantity || ""} placeholder={t("fields.quantity")} />
          <Input aria-label={t("fields.deliverable")} id={`${idPrefix}-t-${index}`} name={`${name}.${index}.title`} maxLength={200} defaultValue={line.title} placeholder={t("register.titleHint")} />
          <Select aria-label={t("fields.format")} id={`${idPrefix}-f-${index}`} name={`${name}.${index}.format`} defaultValue={line.format ?? ""}>
            <option value="">{t("fields.format")}</option>
            {CONTENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {tWork(`formats.${format}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t("fields.channel")} id={`${idPrefix}-c-${index}`} name={`${name}.${index}.channel`} defaultValue={line.channel ?? ""}>
            <option value="">{t("fields.channel")}</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {tWork(`channels.${channel}`)}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

/** Picks a file, uploads it straight to storage and hands its id to the form. */
export function UploadField({ label, name, begin, complete, required, initial }: { label: string; name: string; begin: (meta: { fileName: string; sizeBytes: number }) => Promise<ActionResult<Upload>>; complete: (fileId: string) => Promise<ActionResult<Stored>>; required?: boolean; initial?: Stored | null }) {
  const t = useTranslations("projects");
  const tErrors = useTranslations("projects.errors");
  const [pending, startTransition] = useTransition();
  const [stored, setStored] = useState<Stored | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Field name={name} label={label}>
      <input type="hidden" name={name} value={stored?.fileId ?? ""} />
      <input
        id={name}
        type="file"
        required={required && !stored}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.eml,.msg,.docx"
        disabled={pending}
        className="text-sm"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          startTransition(async () => {
            const result = await uploadThroughSignedUrl(file, begin, complete);
            setError(result.ok ? null : result.errorKey);
            setStored(result.ok ? result.data : null);
          });
        }}
      />
      {pending ? <span className="text-xs text-muted-foreground">{t("uploading")}</span> : null}
      {stored ? <span className="text-xs text-muted-foreground">{t("uploaded", { name: stored.fileName })}</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {tErrors.has(error) ? tErrors(error) : tErrors("generic")}
        </span>
      ) : null}
    </Field>
  );
}

// ── Retainer (FR-PJM-06) ────────────────────────────────────────────────────────────────────

export type RetainerValues = { startMonth: string; endMonth: string | null; lines: Line[]; minutesPerMonth: number | null; feePerMonthVnd?: number | null; rollover: string; isActive: boolean };

/**
 * The terms. The months and the switch decide what is billed and for how long, so they are the
 * fee-holder's (`editFee`) — for anyone else they are shown as they stand and posted unchanged,
 * and the action refuses a change all the same.
 */
export function RetainerForm({ projectId, values, rollovers, editFee, defaultMonth }: { projectId: string; values: RetainerValues | null; rollovers: readonly string[]; editFee: boolean; defaultMonth: string }) {
  const t = useTranslations("projects.retainer");
  return (
    <ActionForm action={saveRetainerAction} extra={{ projectId }} submit={t("save")}>
      {editFee ? null : <p className="text-xs text-muted-foreground">{t("monthsLocked")}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="startMonth" label={t("startMonth")}>
          <Input id="startMonth" name="startMonth" type="month" required readOnly={!editFee} defaultValue={values?.startMonth ?? defaultMonth} />
        </Field>
        <Field name="endMonth" label={t("endMonth")}>
          <Input id="endMonth" name="endMonth" type="month" readOnly={!editFee} defaultValue={values?.endMonth ?? ""} />
        </Field>
        <Field name="rollover" label={t("rollover")}>
          <Select id="rollover" name="rollover" defaultValue={values?.rollover ?? "reset"}>
            {rollovers.map((rule) => (
              <option key={rule} value={rule}>
                {t(`rollovers.${rule as "reset"}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("lines")}</legend>
        <p className="text-xs text-muted-foreground">{t("linesHint")}</p>
        <LineRows name="lines" lines={values?.lines ?? []} idPrefix="retainer" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="hoursPerMonth" label={t("hoursPerMonth")}>
          <Input id="hoursPerMonth" name="hoursPerMonth" type="number" min={0} step="0.5" defaultValue={hoursOf(values?.minutesPerMonth)} />
        </Field>
        {editFee ? (
          <Field name="feePerMonthVnd" label={t("feePerMonth")}>
            <Input id="feePerMonthVnd" name="feePerMonthVnd" inputMode="numeric" defaultValue={values?.feePerMonthVnd ?? ""} placeholder="60.000.000" />
          </Field>
        ) : null}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="isActive" disabled={!editFee} defaultChecked={values?.isActive ?? true} />
          {/* A disabled checkbox posts nothing: the value it shows is sent beside it, unchanged. */}
          {editFee ? null : values?.isActive ? <input type="hidden" name="isActive" value="on" /> : null}
          {t("active")}
        </label>
      </div>
    </ActionForm>
  );
}

// ── Change requests (FR-PJM-11) ─────────────────────────────────────────────────────────────

export type ChangeValues = { id: string; title: string; description: string | null; requestedBy: string; lines: Line[]; cancelIds: string[]; minutesDelta: number | null; feeDeltaVnd?: number | null; dueDateTo: string | null; evidenceUrl: string | null; evidence: Stored | null };

export function ChangeForm({ projectId, change, register, requesters, editFee }: { projectId: string; change?: ChangeValues; register: { id: string; title: string; quantity: number }[]; requesters: readonly string[]; editFee: boolean }) {
  const t = useTranslations("projects.changes");
  const id = change?.id ?? "new";
  return (
    <ActionForm action={saveChangeAction} extra={{ projectId, changeId: change?.id ?? null }} submit={change ? t("saveDraft") : t("create")}>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field name="title" label={t("fields.title")}>
          <Input id={`cr-title-${id}`} name="title" required maxLength={200} defaultValue={change?.title ?? ""} />
        </Field>
        <Field name="requestedBy" label={t("fields.requestedBy")}>
          <Select id={`cr-by-${id}`} name="requestedBy" defaultValue={change?.requestedBy ?? "client"}>
            {requesters.map((who) => (
              <option key={who} value={who}>
                {t(`requesters.${who as "client"}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field name="description" label={t("fields.description")}>
        <textarea id={`cr-desc-${id}`} name="description" rows={3} maxLength={4000} defaultValue={change?.description ?? ""} className={textarea} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("fields.addLines")}</legend>
        <LineRows name="lines" lines={change?.lines ?? []} idPrefix={`cr-${id}`} />
      </fieldset>
      {register.length ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t("fields.cancelLines")}</legend>
          {register.map((line) => (
            <label key={line.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cancelIds[]" value={line.id} defaultChecked={change?.cancelIds.includes(line.id)} />
              {line.quantity} × {line.title}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="hoursDelta" label={t("fields.hoursDelta")}>
          <Input id={`cr-hours-${id}`} name="hoursDelta" type="number" step="0.5" defaultValue={hoursOf(change?.minutesDelta)} placeholder="+10 / -4" />
        </Field>
        {editFee ? (
          <Field name="feeDeltaVnd" label={t("fields.feeDelta")}>
            <Input id={`cr-fee-${id}`} name="feeDeltaVnd" inputMode="numeric" defaultValue={change?.feeDeltaVnd ?? ""} placeholder="+15.000.000" />
          </Field>
        ) : null}
        <Field name="dueDateTo" label={t("fields.dueDateTo")}>
          <Input id={`cr-due-${id}`} name="dueDateTo" type="date" defaultValue={change?.dueDateTo ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UploadField label={t("fields.evidenceFile")} name="evidenceFileId" initial={change?.evidence} begin={(meta) => beginChangeEvidenceAction({ projectId, ...meta }) as Promise<ActionResult<Upload>>} complete={(fileId) => completeChangeEvidenceAction({ fileId }) as Promise<ActionResult<Stored>>} />
        <Field name="evidenceUrl" label={t("fields.evidenceUrl")}>
          <Input id={`cr-url-${id}`} name="evidenceUrl" type="url" maxLength={500} defaultValue={change?.evidenceUrl ?? ""} placeholder="https://" />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t("evidenceHint")}</p>
    </ActionForm>
  );
}

export function ChangeButtons({ changeId, canSubmit, canWithdraw, resubmit }: { changeId: string; canSubmit: boolean; canWithdraw: boolean; resubmit: boolean }) {
  const t = useTranslations("projects.changes");
  return (
    <span className="flex flex-wrap gap-2">
      {canSubmit ? <ActionButton action={submitChangeAction} input={{ changeId }} label={resubmit ? t("resubmit") : t("submit")} variant="default" /> : null}
      {canWithdraw ? <ActionButton action={withdrawChangeAction} input={{ changeId }} label={t("withdraw")} confirm={t("withdrawConfirm")} /> : null}
    </span>
  );
}

export function EvidenceLink({ projectId, fileId, fileName }: { projectId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openChangeEvidenceAction({ projectId, ...(input as object) }) as Promise<ActionResult<{ url: string }>>} />;
}

// ── Acceptance (FR-PJM-55) ──────────────────────────────────────────────────────────────────

export function NewAcceptanceForm({ projectId, milestones, periods }: { projectId: string; milestones: { id: string; name: string }[]; periods: { id: string; month: string }[] }) {
  const t = useTranslations("projects.acceptance");
  const [scope, setScope] = useState(milestones.length ? "milestone" : periods.length ? "retainer_period" : "project");
  return (
    <ActionForm action={createAcceptanceAction} extra={{ projectId }} submit={t("create")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="scope" label={t("scope")}>
          <Select id="scope" name="scope" value={scope} onChange={(event) => setScope(event.currentTarget.value)}>
            {milestones.length ? <option value="milestone">{t("scopes.milestone")}</option> : null}
            {periods.length ? <option value="retainer_period">{t("scopes.retainer_period")}</option> : null}
            <option value="project">{t("scopes.project")}</option>
          </Select>
        </Field>
        {scope === "milestone" ? (
          <Field name="milestoneId" label={t("milestone")}>
            <Select id="milestoneId" name="milestoneId" required defaultValue="">
              <option value="" disabled>
                {t("pick")}
              </option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : scope === "retainer_period" ? (
          <Field name="retainerPeriodId" label={t("month")}>
            <Select id="retainerPeriodId" name="retainerPeriodId" required defaultValue="">
              <option value="" disabled>
                {t("pick")}
              </option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.month}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("snapshotHint")}</p>
    </ActionForm>
  );
}

export function AcceptanceButtons({ acceptanceId, status }: { acceptanceId: string; status: string }) {
  const t = useTranslations("projects.acceptance");
  return (
    <span className="flex flex-wrap gap-2">
      {status === "draft" ? <ActionButton action={refreshAcceptanceAction} input={{ acceptanceId }} label={t("refresh")} /> : null}
      {status === "draft" ? <ActionButton action={sendAcceptanceAction} input={{ acceptanceId }} label={t("send")} /> : null}
      {status === "draft" || status === "sent" ? <ActionButton action={voidAcceptanceAction} input={{ acceptanceId }} label={t("void")} confirm={t("voidConfirm")} variant="ghost" /> : null}
    </span>
  );
}

export function SignAcceptanceForm({ acceptanceId, today }: { acceptanceId: string; today: string }) {
  const t = useTranslations("projects.acceptance");
  return (
    <ActionForm action={signAcceptanceAction} extra={{ acceptanceId }} submit={t("sign")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <UploadField label={t("signedScan")} name="signedFileId" required begin={(meta) => beginSignedScanAction({ acceptanceId, ...meta }) as Promise<ActionResult<Upload>>} complete={(fileId) => completeSignedScanAction({ fileId }) as Promise<ActionResult<Stored>>} />
        <Field name="signedOn" label={t("signedOn")}>
          <Input id={`signedOn-${acceptanceId}`} name="signedOn" type="date" required max={today} defaultValue={today} />
        </Field>
        <Field name="signedByClient" label={t("signedBy")}>
          <Input id={`signedBy-${acceptanceId}`} name="signedByClient" required maxLength={200} />
        </Field>
      </div>
    </ActionForm>
  );
}

export function SignedScanLink({ acceptanceId, label }: { acceptanceId: string; label: string }) {
  return <FileLink fileId={acceptanceId} fileName={label} download={() => openSignedScanAction({ acceptanceId }) as Promise<ActionResult<{ url: string }>>} />;
}

// ── Billing (FR-PJM-56) ─────────────────────────────────────────────────────────────────────

export function BillingDecisionForm({ itemId, needsAmount, today }: { itemId: string; needsAmount: boolean; today: string }) {
  const t = useTranslations("projects.billing");
  const [mode, setMode] = useState<"invoice" | "waive">("invoice");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 text-sm" role="tablist">
        {(["invoice", "waive"] as const).map((each) => (
          <Button key={each} type="button" size="xs" variant={mode === each ? "default" : "outline"} onClick={() => setMode(each)} aria-pressed={mode === each}>
            {t(each)}
          </Button>
        ))}
      </div>
      {mode === "invoice" ? (
        <ActionForm action={decideBillingAction} extra={{ itemId, action: "invoice" }} submit={t("markInvoiced")}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field name="invoiceNumber" label={t("invoiceNumber")}>
              <Input id={`inv-no-${itemId}`} name="invoiceNumber" required maxLength={60} />
            </Field>
            <Field name="invoiceDate" label={t("invoiceDate")}>
              <Input id={`inv-date-${itemId}`} name="invoiceDate" type="date" required defaultValue={today} />
            </Field>
            {needsAmount ? (
              <Field name="amountVnd" label={t("amount")}>
                <Input id={`inv-amount-${itemId}`} name="amountVnd" inputMode="numeric" />
              </Field>
            ) : null}
          </div>
        </ActionForm>
      ) : (
        <ActionForm action={decideBillingAction} extra={{ itemId, action: "waive" }} submit={t("markWaived")}>
          <Field name="reason" label={t("waiveReason")}>
            <Input id={`waive-${itemId}`} name="reason" required maxLength={1000} />
          </Field>
        </ActionForm>
      )}
    </div>
  );
}

export function ManualBillingForm({ projectId }: { projectId: string | null }) {
  const t = useTranslations("projects.billing");
  return (
    <ActionForm action={createManualBillingAction} extra={projectId ? { projectId } : {}} submit={t("addManual")}>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        {projectId ? null : (
          <Field name="jobNumber" label={t("jobNumber")}>
            <Input id="manual-job" name="jobNumber" required maxLength={40} placeholder="SZM-26-042" className="font-mono" />
          </Field>
        )}
        <Field name="description" label={t("description")}>
          <Input id="manual-desc" name="description" required maxLength={300} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field name="reference" label={t("reference")}>
          <Input id="manual-ref" name="reference" maxLength={120} placeholder={t("referenceHint")} />
        </Field>
        <Field name="amountVnd" label={t("amount")}>
          <Input id="manual-amount" name="amountVnd" inputMode="numeric" />
        </Field>
      </div>
    </ActionForm>
  );
}

// ── Client reports (FR-PJM-58) ──────────────────────────────────────────────────────────────

export type ReportValues = { id: string; title: string; periodFrom: string; periodTo: string; summary: string | null; nextPlan: string | null; showHours: boolean };

export function ClientReportForm({ projectId, report, defaults }: { projectId: string; report?: ReportValues; defaults: { title: string; from: string; to: string } }) {
  const t = useTranslations("projects.reports");
  const id = report?.id ?? "new";
  return (
    <ActionForm action={saveClientReportAction} extra={{ projectId, reportId: report?.id ?? null }} submit={report ? t("save") : t("create")}>
      <Field name="title" label={t("fields.title")}>
        <Input id={`rep-title-${id}`} name="title" required maxLength={200} defaultValue={report?.title ?? defaults.title} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="periodFrom" label={t("fields.from")}>
          <Input id={`rep-from-${id}`} name="periodFrom" type="date" required defaultValue={report?.periodFrom ?? defaults.from} />
        </Field>
        <Field name="periodTo" label={t("fields.to")}>
          <Input id={`rep-to-${id}`} name="periodTo" type="date" required defaultValue={report?.periodTo ?? defaults.to} />
        </Field>
      </div>
      <Field name="summary" label={t("fields.summary")}>
        <textarea id={`rep-summary-${id}`} name="summary" rows={5} maxLength={8000} defaultValue={report?.summary ?? ""} className={textarea} />
      </Field>
      <Field name="nextPlan" label={t("fields.nextPlan")}>
        <textarea id={`rep-next-${id}`} name="nextPlan" rows={4} maxLength={8000} defaultValue={report?.nextPlan ?? ""} className={textarea} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="showHours" defaultChecked={report?.showHours ?? false} />
        {t("fields.showHours")}
      </label>
    </ActionForm>
  );
}

// ── Close-out (FR-PJM-59) ───────────────────────────────────────────────────────────────────

export type RetroValues = { heldOn: string; wentWell?: string; improve?: string; actions?: string };

export function RetroForm({ projectId, retro, today }: { projectId: string; retro: RetroValues | null; today: string }) {
  const t = useTranslations("projects.close");
  const area = (name: "wentWell" | "improve" | "actions") => (
    <Field name={name} label={t(`retro.${name}`)}>
      <textarea id={`retro-${name}`} name={name} rows={4} maxLength={8000} defaultValue={retro?.[name] ?? ""} placeholder={t(`retro.hints.${name}`)} className={textarea} />
    </Field>
  );
  return (
    <ActionForm action={saveRetroAction} extra={{ projectId }} submit={t("retro.save")}>
      <Field name="heldOn" label={t("retro.heldOn")}>
        <Input id="retro-heldOn" name="heldOn" type="date" required max={today} defaultValue={retro?.heldOn ?? today} className="sm:w-48" />
      </Field>
      {area("wentWell")}
      {area("improve")}
      {area("actions")}
    </ActionForm>
  );
}

export function PublishLessonsForm({ projectId, spaces }: { projectId: string; spaces: { id: string; name: string }[] }) {
  const t = useTranslations("projects.close");
  const router = useRouter();
  const [done, setDone] = useState<{ pageId: string; spaceKey: string } | null>(null);
  if (done) return <p className="text-sm text-muted-foreground">{t("lessonsDone")}</p>;
  return (
    <ActionForm action={async (input) => {
      const result = await publishLessonsAction(input);
      if (result.ok) {
        setDone(result.data);
        router.push(`/kb/pages/${result.data.pageId}/edit`);
      }
      return result;
    }} extra={{ projectId }} submit={t("publishLessons")}>
      <Field name="spaceId" label={t("lessonsSpace")}>
        <Select id="spaceId" name="spaceId" required defaultValue="">
          <option value="" disabled>
            {t("pickSpace")}
          </option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">{t("lessonsHint")}</p>
    </ActionForm>
  );
}

export function CloseProjectForm({ projectId, unmet }: { projectId: string; unmet: boolean }) {
  const t = useTranslations("projects.close");
  return (
    <ActionForm action={closeProjectAction} extra={{ projectId }} submit={t("close")}>
      {unmet ? (
        <Field name="overrideReason" label={t("overrideReason")}>
          <textarea id="overrideReason" name="overrideReason" rows={3} required maxLength={2000} placeholder={t("overrideHint")} className={textarea} />
        </Field>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("closeWarning")}</p>
    </ActionForm>
  );
}
