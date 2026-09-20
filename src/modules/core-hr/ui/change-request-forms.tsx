"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { resubmitProfileChangeAction, revealChangeRequestAction, submitProfileChangeAction } from "../change-request-actions";
import { MARITAL_STATUSES, RESTRICTED_CHANGE_FIELDS } from "../enums";

type PersonalValues = { phone: string | null; personalEmail: string | null; permanentAddress: string | null; currentAddress: string | null; maritalStatus: string | null };

/**
 * The employee's request to change their own data. Personal fields start from what is on file and
 * the request is the difference; restricted fields start empty, and an empty one means "no change".
 * With `requestId` the form sends a returned request round again.
 */
export function ChangeRequestForm({ current, requestId }: { current: PersonalValues; requestId?: string }) {
  const t = useTranslations("changeRequests");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, saved } = useActionForm(requestId ? resubmitProfileChangeAction : submitProfileChangeAction, {
    extra: requestId ? { requestId } : undefined,
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });

  return (
    <details ref={details} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{requestId ? t("form.resubmitTitle") : t("form.title")}</summary>
      <form ref={form} onSubmit={onSubmit} className="mt-4 flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">{t("form.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="personal.phone" label={t("fields.phone")}>
            <Input id="personal.phone" name="personal.phone" type="tel" maxLength={30} defaultValue={current.phone ?? ""} />
          </Field>
          <Field name="personal.personalEmail" label={t("fields.personalEmail")}>
            <Input id="personal.personalEmail" name="personal.personalEmail" type="email" maxLength={200} defaultValue={current.personalEmail ?? ""} />
          </Field>
          <Field name="personal.maritalStatus" label={t("fields.maritalStatus")}>
            <Select id="personal.maritalStatus" name="personal.maritalStatus" defaultValue={current.maritalStatus ?? ""}>
              <option value="">—</option>
              {MARITAL_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`maritalStatus.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="personal.permanentAddress" label={t("fields.permanentAddress")}>
            <Input id="personal.permanentAddress" name="personal.permanentAddress" maxLength={300} defaultValue={current.permanentAddress ?? ""} />
          </Field>
          <Field name="personal.currentAddress" label={t("fields.currentAddress")}>
            <Input id="personal.currentAddress" name="personal.currentAddress" maxLength={300} defaultValue={current.currentAddress ?? ""} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t("form.restricted")}</legend>
          <p className="text-xs text-muted-foreground">{t("form.restrictedHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RESTRICTED_CHANGE_FIELDS.map((field) => (
              <Field key={field} name={`restricted.${field}`} label={t(`fields.${field}`)}>
                <Input id={`restricted.${field}`} name={`restricted.${field}`} type={field === "nationalIdIssuedOn" ? "date" : "text"} maxLength={200} autoComplete="off" />
              </Field>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t("fields.bankAccount")}</legend>
          <p className="text-xs text-muted-foreground">{t("form.bankHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["bankName", "accountNumber", "accountHolder", "branch"] as const).map((field) => (
              <Field key={field} name={`bankAccount.${field}`} label={t(`bank.${field}`)}>
                <Input id={`bankAccount.${field}`} name={`bankAccount.${field}`} maxLength={120} autoComplete="off" />
              </Field>
            ))}
          </div>
        </fieldset>

        <FormError namespace="changeRequests.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("form.sending") : requestId ? t("form.resubmit") : t("form.submit")}
          </Button>
        </div>
      </form>
      {saved ? <p className="mt-3 text-sm text-muted-foreground">{t("form.sent")}</p> : null}
    </details>
  );
}

type Revealed = Partial<Record<(typeof RESTRICTED_CHANGE_FIELDS)[number], string>> & { bankAccount?: { bankName: string; accountNumber: string; accountHolder: string | null; branch: string | null } };

/** The proposed restricted values: listed by name, shown on request, and the showing is audited. */
export function ChangeRequestReveal({ requestId, fields, canReveal }: { requestId: string; fields: string[]; canReveal: boolean }) {
  const t = useTranslations("changeRequests");
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Revealed | null>(null);
  const [failed, setFailed] = useState(false);

  const shown = (field: string) => {
    if (!values) return "••••••";
    if (field !== "bankAccount") return values[field as keyof Revealed] as string;
    const account = values.bankAccount;
    return account ? [account.bankName, account.accountNumber, account.accountHolder, account.branch].filter(Boolean).join(" · ") : "—";
  };

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field}>
            <dt className="text-xs text-muted-foreground">{t(`fields.${field}` as "fields.nationalId")}</dt>
            <dd className="text-sm">{shown(field)}</dd>
          </div>
        ))}
      </dl>
      {canReveal ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (values) return setValues(null);
              startTransition(async () => {
                const result = await revealChangeRequestAction({ requestId });
                setFailed(!result.ok);
                if (result.ok) setValues(result.data as Revealed);
              });
            }}
          >
            {values ? t("reveal.hide") : t("reveal.show")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("reveal.audited")}</span>
          {failed ? <span role="alert" className="text-xs text-destructive">{t("errors.generic")}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
