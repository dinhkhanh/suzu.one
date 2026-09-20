"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { decideParameterAction, proposeParameterAction } from "../actions";
import { PARAMETER_KEYS, type ParameterKey } from "../catalogue";

/** Starts from the value in force, so a change is an edit of what is there rather than a blank page. */
export function ProposeParameterForm({ current }: { current: Partial<Record<ParameterKey, unknown>> }) {
  const t = useTranslations("rules");
  const form = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState<ParameterKey>(PARAMETER_KEYS[0]);
  const { onSubmit, pending, errorKey } = useActionForm(proposeParameterAction, { onSuccess: () => form.current?.reset() });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("propose.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("propose.hint")}</p>
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
          <Input id="validFrom" name="validFrom" type="date" required />
        </Field>
        <div className="sm:col-span-2">
          <Field name="value" label={t("propose.value")}>
            <textarea
              key={key}
              id="value"
              name="value"
              required
              rows={8}
              spellCheck={false}
              defaultValue={JSON.stringify(current[key] ?? {}, null, 2)}
              className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
            />
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
      <div>
        <Button type="submit" disabled={pending}>
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
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        {decisions.map((option) => (
          <Button key={option} type="submit" name="decision" value={option} size="sm" variant={option === "reject" ? "outline" : "default"} disabled={pending}>
            {t(`decisions.${option}`)}
          </Button>
        ))}
      </div>
      <FormError namespace="rules.errors" errorKey={errorKey} />
    </form>
  );
}
