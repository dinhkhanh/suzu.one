"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createDepartmentAction, createTeamAction, updateDepartmentAction, updateTeamAction } from "../actions";
import type { DepartmentRow, TeamRow } from "../service";
import { ActiveCheckbox } from "./entity-forms";

type Option = { id: string; name: string };

export function DepartmentForm({ department, parents, entities, canShare = false }: { department?: DepartmentRow; parents: Option[]; entities: Option[]; canShare?: boolean }) {
  const t = useTranslations("org");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(department ? updateDepartmentAction : createDepartmentAction, {
    extra: department ? { id: department.id } : {},
    onSuccess: () => (department ? undefined : form.current?.reset()),
  });
  const suffix = department?.id ?? "new";

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {department ? null : (
          <Field name={`department-code-${suffix}`} label={t("code")}>
            <Input id={`department-code-${suffix}`} name="code" required minLength={2} maxLength={12} pattern="[A-Za-z0-9_-]+" />
          </Field>
        )}
        <Field name={`department-name-${suffix}`} label={t("name")}>
          <Input id={`department-name-${suffix}`} name="name" required maxLength={120} defaultValue={department?.name} />
        </Field>
        <Field name={`department-parent-${suffix}`} label={t("parent")}>
          <Select id={`department-parent-${suffix}`} name="parentId" defaultValue={department?.parentId ?? ""}>
            <option value="">{t("noParent")}</option>
            {parents
              .filter((parent) => parent.id !== department?.id)
              .map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
          </Select>
        </Field>
        {department ? null : (
          <Field name={`department-entity-${suffix}`} label={t("belongsTo")}>
            <Select id={`department-entity-${suffix}`} name="entityId" defaultValue={canShare ? "" : entities[0]?.id}>
              {canShare ? <option value="">{t("shared")}</option> : null}
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {department ? <ActiveCheckbox defaultChecked={department.isActive} label={t("active")} /> : null}
      <FormError namespace="org.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant={department ? "outline" : "default"} disabled={pending}>
          {department ? t("save") : t("addDepartment")}
        </Button>
      </div>
    </form>
  );
}

export function TeamForm({ departmentId, team }: { departmentId: string; team?: TeamRow }) {
  const t = useTranslations("org");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(team ? updateTeamAction : createTeamAction, {
    extra: team ? { id: team.id } : { departmentId },
    onSuccess: () => (team ? undefined : form.current?.reset()),
  });
  const suffix = team?.id ?? `new-${departmentId}`;

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field name={`team-name-${suffix}`} label={team ? t("teamName") : t("newTeam")}>
          <Input id={`team-name-${suffix}`} name="name" required maxLength={120} defaultValue={team?.name} />
        </Field>
        {team ? <ActiveCheckbox defaultChecked={team.isActive} label={t("active")} /> : null}
        <Button type="submit" variant="outline" disabled={pending}>
          {team ? t("save") : t("addTeam")}
        </Button>
      </div>
      <FormError namespace="org.errors" errorKey={errorKey} />
    </form>
  );
}
