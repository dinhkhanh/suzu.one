"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { hirePersonAction } from "../actions";
import { Field, FormError } from "@/components/forms/field";
import { IdentityFields, PlacementFields, type PlacementOptions } from "./fields";
import { useActionForm } from "@/components/forms/use-action-form";

export function HireForm({ entities, options, today }: { entities: { id: string; name: string }[]; options: PlacementOptions; today: string }) {
  const t = useTranslations("people");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey } = useActionForm(hirePersonAction, { onSuccess: (data) => router.push(`/people/${data.id}`) });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sections.identity")}</h2>
        <IdentityFields />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sections.employment")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="entityId" label={t("fields.entity")}>
            <Select id="entityId" name="entityId" required value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="employeeCode" label={t("fields.employeeCode")}>
            <Input id="employeeCode" name="employeeCode" maxLength={30} placeholder={t("fields.employeeCodeHint")} />
          </Field>
          <div className="hidden lg:block" />
          <Field name="startDate" label={t("fields.startDate")}>
            <Input id="startDate" name="startDate" type="date" required defaultValue={today} />
          </Field>
          <Field name="seniorityDate" label={t("fields.seniorityDate")}>
            <Input id="seniorityDate" name="seniorityDate" type="date" />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sections.placement")}</h2>
        <PlacementFields options={{ ...options, branches: options.branches.filter((branch) => branch.entityId === entityId) }} />
      </section>

      <FormError namespace="people.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("hire.submit")}
        </Button>
      </div>
    </form>
  );
}
