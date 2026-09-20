"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { giveKudosAction } from "../actions";
import { KUDOS_MESSAGE_MAX } from "../enums";

export function KudosForm({ people, values }: { people: { id: string; fullName: string }[]; values: { key: string; name: string }[] }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useActionForm(giveKudosAction, {
    onSuccess: () => {
      formRef.current?.reset();
      router.refresh();
    },
  });
  return (
    <form ref={formRef} onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="toPersonId" label={t("kudos.to")}>
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
          <Field name="valueKey" label={t("kudos.value")}>
            <Select id="valueKey" name="valueKey" required defaultValue={values[0]?.key ?? ""}>
              {values.map((value) => (
                <option key={value.key} value={value.key}>
                  {value.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field name="message" label={t("kudos.message")}>
          <textarea id="message" name="message" required rows={3} maxLength={KUDOS_MESSAGE_MAX} className="rounded-lg border bg-background px-2.5 py-1.5 text-sm" />
        </Field>
      </FieldErrors>
      <FormError namespace="comms.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("kudos.give")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("kudos.sent")}</span> : null}
      </div>
    </form>
  );
}
