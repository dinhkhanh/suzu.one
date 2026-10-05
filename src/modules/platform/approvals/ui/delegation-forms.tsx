"use client";
import { useTranslations } from "next-intl";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createDelegationAction, createDelegationForAction, revokeDelegationAction, revokeDelegationForAction } from "../actions";

/**
 * "While I am away, my approvals go to …". With `forPersonId` an administrator fills it in for
 * someone who is away and cannot (FR-ACL-06): the same form, the reason no longer optional.
 */
export function DelegationForm({ people, requestTypes, today, forPersonId }: { people: { id: string; fullName: string }[]; requestTypes: { type: string; name: string }[]; today: string; forPersonId?: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm<{ id: string; handedOver: number }>(forPersonId ? createDelegationForAction : createDelegationAction, forPersonId ? { extra: { fromPersonId: forPersonId } } : {});
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 md:grid-cols-2">
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
              {requestTypes.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("delegation.from")}>
            <DatePicker id="validFrom" name="validFrom" required defaultValue={today} />
          </Field>
          <Field name="validTo" label={t("delegation.until")}>
            <DatePicker id="validTo" name="validTo" required min={today} />
          </Field>
        </div>
        <Field name="reason" label={t("delegation.reason")}>
          <Input id="reason" name="reason" maxLength={300} required={!!forPersonId} />
        </Field>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox name="includePending" />
          {forPersonId ? t("delegation.onBehalf.includePending") : t("delegation.includePending")}
        </Label>
      </FieldErrors>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("delegation.saved")}</p> : null}
      <div>
        <Button type="submit" size="lg" disabled={pending} className="w-full md:w-auto">
          {t("delegation.submit")}
        </Button>
      </div>
    </form>
  );
}

export function RevokeDelegationButton({ id, onBehalf = false }: { id: string; /** An administrator ends it in the absent person's name. */ onBehalf?: boolean }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(onBehalf ? revokeDelegationForAction : revokeDelegationAction, { extra: { id } });
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("delegation.revoke")}
      </Button>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
    </form>
  );
}
