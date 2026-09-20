"use client";
import { useTranslations } from "next-intl";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adjustLeaveBalanceAction, deleteStaffingRuleAction, runLeaveAccrualsAction, saveLeavePolicyAction, saveLeaveTypeAction, saveStaffingRuleAction } from "../actions";
import { ACCRUAL_METHODS, BASE_SOURCES, LEAVE_CATEGORIES, PAYROLL_TREATMENTS, PROBATION_RULES, ROUNDINGS, WORKFORCE_TYPES } from "../enums";

type Option = { id: string; name: string };
const ERRORS = "leave.errors";
const daysText = (centi: number | null | undefined) => (centi === null || centi === undefined ? "" : String(centi / 100));

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

function EntitySelect({ entities, canGroup, label, groupLabel, defaultValue, disabled }: { entities: Option[]; canGroup: boolean; label: string; groupLabel: string; defaultValue?: string | null; disabled?: boolean }) {
  return (
    <Field name="entityId" label={label}>
      <Select id="entityId" name="entityId" defaultValue={defaultValue ?? (canGroup ? "" : entities[0]?.id)} disabled={disabled}>
        {canGroup || defaultValue === null ? <option value="">{groupLabel}</option> : null}
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export type LeaveTypeValues = {
  id: string;
  entityId: string | null;
  code: string;
  name: string;
  nameEn: string | null;
  category: string;
  payrollTreatment: string;
  tracksBalance: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
  requiresAttachment: boolean;
  allowBackdated: boolean;
  noticeDays: number;
  maxDaysPerRequestCenti: number | null;
  eligibleWorkforceTypes: string[] | null;
  gender: string | null;
  minSeniorityMonths: number | null;
  isLongTerm: boolean;
  countsUntrackedDays: boolean;
  isActive: boolean;
  sortOrder: number;
};

export function LeaveTypeForm({ type, entities, canGroup }: { type: LeaveTypeValues | null; entities: Option[]; canGroup: boolean }) {
  const t = useTranslations("leave.admin");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveLeaveTypeAction, { extra: type ? { id: type.id, code: type.code } : {} });
  return (
    <form onSubmit={onSubmit} key={!type && saved ? "saved" : "open"} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          {type ? null : (
            <Field name="code" label={t("types.code")}>
              <Input id="code" name="code" required maxLength={24} pattern="[A-Za-z0-9_\-]{2,24}" />
            </Field>
          )}
          <Field name="name" label={t("types.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={type?.name} />
          </Field>
          <Field name="nameEn" label={t("types.nameEn")}>
            <Input id="nameEn" name="nameEn" maxLength={120} defaultValue={type?.nameEn ?? ""} />
          </Field>
          <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} defaultValue={type ? type.entityId : undefined} disabled={!!type} />
          <Field name="category" label={t("types.category")}>
            <Select id="category" name="category" defaultValue={type?.category ?? "company"}>
              {LEAVE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`categories.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="payrollTreatment" label={t("types.payrollTreatment")}>
            <Select id="payrollTreatment" name="payrollTreatment" defaultValue={type?.payrollTreatment ?? "paid_company"}>
              {PAYROLL_TREATMENTS.map((value) => (
                <option key={value} value={value}>
                  {t(`treatments.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="noticeDays" label={t("types.noticeDays")}>
            <Input id="noticeDays" name="noticeDays" type="number" min={0} max={365} defaultValue={type?.noticeDays ?? 0} />
          </Field>
          <Field name="maxDays" label={t("types.maxDays")}>
            <Input id="maxDays" name="maxDays" inputMode="decimal" defaultValue={daysText(type?.maxDaysPerRequestCenti)} />
          </Field>
          <Field name="minSeniorityMonths" label={t("types.minSeniorityMonths")}>
            <Input id="minSeniorityMonths" name="minSeniorityMonths" type="number" min={1} max={600} defaultValue={type?.minSeniorityMonths ?? ""} />
          </Field>
          <Field name="gender" label={t("types.gender")}>
            <Select id="gender" name="gender" defaultValue={type?.gender ?? ""}>
              <option value="">{t("types.anyGender")}</option>
              <option value="female">{t("types.female")}</option>
              <option value="male">{t("types.male")}</option>
            </Select>
          </Field>
          <Field name="sortOrder" label={t("types.sortOrder")}>
            <Input id="sortOrder" name="sortOrder" type="number" min={0} max={999} defaultValue={type?.sortOrder ?? 100} />
          </Field>
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-1 text-xs text-muted-foreground">{t("types.workforce")}</legend>
          {WORKFORCE_TYPES.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="eligibleWorkforceTypes[]" value={value} defaultChecked={type?.eligibleWorkforceTypes?.includes(value) ?? false} className="size-4" />
              {t(`workforce.${value}`)}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Check name="tracksBalance" label={t("types.tracksBalance")} defaultChecked={type?.tracksBalance ?? false} />
          <Check name="allowHalfDay" label={t("types.allowHalfDay")} defaultChecked={type?.allowHalfDay ?? true} />
          <Check name="allowHourly" label={t("types.allowHourly")} defaultChecked={type?.allowHourly ?? false} />
          <Check name="requiresAttachment" label={t("types.requiresAttachment")} defaultChecked={type?.requiresAttachment ?? false} />
          <Check name="allowBackdated" label={t("types.allowBackdated")} defaultChecked={type?.allowBackdated ?? false} />
          <Check name="isLongTerm" label={t("types.isLongTerm")} defaultChecked={type?.isLongTerm ?? false} />
          <Check name="countsUntrackedDays" label={t("types.countsUntrackedDays")} defaultChecked={type?.countsUntrackedDays ?? false} />
          <Check name="isActive" label={t("types.isActive")} defaultChecked={type?.isActive ?? true} />
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export type LeavePolicyValues = {
  entityId: string | null;
  validFrom: string;
  accrualMethod: string;
  baseSource: string;
  fixedDaysCenti: number;
  extraDaysCenti: number;
  seniorityBonus: boolean;
  prorate: boolean;
  rounding: string;
  probationRule: string;
  carryOverCapCenti: number | null;
  carryOverExpiry: string | null;
  payoutOnTermination: boolean;
  allowNegativeCenti: number;
};

/** A new version from a date on; the one in force until then ends the day before. */
export function LeavePolicyForm({ leaveTypeId, current, entities, canGroup, today }: { leaveTypeId: string; current: LeavePolicyValues | null; entities: Option[]; canGroup: boolean; today: string }) {
  const t = useTranslations("leave.admin");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveLeavePolicyAction, { extra: { leaveTypeId } });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} defaultValue={current ? current.entityId : undefined} />
          <Field name="validFrom" label={t("policy.validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={today} />
          </Field>
          <Field name="accrualMethod" label={t("policy.accrualMethod")}>
            <Select id="accrualMethod" name="accrualMethod" defaultValue={current?.accrualMethod ?? "monthly_accrual"}>
              {ACCRUAL_METHODS.map((value) => (
                <option key={value} value={value}>
                  {t(`accrual.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="baseSource" label={t("policy.baseSource")}>
            <Select id="baseSource" name="baseSource" defaultValue={current?.baseSource ?? "fixed"}>
              {BASE_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {t(`base.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="fixedDays" label={t("policy.fixedDays")}>
            <Input id="fixedDays" name="fixedDays" inputMode="decimal" defaultValue={daysText(current?.fixedDaysCenti ?? 0)} />
          </Field>
          <Field name="extraDays" label={t("policy.extraDays")}>
            <Input id="extraDays" name="extraDays" inputMode="decimal" defaultValue={daysText(current?.extraDaysCenti ?? 0)} />
          </Field>
          <Field name="rounding" label={t("policy.rounding")}>
            <Select id="rounding" name="rounding" defaultValue={current?.rounding ?? "half_day"}>
              {ROUNDINGS.map((value) => (
                <option key={value} value={value}>
                  {t(`rounding.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="probationRule" label={t("policy.probationRule")}>
            <Select id="probationRule" name="probationRule" defaultValue={current?.probationRule ?? "accrue_no_use"}>
              {PROBATION_RULES.map((value) => (
                <option key={value} value={value}>
                  {t(`probation.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="carryOverCap" label={t("policy.carryOverCap")}>
            <Input id="carryOverCap" name="carryOverCap" inputMode="decimal" defaultValue={daysText(current?.carryOverCapCenti)} placeholder={t("policy.noLimit")} />
          </Field>
          <Field name="carryOverExpiry" label={t("policy.carryOverExpiry")}>
            <Input id="carryOverExpiry" name="carryOverExpiry" pattern="\d{2}-\d{2}" placeholder="03-31" defaultValue={current?.carryOverExpiry ?? ""} />
          </Field>
          <Field name="allowNegative" label={t("policy.allowNegative")}>
            <Input id="allowNegative" name="allowNegative" inputMode="decimal" defaultValue={daysText(current?.allowNegativeCenti ?? 0)} />
          </Field>
          <Field name="note" label={t("policy.note")}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Check name="seniorityBonus" label={t("policy.seniorityBonus")} defaultChecked={current?.seniorityBonus ?? false} />
          <Check name="prorate" label={t("policy.prorate")} defaultChecked={current?.prorate ?? true} />
          <Check name="payoutOnTermination" label={t("policy.payoutOnTermination")} defaultChecked={current?.payoutOnTermination ?? false} />
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("policy.save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export function AdjustBalanceForm({ personId, year, types }: { personId: string; year: number; types: Option[] }) {
  const t = useTranslations("leave.admin");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(adjustLeaveBalanceAction, { extra: { personId, year } });
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("balances.adjust")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="leaveTypeId" label={t("balances.type")}>
            <Select id="leaveTypeId" name="leaveTypeId">
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="days" label={t("balances.days")}>
            <Input id="days" name="days" required inputMode="decimal" placeholder="1,5 / -2" />
          </Field>
          <Field name="reason" label={t("balances.reason")}>
            <Input id="reason" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("balances.post")}
        </Button>
      </div>
    </form>
  );
}

export function RunAccrualsButton() {
  const t = useTranslations("leave.admin");
  const { onSubmit, pending, errorKey, saved } = useActionForm(runLeaveAccrualsAction);
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("balances.runAccruals")}
      </Button>
      {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export function StaffingRuleForm({ entities, canGroup, departments, teams }: { entities: Option[]; canGroup: boolean; departments: Option[]; teams: Option[] }) {
  const t = useTranslations("leave.admin");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveStaffingRuleAction);
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("staffing.add")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} />
          <Field name="departmentId" label={t("staffing.department")}>
            <Select id="departmentId" name="departmentId" defaultValue="">
              <option value="">—</option>
              {departments.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="teamId" label={t("staffing.team")}>
            <Select id="teamId" name="teamId" defaultValue="">
              <option value="">—</option>
              {teams.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="minPresent" label={t("staffing.minPresent")}>
            <Input id="minPresent" name="minPresent" type="number" min={1} max={500} required />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

export function DeleteStaffingRuleButton({ id, label, confirm }: { id: string; label: string; confirm: string }) {
  const { onSubmit, pending, errorKey } = useActionForm(deleteStaffingRuleAction, { extra: { id } });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(confirm)) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}
