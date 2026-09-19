"use client";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { grantRoleAction, revokeRoleAction } from "../actions";
import { ROLES } from "../roles";

const SCOPE_TYPES = ["group", "entity", "department", "team"] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];
type Option = { id: string; name: string };

export function GrantRoleForm({ people, scopes, today }: { people: Option[]; scopes: Record<Exclude<ScopeType, "group">, Option[]>; today: string }) {
  const t = useTranslations("rbac");
  const roleName = useTranslations("roles");
  const form = useRef<HTMLFormElement>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("group");
  const { onSubmit, pending, errorKey } = useActionForm(grantRoleAction, {
    onSuccess: () => {
      form.current?.reset();
      setScopeType("group");
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("grant")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="personId" label={t("person")}>
          <Select id="personId" name="personId" required defaultValue="">
            <option value="" disabled>
              {t("choose")}
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="role" label={t("role")}>
          <Select id="role" name="role" required defaultValue="">
            <option value="" disabled>
              {t("choose")}
            </option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {roleName(role)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="scopeType" label={t("scopeType")}>
          <Select id="scopeType" name="scopeType" value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)}>
            {SCOPE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`scope.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        {scopeType === "group" ? null : (
          <Field name="scopeId" label={t(`scope.${scopeType}`)}>
            <Select key={scopeType} id="scopeId" name="scopeId" required defaultValue="">
              <option value="" disabled>
                {t("choose")}
              </option>
              {scopes[scopeType].map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field name="validFrom" label={t("validFrom")}>
          <Input id="validFrom" name="validFrom" type="date" required defaultValue={today} />
        </Field>
        <Field name="validTo" label={t("validTo")}>
          <Input id="validTo" name="validTo" type="date" />
        </Field>
      </div>
      <FormError namespace="rbac.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("grantSubmit")}
        </Button>
      </div>
    </form>
  );
}

// Two clicks: revoking takes effect on the person's very next request.
export function RevokeRoleButton({ id }: { id: string }) {
  const t = useTranslations("rbac");
  const [armed, setArmed] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm(revokeRoleAction, { extra: { id } });

  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        {t("revoke")}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {t("revokeConfirm")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
          {t("cancel")}
        </Button>
      </div>
      <FormError namespace="rbac.errors" errorKey={errorKey} />
    </form>
  );
}
