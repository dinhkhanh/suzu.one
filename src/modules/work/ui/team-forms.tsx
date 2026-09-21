"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createTeamAction, deleteLabelAction, saveLabelAction, saveStateAction, setProjectMemberAction, setTeamMemberAction, updateTeamAction } from "../actions";
import { LABEL_COLORS, STATE_CATEGORIES, TEAM_ROLES, VISIBILITIES, WORKFLOW_PRESETS } from "../enums";

type Option = { id: string; name: string };
type Team = { id: string; key: string; name: string; description: string | null; entityId: string | null; departmentId: string | null; defaultVisibility: string; isActive: boolean };

export function TeamForm({ team, entities, departments, allowGroup }: { team?: Team; entities: Option[]; departments: Option[]; /** May the viewer file the team under the whole group? */ allowGroup: boolean }) {
  const t = useTranslations("work.teams");
  const tWork = useTranslations("work");
  const router = useRouter();
  const [preset, setPreset] = useState<keyof typeof WORKFLOW_PRESETS>("content");
  // A new team's states are created in the reader's language; the team renames them afterwards.
  const stateNames = Object.fromEntries(WORKFLOW_PRESETS[preset].map((state) => [state.key, tWork(`presetStates.${state.key}`)]));
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(team ? updateTeamAction : createTeamAction, {
    extra: team ? { teamId: team.id } : { stateNames },
    onSuccess: (data) => (team ? router.refresh() : router.push(`/work/teams/${(data as { id: string }).id}`)),
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="name" label={t("fields.name")}>
            <Input id="name" name="name" required maxLength={80} defaultValue={team?.name} />
          </Field>
          {team ? null : (
            <Field name="key" label={t("fields.key")}>
              <Input id="key" name="key" required maxLength={8} pattern="[A-Za-z][A-Za-z0-9]{1,7}" placeholder="VID" className="uppercase" />
            </Field>
          )}
          <Field name="entityId" label={t("fields.entityId")}>
            <Select id="entityId" name="entityId" defaultValue={team?.entityId ?? ""}>
              {allowGroup || (team && !team.entityId) ? <option value="">{t("wholeGroup")}</option> : null}
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="departmentId" label={t("fields.departmentId")}>
            <Select id="departmentId" name="departmentId" defaultValue={team?.departmentId ?? ""}>
              <option value="">{t("noDepartment")}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="defaultVisibility" label={t("fields.defaultVisibility")}>
            <Select id="defaultVisibility" name="defaultVisibility" defaultValue={team?.defaultVisibility ?? "team"}>
              {VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {tWork(`visibility.${visibility}`)}
                </option>
              ))}
            </Select>
          </Field>
          {team ? null : (
            <Field name="preset" label={t("fields.preset")}>
              <Select id="preset" name="preset" value={preset} onChange={(event) => setPreset(event.target.value as keyof typeof WORKFLOW_PRESETS)}>
                {Object.keys(WORKFLOW_PRESETS).map((key) => (
                  <option key={key} value={key}>
                    {t(`presets.${key}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <Field name="description" label={t("fields.description")}>
              <Input id="description" name="description" maxLength={500} defaultValue={team?.description ?? ""} />
            </Field>
          </div>
          {team ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={team.isActive} /> {t("fields.isActive")}
            </label>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">{WORKFLOW_PRESETS[preset].map((state) => tWork(`presetStates.${state.key}`)).join(" → ")}</p>
          )}
        </div>
      </FieldErrors>
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {team ? tWork("save") : t("create")}
        </Button>
        {saved && team ? <span className="text-sm text-muted-foreground">{tWork("saved")}</span> : null}
      </div>
    </form>
  );
}

/** Runs an action from a button or a select and shows what went wrong. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (action: (input: unknown) => Promise<{ ok: boolean; error?: string; message?: string }>, input: unknown, after?: () => void) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

export type Member = { personId: string; fullName: string; role: string };

/** Members of a team or a project: the same list, a different action. */
export function MemberManager({ members, people, canManage, target }: { members: Member[]; people: { id: string; fullName: string }[]; canManage: boolean; target: { teamId: string } | { projectId: string } }) {
  const t = useTranslations("work.members");
  const { run, pending, errorKey } = useRun();
  const form = useRef<HTMLFormElement>(null);
  const action = "teamId" in target ? setTeamMemberAction : setProjectMemberAction;
  const outsiders = people.filter((person) => !members.some((member) => member.personId === person.id));
  return (
    <div className="flex flex-col gap-3">
      <FormError namespace="work.errors" errorKey={errorKey} />
      <ul className="flex flex-col divide-y rounded-xl border">
        {members.map((member) => (
          <li key={member.personId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1 font-medium">{member.fullName}</span>
            {canManage ? (
              <>
                <Select aria-label={t("role")} className="w-36" value={member.role} disabled={pending} onChange={(event) => run(action, { ...target, personId: member.personId, role: event.target.value })}>
                  {TEAM_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`roles.${role}`)}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(action, { ...target, personId: member.personId, role: "" })}>
                  {t("remove")}
                </Button>
              </>
            ) : (
              <Badge variant="outline">{t(`roles.${member.role}`)}</Badge>
            )}
          </li>
        ))}
        {members.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("empty")}</li> : null}
      </ul>
      {canManage ? (
        <form
          ref={form}
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(action, { ...target, personId: data.get("personId"), role: data.get("role") }, () => form.current?.reset());
          }}
        >
          <Select name="personId" aria-label={t("person")} required className="w-56" defaultValue="">
            <option value="" disabled>
              {t("pickPerson")}
            </option>
            {outsiders.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
          <Select name="role" aria-label={t("role")} className="w-36" defaultValue="member">
            {TEAM_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            {t("add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export type StateItem = { id: string; name: string; category: string; sortOrder: number; isActive: boolean };

export function StateManager({ teamId, states, canManage }: { teamId: string; states: StateItem[]; canManage: boolean }) {
  const t = useTranslations("work.states");
  const tWork = useTranslations("work");
  const { run, pending, errorKey } = useRun();
  const submit = (stateId: string | null, reset: boolean) => (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(saveStateAction, { teamId, stateId: stateId ?? "", name: data.get("name"), category: data.get("category"), sortOrder: data.get("sortOrder"), isActive: stateId ? data.get("isActive") === "on" : true }, () => (reset ? form.reset() : undefined));
  };
  const fields = (state?: StateItem) => (
    <>
      <Input name="sortOrder" type="number" min={0} max={10000} required aria-label={t("order")} defaultValue={state?.sortOrder ?? (states.at(-1)?.sortOrder ?? 0) + 10} className="w-20" />
      <Input name="name" required maxLength={40} aria-label={t("name")} placeholder={t("name")} defaultValue={state?.name} className="w-48 flex-1" />
      <Select name="category" aria-label={t("category")} defaultValue={state?.category ?? "in_progress"} className="w-40">
        {STATE_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {tWork(`categories.${category}`)}
          </option>
        ))}
      </Select>
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      <FormError namespace="work.errors" errorKey={errorKey} />
      <ul className="flex flex-col divide-y rounded-xl border">
        {states.map((state) =>
          canManage ? (
            <li key={state.id}>
              <form onSubmit={submit(state.id, false)} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                {fields(state)}
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="isActive" defaultChecked={state.isActive} /> {t("active")}
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  {tWork("save")}
                </Button>
              </form>
            </li>
          ) : (
            <li key={state.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="flex-1 font-medium">{state.name}</span>
              <Badge variant="outline">{tWork(`categories.${state.category}`)}</Badge>
              {state.isActive ? null : <Badge variant="secondary">{t("inactive")}</Badge>}
            </li>
          ),
        )}
      </ul>
      {canManage ? (
        <form onSubmit={submit(null, true)} className="flex flex-wrap items-center gap-2 text-sm">
          {fields()}
          <Button type="submit" size="sm" disabled={pending}>
            {t("add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export const LABEL_CLASSES: Record<string, string> = {
  gray: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  yellow: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-300",
  green: "bg-green-500/15 text-green-700 dark:text-green-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};

export function LabelChip({ name, color }: { name: string; color: string }) {
  return <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${LABEL_CLASSES[color] ?? LABEL_CLASSES.gray}`}>{name}</span>;
}

export function LabelManager({ teamId, labels, canManage }: { teamId: string; labels: { id: string; teamId: string | null; name: string; color: string }[]; canManage: boolean }) {
  const t = useTranslations("work.labels");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-3">
      <FormError namespace="work.errors" errorKey={errorKey} />
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <span key={label.id} className="inline-flex items-center gap-1">
            <LabelChip name={label.name} color={label.color} />
            {label.teamId === null ? <span className="text-xs text-muted-foreground">{t("shared")}</span> : null}
            {canManage && label.teamId ? (
              <button type="button" className="text-xs text-muted-foreground hover:text-destructive" aria-label={t("delete", { name: label.name })} disabled={pending} onClick={() => run(deleteLabelAction, { labelId: label.id })}>
                ×
              </button>
            ) : null}
          </span>
        ))}
        {labels.length === 0 ? <span className="text-sm text-muted-foreground">{t("empty")}</span> : null}
      </div>
      {canManage ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run(saveLabelAction, { teamId, name: data.get("name"), color: data.get("color") }, () => form.reset());
          }}
        >
          <Input name="name" required maxLength={40} placeholder={t("name")} aria-label={t("name")} className="w-48" />
          <Select name="color" aria-label={t("color")} defaultValue="blue" className="w-32">
            {LABEL_COLORS.map((color) => (
              <option key={color} value={color}>
                {t(`colors.${color}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            {t("add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
