"use client";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createOrgUnitAction, updateOrgUnitAction } from "../actions";
import { ORG_UNIT_KINDS, type OrgUnitKind } from "../enums";
import { ActiveCheckbox } from "./entity-forms";

type Option = { id: string; name: string };
/** Units in tree order; `depth` indents the label so the shape of the tree is visible in a `<select>`. */
export type UnitOption = Option & { depth: number; path: readonly string[] };

const indent = (option: UnitOption) => `${"— ".repeat(option.depth)}${option.name}`;

/** What the form needs of a unit — a tree node or a row, either will do. */
type EditableUnit = { id: string; name: string; kind: OrgUnitKind; parentId: string | null; isActive: boolean };

/**
 * One form for every level of the tree (FR-PLT-16). "Parent" is what makes a unit a small team
 * inside a big one; `kind` is only the word people use for it.
 */
export function OrgUnitForm({ unit, parents, entities, canShare = false, defaultParentId }: { unit?: EditableUnit; parents: UnitOption[]; entities: Option[]; canShare?: boolean; defaultParentId?: string }) {
  const t = useTranslations("org");
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(unit ? updateOrgUnitAction : createOrgUnitAction, {
    extra: unit ? { id: unit.id } : {},
    onSuccess: () => (unit ? undefined : form.current?.reset()),
  });
  const suffix = unit?.id ?? `new-${defaultParentId ?? "root"}`;
  // A unit cannot be put inside itself or inside its own descendants.
  const allowedParents = unit ? parents.filter((parent) => parent.id !== unit.id && !parent.path.includes(unit.id)) : parents;

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {unit ? null : (
          <Field name={`unit-code-${suffix}`} label={t("code")}>
            <Input id={`unit-code-${suffix}`} name="code" minLength={2} maxLength={12} pattern="[A-Za-z0-9_-]+" />
          </Field>
        )}
        <Field name={`unit-name-${suffix}`} label={t("name")}>
          <Input id={`unit-name-${suffix}`} name="name" required maxLength={120} defaultValue={unit?.name} />
        </Field>
        <Field name={`unit-kind-${suffix}`} label={t("kind")}>
          <Select id={`unit-kind-${suffix}`} name="kind" defaultValue={unit?.kind ?? (defaultParentId ? "team" : "department")}>
            {ORG_UNIT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name={`unit-parent-${suffix}`} label={t("parent")}>
          <Select id={`unit-parent-${suffix}`} name="parentId" defaultValue={unit?.parentId ?? defaultParentId ?? ""}>
            <option value="">{t("noParent")}</option>
            {allowedParents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {indent(parent)}
              </option>
            ))}
          </Select>
        </Field>
        {unit || defaultParentId ? null : (
          <Field name={`unit-entity-${suffix}`} label={t("belongsTo")}>
            <Select id={`unit-entity-${suffix}`} name="entityId" defaultValue={canShare ? "" : entities[0]?.id}>
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
      {unit ? <ActiveCheckbox defaultChecked={unit.isActive} label={t("active")} /> : null}
      <FormError namespace="org.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant={unit ? "outline" : "default"} disabled={pending}>
          {unit ? t("save") : t("addUnit")}
        </Button>
      </div>
    </form>
  );
}
