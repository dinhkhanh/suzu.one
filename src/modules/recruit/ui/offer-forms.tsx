"use client";
// Drafting an offer, moving it through its life, and turning the person who said yes into a
// colleague (FR-REC-08, FR-REC-09).
//
// The figure fields appear only when the server handed this component a `money` object. That is
// cosmetic — `getOfferView` already cut the amount out for anybody who may not see it and the
// action re-checks — but it means a recruiter's screen has no salary box to look at, which is the
// honest rendering of what they may do.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EMPLOYMENT_TYPES, OFFER_DECLINE_REASONS, OFFER_LIMITS } from "../enums";
import { convertOfferToEmployeeAction, makeOfferAction, respondToOfferAction, sendOfferAction, submitOfferAction, updateOfferAction, withdrawOfferAction } from "../offer-actions";

export type OfferFormValues = {
  positionName: string;
  jobLevel: string | null;
  employmentType: string;
  workLocation: string | null;
  managerPersonId: string | null;
  startDate: string;
  expiresOn: string | null;
  probationMonths: number;
  probationSalaryPercent: number;
  baseSalaryVnd: number | null;
  allowancesVnd: number | null;
  letterTemplateId: string | null;
  note: string | null;
};

type Option = { id: string; name: string };

/**
 * The draft form. Used both to make the first offer on an application and to correct one before it
 * goes for approval — the same fields either way, so there is one place where an offer is described.
 */
