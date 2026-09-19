"use client";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { setRolloutAction } from "../actions";
import type { FlagKey, Rollout } from "../flags";

type Option = { id: string; name: string };

function Choices({ name, legend, options, chosen }: { name: string; legend: string; options: Option[]; chosen: readonly string[] }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={`${name}[]`} value={option.id} defaultChecked={chosen.includes(option.id)} className="size-4" />
            <span className="truncate">{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RolloutForm({ flag, rollout, entities, departments, people }: { flag: FlagKey; rollout: Rollout; entities: Option[]; departments: Option[]; people: Option[] }) {
  const t = useTranslations("flags");
  const { onSubmit, pending, errorKey, saved } = useActionForm(setRolloutAction, { extra: { key: flag } });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-medium">{t(`names.${flag}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`descriptions.${flag}`)}</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabledForAll" defaultChecked={rollout.enabledForAll} className="size-4" />
        {t("everyone")}
      </label>
      <p className="text-xs text-muted-foreground">{t("orPilot")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Choices name="entityIds" legend={t("entities")} options={entities} chosen={rollout.entityIds} />
        <Choices name="departmentIds" legend={t("departments")} options={departments} chosen={rollout.departmentIds} />
        <Choices name="personIds" legend={t("people")} options={people} chosen={rollout.personIds} />
      </div>
      <FormError namespace="flags.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
