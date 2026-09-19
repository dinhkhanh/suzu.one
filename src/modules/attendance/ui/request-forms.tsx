"use client";
// Forms of week 5: attendance requests, hour confirmations, the monthly timesheet's buttons, the
// lock, adjustments and the anomaly console's nudge.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { approveMonthsAction, beginEvidenceAction, cancelAttendanceRequestAction, completeEvidenceAction, confirmMonthAction, confirmWorkedMinutesAction, createAdjustmentAction, evidenceLinkAction, lockPeriodAction, nudgeAction, remindToConfirmAction, reopenMonthAction, resubmitAttendanceRequestAction, submitAttendanceRequestAction, voidAdjustmentAction } from "../request-actions";

const ERRORS = "attendance.requests.errors";
const SELECT = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";
type RequestType = "attendance_correction" | "remote_work" | "overtime" | "holiday_work";
export type RequestDefaults = Partial<Record<"startDate" | "endDate" | "reason" | "cause" | "inTime" | "outTime" | "kind" | "portion" | "locationName" | "latitude" | "longitude" | "radiusM" | "from" | "to" | "compensation", string>> & { outNextDay?: boolean };

/** One form, four request types: the page chose `type`; the fields follow it. With `resubmit`, a returned request goes round again. */
export function AttendanceRequestForm({ type, personId, defaults, resubmit }: { type: RequestType; personId: string | null; defaults: RequestDefaults; resubmit: string | null }) {
  const t = useTranslations("attendance.requests");
  const router = useRouter();
  const [evidence, setEvidence] = useState<{ fileId: string; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [kind, setKind] = useState(defaults.kind ?? "wfh");
  const action = (resubmit ? resubmitAttendanceRequestAction : submitAttendanceRequestAction) as (input: unknown) => Promise<ActionResult<{ approvalRequestId: string }>>;
  const { onSubmit, pending, errorKey, fieldErrors, details } = useActionForm(action, {
    extra: { type, ...(personId ? { personId } : {}), ...(resubmit ? { requestId: resubmit } : {}), evidenceFileId: evidence?.fileId ?? null },
    onSuccess: (data) => router.push(`/approvals/attendance/${data.approvalRequestId}`),
  });
  const cap = errorKey === "correction_cap_reached" ? (details as { cap?: number } | null)?.cap : null;

  function upload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    startUpload(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginEvidenceAction({ ...meta, personId }),
        (fileId) => completeEvidenceAction({ fileId }) as Promise<ActionResult<{ fileId: string; fileName: string }>>,
      );
      if (result.ok) setEvidence(result.data);
      else setUploadError(result.errorKey);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="startDate" label={type === "remote_work" ? t("fields.from") : t("fields.date")}>
            <Input id="startDate" name="startDate" type="date" required defaultValue={defaults.startDate} />
          </Field>
          {type === "remote_work" ? (
            <Field name="endDate" label={t("fields.to")}>
              <Input id="endDate" name="endDate" type="date" defaultValue={defaults.endDate ?? defaults.startDate} />
            </Field>
          ) : null}
        </div>

        {type === "attendance_correction" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="inTime" label={t("fields.inTime")}>
                <Input id="inTime" name="inTime" type="time" defaultValue={defaults.inTime} />
              </Field>
              <Field name="outTime" label={t("fields.outTime")}>
                <Input id="outTime" name="outTime" type="time" defaultValue={defaults.outTime} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="outNextDay" defaultChecked={defaults.outNextDay} /> {t("fields.outNextDay")}
            </label>
            <Field name="cause" label={t("fields.cause")}>
              <select id="cause" name="cause" className={SELECT} defaultValue={defaults.cause ?? "forgot"}>
                {(["forgot", "device_error", "other"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`causes.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="evidence" label={t("fields.evidence")}>
              {evidence ? <p className="text-sm">{evidence.fileName}</p> : <Input id="evidence" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} onChange={(event) => upload(event.target.files?.[0])} />}
            </Field>
          </>
        ) : null}

        {type === "remote_work" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="kind" label={t("fields.kind")}>
                <select id="kind" name="kind" className={SELECT} value={kind} onChange={(event) => setKind(event.target.value)}>
                  {(["wfh", "off_site", "business_trip"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`kinds.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field name="portion" label={t("fields.portion")}>
                <select id="portion" name="portion" className={SELECT} defaultValue={defaults.portion ?? "full"}>
                  {(["full", "am", "pm"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`portions.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {kind === "wfh" ? null : (
              <>
                <Field name="locationName" label={t("fields.locationName")}>
                  <Input id="locationName" name="locationName" maxLength={200} defaultValue={defaults.locationName} />
                </Field>
                <p className="text-xs text-muted-foreground">{t("fields.positionHint")}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field name="latitude" label={t("fields.latitude")}>
                    <Input id="latitude" name="latitude" inputMode="decimal" defaultValue={defaults.latitude} />
                  </Field>
                  <Field name="longitude" label={t("fields.longitude")}>
                    <Input id="longitude" name="longitude" inputMode="decimal" defaultValue={defaults.longitude} />
                  </Field>
                  <Field name="radiusM" label={t("fields.radius")}>
                    <Input id="radiusM" name="radiusM" inputMode="numeric" placeholder="300" defaultValue={defaults.radiusM} />
                  </Field>
                </div>
              </>
            )}
          </>
        ) : null}

        {type === "overtime" || type === "holiday_work" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="from" label={t("fields.otFrom")}>
                <Input id="from" name="from" type="time" required={type === "overtime"} defaultValue={defaults.from} />
              </Field>
              <Field name="to" label={t("fields.otTo")}>
                <Input id="to" name="to" type="time" required={type === "overtime"} defaultValue={defaults.to} />
              </Field>
            </div>
            <Field name="compensation" label={t("fields.compensation")}>
              <select id="compensation" name="compensation" className={SELECT} defaultValue={defaults.compensation ?? "pay"}>
                <option value="pay">{t("compensation.pay")}</option>
                <option value="time_off">{t("compensation.time_off")}</option>
              </select>
            </Field>
          </>
        ) : null}

        <Field name="reason" label={t("fields.reason")}>
          <Input id="reason" name="reason" required minLength={3} maxLength={1000} defaultValue={defaults.reason} />
        </Field>
      </FieldErrors>
      <FormError namespace="records.errors" errorKey={uploadError} />
      <FormError namespace={ERRORS} errorKey={errorKey} />
      {cap ? <p className="text-xs text-muted-foreground">{t("capHint", { cap })}</p> : null}
      <div>
        <Button type="submit" disabled={pending || uploading}>
          {resubmit ? t("resubmit") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

function ConfirmingForm({ action, extra, label, confirm, askReason, reasonName = "reason", variant = "outline" }: { action: (input: unknown) => Promise<ActionResult<unknown>>; extra: Record<string, unknown>; label: string; confirm?: string; askReason?: string; reasonName?: string; variant?: "outline" | "default" | "destructive" }) {
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(action, { extra, onSuccess: () => router.refresh() });
  return (
    <form
      onSubmit={(event) => {
        if (!confirm || window.confirm(confirm)) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {askReason ? <Input name={reasonName} required minLength={5} maxLength={500} placeholder={askReason} className="h-8 w-64" /> : null}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export function CancelRequestButton({ attendanceRequestId, label, confirm }: { attendanceRequestId: string; label: string; confirm: string }) {
  return <ConfirmingForm action={cancelAttendanceRequestAction} extra={{ attendanceRequestId }} label={label} confirm={confirm} />;
}

/** The line manager writes down the hours punches cannot show. */
export function ConfirmHoursForm({ attendanceRequestId, defaultMinutes }: { attendanceRequestId: string; defaultMinutes: number | null }) {
  const t = useTranslations("attendance.requests");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved } = useActionForm(confirmWorkedMinutesAction, { extra: { attendanceRequestId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("confirmHours.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("confirmHours.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="minutes" inputMode="numeric" required defaultValue={defaultMinutes ?? ""} className="h-9 w-28" aria-label={t("confirmHours.minutes")} />
        <span className="text-sm text-muted-foreground">{t("confirmHours.minutes")}</span>
        <Button type="submit" size="sm" disabled={pending}>
          {t("confirmHours.save")}
        </Button>
        {saved ? <span className="text-xs text-muted-foreground">{t("confirmHours.saved")}</span> : null}
      </div>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export function EvidenceButton({ requestId, label }: { requestId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await evidenceLinkAction({ requestId });
          if (result.ok) window.open(result.data.url, "_blank", "noopener");
        })
      }
    >
      {label}
    </Button>
  );
}

// ── The monthly timesheet ───────────────────────────────────────────────────────────────────

export function ConfirmMonthButton({ month, label, confirm }: { month: string; label: string; confirm: string }) {
  return <ConfirmingForm action={confirmMonthAction} extra={{ month }} label={label} confirm={confirm} variant="default" />;
}

export function ReopenMonthForm({ month, personId, label, placeholder }: { month: string; personId: string; label: string; placeholder: string }) {
  return <ConfirmingForm action={reopenMonthAction} extra={{ month, personId }} label={label} askReason={placeholder} reasonName="comment" />;
}

/** Tick the confirmed months, approve them in one go; each month is its own transaction and reports back. */
export function ApproveMonthsForm({ month, rows }: { month: string; rows: { personId: string; fullName: string; status: string; line: string; canApprove: boolean; href: string }[] }) {
  const t = useTranslations("attendance.months");
  const router = useRouter();
  const [result, setResult] = useState<{ approved: number; results: { personId: string; ok: boolean; message?: string }[] } | null>(null);
  const { onSubmit, pending, errorKey } = useActionForm(approveMonthsAction as (input: unknown) => Promise<ActionResult<{ approved: number; results: { personId: string; ok: boolean; message?: string }[] }>>, {
    extra: { month },
    onSuccess: (data) => {
      setResult(data);
      router.refresh();
    },
  });
  const errors = useTranslations(ERRORS);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-xl border">
        {rows.map((row) => {
          const failed = result?.results.find((item) => item.personId === row.personId && !item.ok);
          return (
            <li key={row.personId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <input type="checkbox" name="personIds[]" value={row.personId} disabled={!row.canApprove || row.status === "approved" || row.status === "locked"} defaultChecked={row.canApprove && row.status === "confirmed"} aria-label={row.fullName} />
              <a href={row.href} className="min-w-40 font-medium underline-offset-4 hover:underline">
                {row.fullName}
              </a>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{t(`status.${row.status}`)}</span>
              <span className="text-muted-foreground">{row.line}</span>
              {failed?.message ? <span className="text-xs text-destructive">{errors.has(failed.message) ? errors(failed.message) : errors("generic")}</span> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("approveSelected")}
        </Button>
        {result ? <span className="text-xs text-muted-foreground">{t("approvedCount", { approved: result.approved, total: result.results.length })}</span> : null}
        <FormError namespace={ERRORS} errorKey={errorKey} />
      </div>
    </form>
  );
}

export function LockPeriodForm({ entityId, month, blocked }: { entityId: string; month: string; blocked: boolean }) {
  const t = useTranslations("attendance.months");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(lockPeriodAction, { extra: { entityId, month }, onSuccess: () => router.refresh() });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(t("lock.confirm"))) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex flex-col gap-2 rounded-xl border p-4"
    >
      <h2 className="text-sm font-medium">{t("lock.title")}</h2>
      <p className="text-xs text-muted-foreground">{blocked ? t("lock.blockedHint") : t("lock.readyHint")}</p>
      {blocked ? <Input name="overrideReason" required minLength={10} maxLength={500} placeholder={t("lock.overrideReason")} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant={blocked ? "destructive" : "default"} disabled={pending}>
          {blocked ? t("lock.override") : t("lock.button")}
        </Button>
        <FormError namespace={ERRORS} errorKey={errorKey} />
      </div>
    </form>
  );
}

export function RemindButton({ entityId, month, label }: { entityId: string; month: string; label: string }) {
  return <ConfirmingForm action={remindToConfirmAction} extra={{ entityId, month }} label={label} />;
}

const DELTA_FIELDS = ["workedMinutes", "paidDaysCenti", "leavePaidMinutes", "leaveUnpaidMinutes", "absenceMinutes", "lateMinutes", "earlyMinutes", "nightMinutes", "otWeekdayMinutes", "otWeekdayNightMinutes", "otRestDayMinutes", "otRestDayNightMinutes", "otHolidayMinutes", "otHolidayNightMinutes"] as const;

export function AdjustmentForm({ month, people }: { month: string; people: { id: string; fullName: string }[] }) {
  const t = useTranslations("attendance.months");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(createAdjustmentAction, { extra: { month }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("adjust.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("adjust.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="personId" label={t("adjust.person")}>
            <select id="personId" name="personId" className={SELECT} required>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field name="date" label={t("adjust.date")}>
            <Input id="date" name="date" type="date" min={`${month}-01`} max={`${month}-31`} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {DELTA_FIELDS.map((field) => (
            <Field key={field} name={field} label={t(`adjust.fields.${field}`)}>
              <Input id={field} name={field} inputMode="numeric" placeholder="0" />
            </Field>
          ))}
        </div>
        <Field name="reason" label={t("adjust.reason")}>
          <Input id="reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("adjust.save")}
        </Button>
        {saved ? <span className="text-xs text-muted-foreground">{t("adjust.saved")}</span> : null}
        <FormError namespace={ERRORS} errorKey={errorKey} />
      </div>
    </form>
  );
}

export function VoidAdjustmentButton({ adjustmentId, label, placeholder }: { adjustmentId: string; label: string; placeholder: string }) {
  return <ConfirmingForm action={voidAdjustmentAction} extra={{ adjustmentId }} label={label} askReason={placeholder} />;
}

export function NudgeButton({ personId, month, label }: { personId: string; month: string; label: string }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending || sent}
      onClick={() =>
        start(async () => {
          const result = await nudgeAction({ personId, month });
          if (result.ok) setSent(true);
        })
      }
    >
      {sent ? "✓" : label}
    </Button>
  );
}
