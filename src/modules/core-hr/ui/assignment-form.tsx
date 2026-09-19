"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeAssignmentAction } from "../actions";
import type { PersonView } from "../service";
import { Field, FormError, PlacementFields, type PlacementOptions } from "./fields";
import { useActionForm } from "./use-action-form";

export function AssignmentForm({ person, options, today }: { person: PersonView; options: PlacementOptions; today: string }) {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(changeAssignmentAction, {
    extra: { personId: person.id },
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });
  const current = person.personal?.current;

  return (
    <details ref={details} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("assignment.change")}</summary>
      <form ref={form} onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("assignment.hint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="validFrom" label={t("fields.validFrom")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={today} min={person.personal?.startDate ?? undefined} />
          </Field>
          <div className="sm:col-span-1 lg:col-span-2">
            <Field name="changeReason" label={t("fields.changeReason")}>
              <Input id="changeReason" name="changeReason" maxLength={300} />
            </Field>
          </div>
        </div>
        {/* Keyed so the defaults follow the assignment once it changes. */}
        <PlacementFields key={current?.id} options={options} defaults={current ?? undefined} exceptPersonId={person.id} />
        <FormError errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </details>
  );
}
