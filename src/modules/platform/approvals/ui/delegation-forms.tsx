"use client";
import { useTranslations } from "next-intl";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createDelegationAction, revokeDelegationAction } from "../actions";

export function DelegationForm({ people, requestTypes, today }: { people: { id: string; fullName: string }[]; requestTypes: string[]; today: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(createDelegationAction);
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="toPersonId" label={t("delegation.to")}>
            <Select id="toPersonId" name="toPersonId" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="requestTypes" label={t("delegation.types")}>
            <Select id="requestTypes" name="requestTypes" defaultValue="">
              <option value="">{t("delegation.allTypes")}</option>
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("delegation.from")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={today} />
          </Field>
          <Field name="validTo" label={t("delegation.until")}>
            <Input id="validTo" name="validTo" type="date" required min={today} />
          </Field>
        </div>
        <Field name="reason" label={t("delegation.reason")}>
          <Input id="reason" name="reason" maxLength={300} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="includePending" className="size-4" />
          {t("delegation.includePending")}
        </label>
      </FieldErrors>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("delegation.saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("delegation.submit")}
        </Button>
      </div>
    </form>
  );
}

export function RevokeDelegationButton({ id }: { id: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(revokeDelegationAction, { extra: { id } });
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("delegation.revoke")}
      </Button>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
    </form>
  );
}
