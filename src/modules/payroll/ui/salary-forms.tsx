"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { INSURANCE_EXEMPTIONS, PAY_PROFILES, PIT_METHODS, SALARY_CHANGE_REASONS, type SalaryTerms, SIMPLE_BASES, TAX_RESIDENCIES } from "../enums";
import { submitProfileAction } from "../rule-actions";
import { decideSalaryChangeAction, resubmitSalaryChangeAction, submitSalaryChangeAction, withdrawSalaryChangeAction } from "../salary-actions";

type AllowanceOption = { code: string; name: string };

/** C&B proposes someone's pay terms. With `requestId` it is the corrected version of a returned request. */
export function SalaryChangeForm({ personId, allowances, current, initial, requestId, defaults }: { personId: string; allowances: AllowanceOption[]; current: SalaryTerms | null; initial: boolean; requestId?: string; defaults?: { validFrom: string; reason: string; note: string | null } }) {
  const t = useTranslations("payroll.salaries");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors, details } = useActionForm(requestId ? resubmitSalaryChangeAction : submitSalaryChangeAction, {
    extra: { personId, ...(requestId ? { requestId } : {}) },
    onSuccess: (data) => router.push(`/payroll/salaries/changes/${data.id}`),
  });
  const unknown = (details as { codes?: string[] } | null)?.codes;
  const amount = (code: string) => current?.allowances.find((line) => line.code === code)?.amount ?? "";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{initial ? t("form.titleInitial") : t("form.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("form.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="validFrom" label={t("validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={defaults?.validFrom} />
          </Field>
          <Field name="reason" label={t("reason")}>
            <Select id="reason" name="reason" defaultValue={defaults?.reason ?? (initial ? "initial" : "raise")}>
              {SALARY_CHANGE_REASONS.filter((reason) => (reason === "initial") === initial).map((reason) => (
                <option key={reason} value={reason}>
                  {t(`reasons.${reason}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="terms.baseSalary" label={t("baseSalary")}>
            <Input id="terms.baseSalary" name="terms.baseSalary" inputMode="numeric" required defaultValue={current?.baseSalary ?? ""} autoComplete="off" />
          </Field>
          <Field name="terms.insuranceSalary" label={t("insuranceSalary")}>
            <Input id="terms.insuranceSalary" name="terms.insuranceSalary" inputMode="numeric" required defaultValue={current?.insuranceSalary ?? ""} autoComplete="off" />
          </Field>
          {allowances.map((allowance) => (
            <Field key={allowance.code} name={`terms.allowances.${allowance.code}`} label={allowance.name}>
              <Input id={`terms.allowances.${allowance.code}`} name={`terms.allowances.${allowance.code}`} inputMode="numeric" defaultValue={amount(allowance.code)} autoComplete="off" />
            </Field>
          ))}
        </div>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={1000} defaultValue={defaults?.note ?? ""} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      {unknown ? <p className="text-xs text-destructive">{unknown.join(", ")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {requestId ? t("form.resubmit") : t("form.submit")}
        </Button>
      </div>
    </form>
  );
}

export function DecideSalaryChangeForm({ requestId }: { requestId: string }) {
  const t = useTranslations("payroll.salaries");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(decideSalaryChangeAction, { extra: { requestId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("decide.title")}</h2>
      <Field name="comment" label={t("decide.comment")}>
        <Input id="comment" name="comment" maxLength={1000} />
      </Field>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" disabled={pending}>
          {t("decide.approve")}
        </Button>
        <Button type="submit" name="decision" value="return" variant="outline" disabled={pending}>
          {t("decide.return")}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="outline" disabled={pending}>
          {t("decide.reject")}
        </Button>
      </div>
    </form>
  );
}

export function WithdrawSalaryChangeButton({ requestId }: { requestId: string }) {
  const t = useTranslations("payroll.salaries");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(withdrawSalaryChangeAction, { extra: { requestId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("withdraw")}
      </Button>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
    </form>
  );
}

export function ProfileForm({ personId, hasProfile }: { personId: string; hasProfile: boolean }) {
  const t = useTranslations("payroll.profiles");
  const router = useRouter();
  const [profile, setProfile] = useState<(typeof PAY_PROFILES)[number]>("statutory");
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(submitProfileAction, { extra: { personId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{hasProfile ? t("form.titleChange") : t("form.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("form.hint")}</p>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="profile" label={t("profile")}>
            <Select id="profile" name="profile" value={profile} onChange={(event) => setProfile(event.target.value as typeof profile)}>
              {PAY_PROFILES.map((option) => (
                <option key={option} value={option}>
                  {t(`kinds.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required />
          </Field>
          {profile === "simple" ? (
            <>
              <Field name="simpleBasis" label={t("basis")}>
                <Select id="simpleBasis" name="simpleBasis" defaultValue="probation">
                  {SIMPLE_BASES.map((option) => (
                    <option key={option} value={option}>
                      {t(`bases.${option}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="reviewDate" label={t("reviewDate")}>
                <Input id="reviewDate" name="reviewDate" type="date" />
              </Field>
            </>
          ) : null}
          <Field name="taxResidency" label={t("taxResidency")}>
            <Select id="taxResidency" name="taxResidency" defaultValue="resident">
              {TAX_RESIDENCIES.map((option) => (
                <option key={option} value={option}>
                  {t(`residencies.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="pitMethod" label={t("pitMethod")}>
            <Select id="pitMethod" name="pitMethod" defaultValue="progressive">
              {PIT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {t(`pitMethods.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="insuranceExemption" label={t("insuranceExemption")}>
            <Select id="insuranceExemption" name="insuranceExemption" defaultValue="">
              <option value="">{t("insuranceFull")}</option>
              {INSURANCE_EXEMPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`exemptions.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pitCommitment" /> {t("pitCommitment")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="unionMember" /> {t("unionMember")}
          </label>
        </div>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={500} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
