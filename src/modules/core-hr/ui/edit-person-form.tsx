"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { updatePersonAction } from "../actions";
import type { PersonView } from "../service";
import { FieldErrors, FormError } from "@/components/forms/field";
import { IdentityFields } from "./fields";
import { useActionForm } from "@/components/forms/use-action-form";

export function EditPersonForm({ person }: { person: PersonView }) {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(updatePersonAction, {
    extra: { personId: person.id },
    onSuccess: () => details.current?.removeAttribute("open"),
  });

  return (
    <details ref={details} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("edit.title")}</summary>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <FieldErrors value={fieldErrors}>
          <IdentityFields defaults={{ fullName: person.fullName, workEmail: person.workEmail, profile: person.personal?.profile }} />
        </FieldErrors>
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </details>
  );
}
