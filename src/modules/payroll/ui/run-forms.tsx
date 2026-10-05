"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import type { RunStep } from "../lifecycle";
import { calculatePayrollRunAction, cancelPayrollRunAction, createOffCycleRunAction, createPayrollRunAction, removePayrollRunInputAction, setPayrollRunInputAction, stepPayrollRunAction } from "../run-actions";

type EntityOption = { id: string; code: string; shortName: string };

/** A month whose timesheet is locked and which has no run yet (FR-PAY-10). */
export function NewRunForm({ entities, months }: { entities: EntityOption[]; months: { entityId: string; month: string; hasRun: boolean }[] }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createPayrollRunAction, { onSuccess: (data) => router.push(`/payroll/runs/${(data as { id: string }).id}`) });
  const open = months.filter((month) => month.entityId === entityId && !month.hasRun);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("new.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("new.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} — {entity.shortName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="month" label={t("month")}>
            <Select id="month" name="month" required>
              {open.map((month) => (
                <option key={month.month} value={month.month}>
                  {month.month}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>
      </FieldErrors>
      {open.length === 0 ? <p className="text-sm text-muted-foreground">{t("new.noMonths")}</p> : null}
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || open.length === 0}>
          {pending ? t("new.saving") : t("new.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Calculate (or recalculate) the run. The figures are worked out in the background (ADR-09). */
export function CalculateRunButton({ runId, label }: { runId: string; label: string }) {
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(calculatePayrollRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? `${label}…` : label}
      </Button>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
    </form>
  );
}

/**
 * One step of the lifecycle (SRS D17). A return to HR must carry a reason, so the comment box is
 * shown for it and required; the other steps take an optional note.
 */
export function RunStepForm({ runId, step, label, destructive }: { runId: string; step: RunStep; label: string; destructive?: boolean }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(stepPayrollRunAction, {
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
          <Input id="comment" name="comment" maxLength={1000} required={needsReason} placeholder={needsReason ? t("steps.reasonHint") : ""} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant={destructive ? "outline" : "default"} disabled={pending}>
          {pending ? `${label}…` : label}
        </Button>
      </div>
    </form>
  );
}

export function CancelRunButton({ runId }: { runId: string }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(cancelPayrollRunAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? `${t("cancel")}…` : t("cancel")}
      </Button>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
    </form>
  );
}

/** A figure typed into the run for one person: a bonus, a commission, an advance, a penalty. */
export function RunInputForm({ runId, people, codes }: { runId: string; people: { personId: string; fullName: string }[]; codes: { code: string; name: string }[] }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(setPayrollRunInputAction, {
    extra: { runId },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("inputs.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("inputs.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field name="personId" label={t("inputs.person")}>
            <Select id="personId" name="personId" required>
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="code" label={t("inputs.code")}>
            <Select id="code" name="code" required>
              {codes.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="amount" label={t("inputs.amount")}>
            <MoneyInput id="amount" name="amount" required className="text-right" />
          </Field>
          <Field name="note" label={t("inputs.note")}>
            <Input id="note" name="note" maxLength={300} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? `${t("inputs.save")}…` : t("inputs.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("inputs.saved")}</span> : null}
      </div>
    </form>
  );
}

type OffCyclePerson = { personId: string; fullName: string; employeeCode: string | null; entityId: string };
type OffCycleLine = { key: number; personId: string; code: string; amount: string; note: string };

/**
 * An off-cycle run (FR-PAY-19): something paid inside a month on top of the regular run — a Tết or
 * holiday bonus, a project bonus, a correction. Taxed with the month it is paid in. One line per
 * person and pay component; "everyone" fills a line for each person of the entity at one amount,
 * which is then changed person by person where it differs. Nobody is offered a line for themselves.
 */
export function OffCycleRunForm({ entities, people, codes, defaultMonth, defaultEntityId }: { entities: EntityOption[]; people: OffCyclePerson[]; /** The input components of each entity's catalogue. */ codes: Record<string, { code: string; name: string }[]>; defaultMonth: string; defaultEntityId?: string }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const [entityId, setEntityId] = useState(defaultEntityId ?? entities[0]?.id ?? "");
  const [lines, setLines] = useState<OffCycleLine[]>([]);
  const [bulk, setBulk] = useState({ code: "", amount: "" });
  const nextKey = useRef(1);
  const staff = people.filter((person) => person.entityId === entityId);
  const entityCodes = codes[entityId] ?? [];
  const firstCode = entityCodes[0]?.code ?? "";
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createOffCycleRunAction, {
    extra: { entityId, lines: lines.map(({ personId, code, amount, note }) => ({ personId, code, amount, note })) },
    onSuccess: (data) => router.push(`/payroll/runs/${(data as { id: string }).id}`),
  });

  const line = (personId: string, code: string, amount: string): OffCycleLine => ({ key: nextKey.current++, personId, code, amount, note: "" });
  const change = (key: number, patch: Partial<OffCycleLine>) => setLines((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const switchEntity = (next: string) => {
    // Lines name people and components of one entity: another entity starts again.
    setEntityId(next);
    setLines([]);
  };
  const fillEveryone = () => {
    const code = bulk.code || firstCode;
    const taken = new Set(lines.filter((row) => row.code === code).map((row) => row.personId));
    setLines((current) => [...current, ...staff.filter((person) => !taken.has(person.personId)).map((person) => line(person.personId, code, bulk.amount))]);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" value={entityId} onChange={(event) => switchEntity(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} — {entity.shortName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="month" label={t("offCycle.month")}>
            <MonthPicker id="month" name="month" required defaultValue={defaultMonth} />
          </Field>
          <Field name="name" label={t("offCycle.name")}>
            <Input id="name" name="name" required maxLength={200} placeholder={t("offCycle.namePlaceholder")} />
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>

        {/* Everyone of the entity at one amount, changed afterwards where it differs. */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("offCycle.everyone.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("offCycle.everyone.hint", { count: staff.length })}</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <Field name="bulk-code" label={t("inputs.code")}>
              <Select id="bulk-code" value={bulk.code || firstCode} onChange={(event) => setBulk((current) => ({ ...current, code: event.target.value }))}>
                {entityCodes.map((code) => (
                  <option key={code.code} value={code.code}>
                    {code.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name="bulk-amount" label={t("inputs.amount")}>
              <MoneyInput id="bulk-amount" value={bulk.amount} onChange={(event) => setBulk((current) => ({ ...current, amount: event.target.value }))} className="text-right" />
            </Field>
            <Button type="button" variant="outline" onClick={fillEveryone} disabled={staff.length === 0 || entityCodes.length === 0}>
              {t("offCycle.everyone.fill")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("offCycle.lines", { count: lines.length })}</h2>
          <List>
            {lines.length === 0 ? <ListEmpty>{t("offCycle.noLines")}</ListEmpty> : null}
            {lines.map((row, index) => (
              <ListItem key={row.key} className="flex-col items-stretch gap-3 py-3 md:flex-row md:items-end">
                <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_10rem_minmax(0,1.5fr)]">
                  <Field name={`lines.${index}.personId`} label={t("inputs.person")}>
                    <Select id={`lines.${index}.personId`} value={row.personId} onChange={(event) => change(row.key, { personId: event.target.value })} required>
                      {staff.map((person) => (
                        <option key={person.personId} value={person.personId}>
                          {person.employeeCode ? `${person.fullName} · ${person.employeeCode}` : person.fullName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field name={`lines.${index}.code`} label={t("inputs.code")}>
                    <Select id={`lines.${index}.code`} value={row.code} onChange={(event) => change(row.key, { code: event.target.value })} required>
                      {entityCodes.map((code) => (
                        <option key={code.code} value={code.code}>
                          {code.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field name={`lines.${index}.amount`} label={t("inputs.amount")}>
                    <MoneyInput id={`lines.${index}.amount`} value={row.amount} onChange={(event) => change(row.key, { amount: event.target.value })} required className="text-right" />
                  </Field>
                  <Field name={`lines.${index}.note`} label={t("inputs.note")}>
                    <Input id={`lines.${index}.note`} value={row.note} onChange={(event) => change(row.key, { note: event.target.value })} maxLength={300} />
                  </Field>
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setLines((current) => current.filter((other) => other.key !== row.key))}>
                  {t("inputs.remove")}
                </Button>
              </ListItem>
            ))}
          </List>
          <div>
            <Button type="button" variant="outline" disabled={staff.length === 0 || entityCodes.length === 0} onClick={() => setLines((current) => [...current, line(staff[0]?.personId ?? "", firstCode, "")])}>
              {t("offCycle.addLine")}
            </Button>
          </div>
        </div>
      </FieldErrors>
      {entityCodes.length === 0 ? <p className="text-sm text-muted-foreground">{t("offCycle.noCodes")}</p> : null}
      <FormError namespace="payroll.runs.errors" errorKey={errorKey} />
      <div className="flex justify-end">
        <Button type="submit" size="lg" className="w-full md:w-auto" disabled={pending}>
          {pending ? t("new.saving") : t("offCycle.submit")}
        </Button>
      </div>
    </form>
  );
}

export function RemoveRunInputButton({ runId, personId, code }: { runId: string; personId: string; code: string }) {
  const t = useTranslations("payroll.runs");
  const router = useRouter();
  const { onSubmit, pending } = useActionForm(removePayrollRunInputAction, { extra: { runId, personId, code }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit}>
      <button type="submit" disabled={pending} className="text-xs text-muted-foreground hover:text-destructive hover:underline">
        {t("inputs.remove")}
      </button>
    </form>
  );
}
