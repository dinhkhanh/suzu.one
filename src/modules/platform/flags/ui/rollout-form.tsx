"use client";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ListItem } from "@/components/ui/list";
import { cn } from "cn";
import { setRolloutAction } from "../actions";
import type { FlagKey, Rollout } from "../flags";

type Option = { id: string; name: string };
type Picked = { entityIds: string[]; departmentIds: string[]; personIds: string[] };
type Group = keyof Picked;

// The on/off switch: the shadcn checkbox drawn as a 36×22 pill with an 18px knob that slides to
// the right and turns the track blue when checked. Posts "on" under its name like any checkbox.
const SWITCH =
  "h-[22px] w-9 rounded-full border-transparent bg-input md:h-[22px] md:w-9 data-checked:bg-primary data-checked:border-transparent [&_[data-slot=checkbox-indicator]]:hidden " +
  "before:absolute before:top-0.5 before:left-0.5 before:size-[18px] before:rounded-full before:bg-background before:shadow-[0_1px_2px_oklch(0_0_0/20%)] before:transition-transform before:duration-200 before:ease-(--ease-settle) data-checked:before:translate-x-3.5";

function Choices({ name, legend, options, chosen, onChange }: { name: Group; legend: string; options: Option[]; chosen: readonly string[]; onChange: (id: string, on: boolean) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="section-label mb-1.5">{legend}</legend>
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-border bg-background p-1.5">
        {options.length === 0 ? <p className="px-1.5 py-1 text-xs text-faint">—</p> : null}
        {options.map((option) => {
          const id = `${name}-${option.id}`;
          return (
            <Label key={option.id} htmlFor={id} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[7px] px-1.5 text-[0.8125rem] font-normal hover:bg-canvas">
              <Checkbox id={id} name={`${name}[]`} value={option.id} defaultChecked={chosen.includes(option.id)} onCheckedChange={(on) => onChange(option.id, on)} />
              <span className="truncate">{option.name}</span>
            </Label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * One module's rollout, as a row of the rollout card: its name and what it is, the switch for the
 * whole group, the pilot chips, and the keys that save or discard the change.
 */
export function RolloutForm({ flag, rollout, entities, departments, people }: { flag: FlagKey; rollout: Rollout; entities: Option[]; departments: Option[]; people: Option[] }) {
  const t = useTranslations("flags");
  const { onSubmit, pending, errorKey, saved } = useActionForm(setRolloutAction, { extra: { key: flag } });
  const [everyone, setEveryone] = useState(rollout.enabledForAll);
  const [picked, setPicked] = useState<Picked>({ entityIds: [...rollout.entityIds], departmentIds: [...rollout.departmentIds], personIds: [...rollout.personIds] });
  const [open, setOpen] = useState(false);
  const names = { entityIds: new Map(entities.map((option) => [option.id, option.name])), departmentIds: new Map(departments.map((option) => [option.id, option.name])), personIds: new Map(people.map((option) => [option.id, option.name])) };
  const change = (group: Group) => (id: string, on: boolean) => setPicked((current) => ({ ...current, [group]: on ? [...new Set([...current[group], id])] : current[group].filter((item) => item !== id) }));
  const chips = (Object.keys(picked) as Group[]).flatMap((group) => picked[group].map((id) => ({ group, id, name: names[group].get(id) ?? id })));
  const switchId = `flag-${flag}`;

  return (
    <ListItem className="flex-col items-stretch py-4">
      <form
        onSubmit={onSubmit}
        onReset={() => {
          setEveryone(rollout.enabledForAll);
          setPicked({ entityIds: [...rollout.entityIds], departmentIds: [...rollout.departmentIds], personIds: [...rollout.personIds] });
        }}
        className="flex w-full flex-col gap-4"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)] md:items-start">
          <div className="min-w-0">
            <h3 className="text-[0.9375rem] font-semibold">{t(`names.${flag}`)}</h3>
            <p className="text-sm text-muted-foreground">{t(`descriptions.${flag}`)}</p>
          </div>
          <Label htmlFor={switchId} className="flex cursor-pointer items-center gap-2.5 md:pt-1">
            <Checkbox id={switchId} name="enabledForAll" defaultChecked={rollout.enabledForAll} onCheckedChange={setEveryone} className={SWITCH} />
            <span className={cn("text-sm", everyone ? "font-medium text-foreground" : "text-muted-foreground")}>{everyone ? t("everyoneShort") : t("pilot")}</span>
          </Label>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:pt-1">
            {chips.length === 0 && !everyone ? <span className="text-xs text-faint">{t("noPilot")}</span> : null}
            {chips.map((chip) => (
              <Badge key={`${chip.group}-${chip.id}`} variant={chip.group === "personIds" ? "secondary" : "info"} className="max-w-48">
                <span className="truncate">{chip.name}</span>
              </Badge>
            ))}
            <Button type="button" variant="outline" size="xs" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
              <PlusIcon aria-hidden className={cn("transition-transform duration-200 ease-(--ease-settle)", open && "rotate-45")} />
              {t("add")}
            </Button>
          </div>
        </div>

        <div className={cn("grid gap-4 rounded-[10px] bg-canvas p-3 sm:grid-cols-3", !open && "hidden")}>
          <Choices name="entityIds" legend={t("entities")} options={entities} chosen={rollout.entityIds} onChange={change("entityIds")} />
          <Choices name="departmentIds" legend={t("departments")} options={departments} chosen={rollout.departmentIds} onChange={change("departmentIds")} />
          <Choices name="personIds" legend={t("people")} options={people} chosen={rollout.personIds} onChange={change("personIds")} />
        </div>

        <FormError namespace="flags.errors" errorKey={errorKey} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved ? <span className="mr-auto text-xs text-success">{t("saved")}</span> : null}
          <Button type="reset" variant="outline" disabled={pending}>
            {t("discard")}
          </Button>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </ListItem>
  );
}