export function OfferForm({
  applicationId,
  offerId,
  values,
  managers,
  templates,
  canSetMoney,
}: {
  applicationId?: string;
  offerId?: string;
  values?: OfferFormValues;
  managers: Option[];
  templates: Option[];
  canSetMoney: boolean;
}) {
  const t = useTranslations("recruit.offer");
  const tType = useTranslations("recruit.employmentType");
  const router = useRouter();
  const form = useActionForm(offerId ? updateOfferAction : makeOfferAction, {
    extra: offerId ? { offerId } : { applicationId },
    onSuccess: (data) => router.push(`/recruit/offers/${(data as { id: string }).id}`),
  });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="positionName" label={t("positionName")}>
            <Input id="positionName" name="positionName" defaultValue={values?.positionName ?? ""} required maxLength={200} />
          </Field>
          <Field name="jobLevel" label={t("jobLevel")}>
            <Input id="jobLevel" name="jobLevel" defaultValue={values?.jobLevel ?? ""} maxLength={80} />
          </Field>
          <Field name="employmentType" label={t("employmentType")}>
            <Select id="employmentType" name="employmentType" defaultValue={values?.employmentType ?? "employee"}>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {tType(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="workLocation" label={t("workLocation")}>
            <Input id="workLocation" name="workLocation" defaultValue={values?.workLocation ?? ""} maxLength={200} />
          </Field>
          <Field name="managerPersonId" label={t("manager")}>
            <Select id="managerPersonId" name="managerPersonId" defaultValue={values?.managerPersonId ?? ""}>
              <option value="">{t("noManager")}</option>
              {managers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="startDate" label={t("startDate")}>
            <Input id="startDate" name="startDate" type="date" defaultValue={values?.startDate ?? ""} required />
          </Field>
          <Field name="expiresOn" label={t("expiresOn")}>
            <Input id="expiresOn" name="expiresOn" type="date" defaultValue={values?.expiresOn ?? ""} />
          </Field>
          <Field name="letterTemplateId" label={t("letterTemplate")}>
            <Select id="letterTemplateId" name="letterTemplateId" defaultValue={values?.letterTemplateId ?? ""}>
              <option value="">{t("noLetter")}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="probationMonths" label={t("probationMonths")}>
            <Input id="probationMonths" name="probationMonths" type="number" min={0} max={OFFER_LIMITS.probationMonths} defaultValue={values?.probationMonths ?? 2} />
          </Field>
          <Field name="probationSalaryPercent" label={t("probationPercent")}>
            <Input id="probationSalaryPercent" name="probationSalaryPercent" type="number" min={OFFER_LIMITS.probationPercentMin} max={100} defaultValue={values?.probationSalaryPercent ?? 85} />
          </Field>
        </div>

        {canSetMoney ? (
          <div className="grid gap-4 rounded-lg border border-dashed p-3 sm:grid-cols-2">
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("moneyNote")}</p>
            <Field name="baseSalaryVnd" label={t("baseSalary")}>
              <Input id="baseSalaryVnd" name="baseSalaryVnd" inputMode="numeric" defaultValue={values?.baseSalaryVnd ?? ""} required />
            </Field>
            <Field name="allowancesVnd" label={t("allowances")}>
              <Input id="allowancesVnd" name="allowancesVnd" inputMode="numeric" defaultValue={values?.allowancesVnd ?? 0} />
            </Field>
          </div>
        ) : null}

        <Field name="note" label={t("note")}>
          <Input id="note" name="note" defaultValue={values?.note ?? ""} maxLength={OFFER_LIMITS.note} />
        </Field>
      </FieldErrors>

      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" size="sm" disabled={form.pending}>
          {offerId ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}

/** Submit for approval, send, withdraw — one button each, each refusable by the service. */
export function OfferMoves({ offerId, canSubmit, canSend, canWithdraw }: { offerId: string; canSubmit: boolean; canSend: boolean; canWithdraw: boolean }) {
  const t = useTranslations("recruit.offer");
  const router = useRouter();
  const refresh = () => router.refresh();
  const submit = useActionForm(submitOfferAction, { extra: { offerId }, onSuccess: refresh });
  const send = useActionForm(sendOfferAction, { extra: { offerId }, onSuccess: refresh });
  const withdraw = useActionForm(withdrawOfferAction, { extra: { offerId }, onSuccess: refresh });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canSubmit ? (
          <form onSubmit={submit.onSubmit}>
            <Button type="submit" size="sm" disabled={submit.pending}>
              {t("submitForApproval")}
            </Button>
          </form>
        ) : null}
        {canSend ? (
          <form onSubmit={send.onSubmit}>
            <Button type="submit" size="sm" disabled={send.pending}>
              {t("send")}
            </Button>
          </form>
        ) : null}
        {canWithdraw ? (
          <form onSubmit={withdraw.onSubmit}>
            <Button type="submit" size="sm" variant="ghost" disabled={withdraw.pending}>
              {t("withdraw")}
            </Button>
          </form>
        ) : null}
      </div>
      <FormError namespace="recruit.errors" errorKey={submit.errorKey ?? send.errorKey ?? withdraw.errorKey} />
    </div>
  );
}

/**
 * What the candidate said. Two buttons and, for a no, why — a short list so the funnel report can
 * count it rather than read it.
 */
export function OfferResponse({ offerId }: { offerId: string }) {
  const t = useTranslations("recruit.offer");
  const tReason = useTranslations("recruit.declineReasons");
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const form = useActionForm(respondToOfferAction, { extra: { offerId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("responseTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("responseNote")}</p>
      <FieldErrors value={form.fieldErrors}>
        {declining ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="reason" label={t("declineReason")}>
              <Select id="reason" name="reason" defaultValue="">
                <option value="">—</option>
                {OFFER_DECLINE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {tReason(reason)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name="note" label={t("note")}>
              <Input id="note" name="note" maxLength={2000} />
            </Field>
          </div>
        ) : null}
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="answer" value="accept" size="sm" disabled={form.pending}>
          {t("accepted")}
        </Button>
        {declining ? (
          <Button type="submit" name="answer" value="decline" size="sm" variant="outline" disabled={form.pending}>
            {t("confirmDecline")}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(true)}>
            {t("declined")}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The last step of the whole module: the accepted candidate becomes a pre-boarding person. The
 * employee code may be left blank, in which case the entity's own scheme allocates the next one.
 */
export function ConvertToEmployee({ offerId }: { offerId: string }) {
  const t = useTranslations("recruit.offer");
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useActionForm(convertOfferToEmployeeAction, {
    extra: { offerId },
    onSuccess: (data) => {
      const result = data as { personId: string; salaryProblem: string | null };
      // The person exists whatever payroll made of the figure; say so rather than pretend.
      if (result.salaryProblem) setProblem(result.salaryProblem);
      else router.push(`/people/${result.personId}`);
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
      <h3 className="text-sm font-medium">{t("convertTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("convertNote")}</p>
      <FieldErrors value={form.fieldErrors}>
        <Field name="employeeCode" label={t("employeeCode")}>
          <Input id="employeeCode" name="employeeCode" maxLength={32} placeholder={t("employeeCodeAuto")} />
        </Field>
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      {problem ? <p className="text-xs text-amber-600 dark:text-amber-500">{t("salaryProblem")}</p> : null}
      <div>
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("convert")}
        </Button>
      </div>
    </form>
  );
}
