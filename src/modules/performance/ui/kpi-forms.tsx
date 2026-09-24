"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { KPI_DIRECTIONS, KPI_FREQUENCIES, KPI_UNITS, type KpiDirection, type KpiFrequency, type KpiUnit, metricValueText, WORK_METRIC_UNITS, WORK_METRICS, type WorkMetric } from "../enums";
import { applyTemplatesAction, closeKpiMonthAction, endAssignmentAction, removePositionKpiAction, reopenKpiMonthAction, saveActualsAction, saveAssignmentAction, saveKpiAction, savePositionKpiAction } from "../kpi-actions";

type Option = { id: string; name: string };
const ERRORS = "performance.errors";

// ── Actuals grid ────────────────────────────────────────────────────────────────────────────

export type GridLine = { assignmentId: string; periodKey: string; kpiCode: string; kpiName: string; unit: KpiUnit; direction: KpiDirection; targetText: string; actualValue: number | null; notApplicable: boolean; note: string | null };
/** `proposals`: assignment → the figure the work job proposed, as text in the KPI's unit (FR-PJM-62). */
export type GridPerson = { personId: string; fullName: string; closed: boolean; lines: GridLine[]; proposals?: Record<string, string> };

/** One form for everyone the viewer enters for: the whole grid is saved through one action, all or nothing. */
export function ActualsGrid({ people }: { people: GridPerson[] }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(saveActualsAction, { onSuccess: () => router.refresh() });
  const open = people.filter((person) => !person.closed);
  // Row numbers of the posted entries: open lines only, counted across people.
  const rowOf = new Map(open.flatMap((person) => person.lines).map((line, row) => [line.assignmentId, row]));
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
      {people.map((person) => (
        <section key={person.personId} className="rounded-xl border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-medium">{person.fullName}</h2>
            {person.closed ? <span className="text-xs text-muted-foreground">{t("entry.closed")}</span> : null}
          </header>
          <ul className="flex flex-col divide-y">
            {person.lines.map((line) => {
              const name = `entries.${rowOf.get(line.assignmentId) ?? 0}`;
              return (
                <li key={line.assignmentId} className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <div className="truncate">{line.kpiName}</div>
                    <div className="text-xs text-muted-foreground">{[line.kpiCode, t(`kpi.direction.${line.direction}`), line.periodKey].join(" · ")}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">{t("entry.target", { value: line.targetText })}</div>
                  {person.closed ? (
                    <div className="tabular-nums">{line.notApplicable ? t("kpi.notApplicableShort") : line.actualValue === null ? "—" : metricValueText(line.unit, line.actualValue)}</div>
                  ) : (
                    <>
                      <input type="hidden" name={`${name}.assignmentId`} value={line.assignmentId} />
                      <input type="hidden" name={`${name}.periodKey`} value={line.periodKey} />
                      <div className="flex flex-col gap-1">
                        <Input id={`actual-${line.assignmentId}`} name={`${name}.actual`} defaultValue={line.actualValue === null ? "" : metricValueText(line.unit, line.actualValue)} inputMode="decimal" maxLength={30} aria-label={`${person.fullName} — ${line.kpiName}: ${t("entry.actual")}`} placeholder={t("entry.actual")} />
                        {person.proposals?.[line.assignmentId] !== undefined ? <ProposalHint inputId={`actual-${line.assignmentId}`} value={person.proposals[line.assignmentId]} /> : null}
                      </div>
                    </>
                  )}
                  {person.closed ? (
                    <span />
                  ) : (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input type="checkbox" name={`${name}.notApplicable`} defaultChecked={line.notApplicable} />
                      {t("entry.notApplicable")}
                    </label>
                  )}
                  {person.closed ? <div className="text-xs text-muted-foreground">{line.note ?? ""}</div> : <Input name={`${name}.note`} defaultValue={line.note ?? ""} maxLength={500} aria-label={`${person.fullName} — ${line.kpiName}: ${t("entry.note")}`} placeholder={t("entry.note")} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {open.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={form.pending}>
            {t("entry.save")}
          </Button>
          {form.saved ? <span className="text-sm text-muted-foreground">{t("entry.saved")}</span> : null}
          <FormError namespace={ERRORS} errorKey={form.errorKey} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("entry.hint")}</p>
    </form>
  );
}

/**
 * A figure proposed from work data (FR-PJM-62). It is not in the box: saving the grid must never
 * confirm it by accident. The scorer takes it with one tap (then saves), or types their own.
 */
function ProposalHint({ inputId, value }: { inputId: string; value: string }) {
  const t = useTranslations("performance.workMetrics");
  const take = () => {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.value = value;
      input.focus();
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {t("proposed", { value })}
      <button type="button" onClick={take} className="underline underline-offset-2 hover:text-foreground">
        {t("use")}
      </button>
    </span>
  );
}

// ── Library ─────────────────────────────────────────────────────────────────────────────────

export type KpiFormValue = { id: string | null; code: string; name: string; description: string | null; unit: KpiUnit; direction: KpiDirection; frequency: KpiFrequency; capBp: number; floorBp: number; isActive: boolean; workMetric?: WorkMetric | null };

export function KpiForm({ value }: { value: KpiFormValue }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(saveKpiAction, { extra: { kpiId: value.id ?? "" }, onSuccess: () => router.refresh() });
  const choice = <Value extends string>(name: string, label: string, options: readonly Value[], text: (option: Value) => string, defaultValue: Value) => (
    <Field name={name} label={label}>
      <Select id={`${name}-${value.id ?? "new"}`} name={name} defaultValue={defaultValue}>
        {options.map((option) => (
          <option key={option} value={option}>
            {text(option)}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="code" label={t("library.code")}>
            <Input name="code" defaultValue={value.code} required maxLength={40} />
          </Field>
          <div className="sm:col-span-2">
            <Field name="name" label={t("library.name")}>
              <Input name="name" defaultValue={value.name} required maxLength={200} />
            </Field>
          </div>
          {choice("unit", t("library.unit"), KPI_UNITS, (option) => t(`kpi.unit.${option}`), value.unit)}
          {choice("direction", t("library.direction"), KPI_DIRECTIONS, (option) => t(`kpi.direction.${option}`), value.direction)}
          {choice("frequency", t("library.frequency"), KPI_FREQUENCIES, (option) => t(`kpi.frequency.${option}`), value.frequency)}
          <Field name="capPercent" label={t("library.cap")}>
            <Input name="capPercent" defaultValue={String(value.capBp / 100)} inputMode="decimal" />
          </Field>
          <Field name="floorPercent" label={t("library.floor")}>
            <Input name="floorPercent" defaultValue={String(value.floorBp / 100)} inputMode="decimal" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={value.isActive} />
            {t("library.active")}
          </label>
          <div className="sm:col-span-3">
            <Field name="workMetric" label={t("workMetrics.field")}>
              <Select id={`workMetric-${value.id ?? "new"}`} name="workMetric" defaultValue={value.workMetric ?? ""}>
                <option value="">{t("workMetrics.none")}</option>
                {WORK_METRICS.map((metric) => (
                  <option key={metric} value={metric}>
                    {t(`workMetrics.metrics.${metric}`)} ({t(`kpi.unit.${WORK_METRIC_UNITS[metric]}`)})
                  </option>
                ))}
              </Select>
            </Field>
            <p className="pt-1 text-xs text-muted-foreground">{t("workMetrics.hint")}</p>
          </div>
        </div>
        <Field name="description" label={t("library.descriptionField")}>
          <Input name="description" defaultValue={value.description ?? ""} maxLength={2000} />
        </Field>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {value.id ? t("library.save") : t("library.add")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("entry.saved")}</span> : null}
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

// ── Position templates ──────────────────────────────────────────────────────────────────────

export function PositionKpiForm({ positions, entities, kpis, defaults }: { positions: Option[]; entities: Option[]; kpis: Option[]; defaults?: { positionId: string; entityId: string | null } }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(savePositionKpiAction, { onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="positionId" label={t("positions.position")}>
            <Select id="positionId" name="positionId" defaultValue={defaults?.positionId ?? ""} required>
              <option value="">—</option>
              {positions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="entityId" label={t("positions.entity")}>
            <Select id="entityId" name="entityId" defaultValue={defaults?.entityId ?? ""}>
              <option value="">{t("positions.everyEntity")}</option>
              {entities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="kpiId" label={t("positions.kpi")}>
            <Select id="kpiId" name="kpiId" required>
              <option value="">—</option>
              {kpis.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="weight" label={t("positions.weight")}>
            <Input name="weight" type="number" min={1} max={1000} defaultValue={10} required />
          </Field>
          <Field name="target" label={t("positions.target")}>
            <Input name="target" inputMode="decimal" required maxLength={30} />
          </Field>
          <Field name="sortOrder" label={t("positions.order")}>
            <Input name="sortOrder" type="number" min={0} max={999} defaultValue={0} />
          </Field>
        </div>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("positions.saveHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("positions.save")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("entry.saved")}</span> : null}
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(null);
  const run = <T,>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string; message?: string; details?: unknown }>, onDone?: (data: T) => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setDetails(result.ok ? null : (result.details ?? null));
      if (result.ok) {
        onDone?.(result.data);
        router.refresh();
      }
    });
  return { run, pending, errorKey, details };
}

export function RemovePositionKpiButton({ id }: { id: string }) {
  const t = useTranslations("performance");
  const { run, pending, errorKey } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t("positions.removeConfirm")) && run(() => removePositionKpiAction({ id }))}>
        {t("positions.remove")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </span>
  );
}

export function ApplyTemplatesForm({ positionId, personId, defaultFrom, label }: { positionId?: string; personId?: string; defaultFrom: string; label: string }) {
  const t = useTranslations("performance");
  const { run, pending, errorKey } = useRun();
  const [fromPeriod, setFromPeriod] = useState(defaultFrom);
  const [done, setDone] = useState<{ holders: number; created: number; skipped: number; withoutTemplate: number } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" value={fromPeriod} onChange={(event) => setFromPeriod(event.target.value)} className="w-40" aria-label={t("positions.from")} />
        <Button type="button" size="sm" variant="outline" disabled={pending || !fromPeriod} onClick={() => run(() => applyTemplatesAction({ fromPeriod, positionId: positionId ?? "", personId: personId ?? "" }), setDone)}>
          {label}
        </Button>
      </div>
      {done ? <p className="text-xs text-muted-foreground">{t("positions.applied", done)}</p> : null}
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </div>
  );
}

// ── Assignments ─────────────────────────────────────────────────────────────────────────────

export function NewAssignmentForm({ personId, kpis, defaultFrom }: { personId: string; kpis: Option[]; defaultFrom: string }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(saveAssignmentAction, { extra: { personId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <Field name="kpiId" label={t("positions.kpi")}>
              <Select id="kpiId" name="kpiId" required>
                <option value="">—</option>
                {kpis.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field name="weight" label={t("positions.weight")}>
            <Input name="weight" type="number" min={1} max={1000} defaultValue={10} required />
          </Field>
          <Field name="target" label={t("positions.target")}>
            <Input name="target" inputMode="decimal" required maxLength={30} />
          </Field>
          <Field name="fromPeriod" label={t("assignments.from")}>
            <Input name="fromPeriod" type="month" defaultValue={defaultFrom} required />
          </Field>
        </div>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("assignments.add")}
        </Button>
        <FormError namespace={ERRORS} errorKey={form.errorKey} />
      </div>
    </form>
  );
}

export function AssignmentRowForm({ assignment }: { assignment: { id: string; weight: number; targetText: string; toPeriod: string | null } }) {
  const t = useTranslations("performance");
  const router = useRouter();
  const form = useActionForm(saveAssignmentAction, { extra: { assignmentId: assignment.id }, onSuccess: () => router.refresh() });
  const { run, pending, errorKey } = useRun();
  const [toPeriod, setToPeriod] = useState(assignment.toPeriod ?? "");
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={form.onSubmit} className="toolbar">
        <Field name="weight" label={t("positions.weight")}>
          <Input name="weight" type="number" min={1} max={1000} defaultValue={assignment.weight} required className="w-24" />
        </Field>
        <Field name="target" label={t("positions.target")}>
          <Input name="target" inputMode="decimal" defaultValue={assignment.targetText} required maxLength={30} className="w-32" />
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={form.pending}>
          {t("library.save")}
        </Button>
        {form.saved ? <span className="pb-2 text-sm text-muted-foreground">{t("entry.saved")}</span> : null}
      </form>
      <FormError namespace={ERRORS} errorKey={form.errorKey} />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" value={toPeriod} onChange={(event) => setToPeriod(event.target.value)} className="w-40" aria-label={t("assignments.lastMonth")} />
        <Button type="button" size="sm" variant="ghost" disabled={pending || !toPeriod} onClick={() => run(() => endAssignmentAction({ assignmentId: assignment.id, toPeriod }))}>
          {t("assignments.end")}
        </Button>
        <FormError namespace={ERRORS} errorKey={errorKey} />
      </div>
    </div>
  );
}

// ── Close and reopen ────────────────────────────────────────────────────────────────────────

type Blocker = { personId: string; personName: string; kpiCode: string; kpiName: string; periodKey: string };

export function CloseMonthForm({ entityId, month, blockers }: { entityId: string; month: string; blockers: Blocker[] }) {
  const t = useTranslations("performance");
  const { run, pending, errorKey, details } = useRun();
  const [reason, setReason] = useState("");
  // The server's list wins: it is the one the refusal was based on.
  const listed = ((details as { blockers?: Blocker[] } | null)?.blockers ?? blockers) as Blocker[];
  return (
    <div className="flex flex-col gap-2">
      {listed.length > 0 ? (
        <>
          <p className="text-sm text-warning">{t("periods.blocked", { count: listed.length })}</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {listed.slice(0, 30).map((item) => (
              <li key={`${item.personId}:${item.kpiCode}:${item.periodKey}`}>{`${item.personName} — ${item.kpiName} (${item.periodKey})`}</li>
            ))}
          </ul>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("periods.overrideReason")} maxLength={1000} aria-label={t("periods.overrideReason")} />
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending || (listed.length > 0 && reason.trim().length < 5)} onClick={() => window.confirm(t("periods.closeConfirm")) && run(() => closeKpiMonthAction({ entityId, month, overrideReason: listed.length > 0 ? reason : "" }))}>
          {listed.length > 0 ? t("periods.closeOverride") : t("periods.close")}
        </Button>
        <FormError namespace={ERRORS} errorKey={errorKey} />
      </div>
    </div>
  );
}

export function ReopenMonthForm({ entityId, month }: { entityId: string; month: string }) {
  const t = useTranslations("performance");
  const { run, pending, errorKey } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("periods.reopenReason")} maxLength={1000} className="max-w-xs" aria-label={t("periods.reopenReason")} />
      <Button type="button" size="sm" variant="outline" disabled={pending || reason.trim().length < 5} onClick={() => window.confirm(t("periods.reopenConfirm")) && run(() => reopenKpiMonthAction({ entityId, month, reason }))}>
        {t("periods.reopen")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </div>
  );
}
