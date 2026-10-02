"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/select";
import { capitalizeWords } from "@/lib/text";
import { setPersonCompetenciesAction } from "../competency-actions";

type Names = { profession: string[]; skill: string[] };

/**
 * The two lists of a profile, each a field of chips: pick from what colleagues already use, or
 * type a new name and add it — it joins the catalogue for everybody after. Saving replaces both
 * lists; the panel closes and the profile above shows the result.
 */
export function CompetenciesForm({ personId, held, choices }: { personId: string; held: Names; choices: Names }) {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(setPersonCompetenciesAction, {
    extra: { personId },
    onSuccess: () => details.current?.removeAttribute("open"),
  });

  return (
    <details ref={details} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("competencies.edit")}</summary>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("competencies.hint")}</p>
        <Field name="professions" label={t("competencies.profession")}>
          {/* Keyed on what is held, so the chips follow the profile after a save. */}
          <MultiSelect key={held.profession.join("|")} id="professions" name="professions[]" defaultValue={held.profession} creatable formatNew={capitalizeWords}>
            {choices.profession.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </MultiSelect>
        </Field>
        <Field name="skills" label={t("competencies.skill")}>
          <MultiSelect key={held.skill.join("|")} id="skills" name="skills[]" defaultValue={held.skill} creatable formatNew={capitalizeWords}>
            {choices.skill.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </MultiSelect>
        </Field>
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
