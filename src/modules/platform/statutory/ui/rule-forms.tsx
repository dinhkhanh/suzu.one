"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { decideParameterAction, proposeParameterAction } from "../actions";
import { PARAMETER_KEYS, type ParameterKey } from "../catalogue";

/** Starts from the value in force, so a change is an edit of what is there rather than a blank page. */
export function ProposeParameterForm({ current }: { current: Partial<Record<ParameterKey, unknown>> }) {
  const t = useTranslations("rules");
  const form = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState<ParameterKey>(PARAMETER_KEYS[0]);
  const { onSubmit, pending, errorKey } = useActionForm(proposeParameterAction, { onSuccess: () => form.current?.reset() });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="key" label={t("parameter")}>
          <Select id="key" name="key" value={key} onChange={(event) => setKey(event.target.value as ParameterKey)}>
            {PARAMETER_KEYS.map((option) => (
              <option key={option} value={option}>
                {t(`parameters.${option.replace(".", "_")}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="validFrom" label={t("validFrom")}>
          <DatePicker id="validFrom" name="validFrom" required />
        </Field>
        <div className="sm:col-span-2">
          <Field name="value" label={t("propose.value")}>
            <Textarea key={key} id="value" name="value" required rows={8} spellCheck={false} defaultValue={JSON.stringify(current[key] ?? {}, null, 2)} className="min-h-48 font-mono text-xs leading-relaxed md:text-xs" />
          </Field>
        </div>
        <Field name="legalReference" label={t("legalReference")}>
          <Input id="legalReference" name="legalReference" maxLength={300} required />
        </Field>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={500} />
        </Field>
      </div>
      <FormError namespace="rules.errors" errorKey={errorKey} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} size="lg" className="w-full md:w-auto">
          {t("propose.submit")}
        </Button>
      </div>
    </form>
  );
}

export function DecisionButtons({ id, decisions }: { id: string; decisions: readonly ("approve" | "reject" | "verify")[] }) {
  const t = useTranslations("rules");
  const { onSubmit, pending, errorKey } = useActionForm(decideParameterAction, { extra: { id } });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {decisions.map((option) => (
          <Button key={option} type="submit" name="decision" value={option} size="sm" variant={option === "reject" ? "destructive" : option === "verify" ? "outline" : "default"} disabled={pending}>
            {t(`decisions.${option}`)}
          </Button>
        ))}
      </div>
      <FormError namespace="rules.errors" errorKey={errorKey} />
    </form>
  );
}
