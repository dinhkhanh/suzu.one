"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { RecordLink } from "@/components/ui/record-link";
import { recordHref } from "@/lib/record-routes";
import { hirePersonAction } from "../actions";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { IdentityFields, PlacementFields, type PlacementOptions } from "./fields";
import { useActionForm } from "@/components/forms/use-action-form";

type Duplicate = { id: string; fullName: string; entityName: string | null; employeeCode: string | null; former: boolean; reasons: ("name_and_birth" | "personal_email" | "phone")[] };

export function HireForm({ entities, options, today }: { entities: { id: string; name: string }[]; options: PlacementOptions; today: string }) {
  const t = useTranslations("people");
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const { onSubmit, pending, errorKey, fieldErrors, details } = useActionForm(hirePersonAction, { onSuccess: (data) => router.push(recordHref("person", data.id)) });
  const duplicates = errorKey === "possible_duplicate" ? ((details as { duplicates?: Duplicate[] } | null)?.duplicates ?? []) : [];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <FieldErrors value={fieldErrors}>
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
              <DatePicker id="startDate" name="startDate" required defaultValue={today} />
            </Field>
            <Field name="seniorityDate" label={t("fields.seniorityDate")}>
              <DatePicker id="seniorityDate" name="seniorityDate" />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.placement")}</h2>
          <PlacementFields options={{ ...options, branches: options.branches.filter((branch) => branch.entityId === entityId) }} />
        </section>
      </FieldErrors>
      {duplicates.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>{t("duplicates.title")}</AlertTitle>
          <ul className="flex w-full flex-col gap-1 text-foreground">
            {duplicates.map((candidate) => (
              <li key={candidate.id}>
                <RecordLink kind="person" id={candidate.id} target="_blank" className="underline">
                  {candidate.fullName}
                </RecordLink>{" "}
                <span className="text-muted-foreground">
                  {[candidate.employeeCode, candidate.entityName, candidate.former ? t("duplicates.former") : null, ...candidate.reasons.map((reason) => t(`duplicates.reasons.${reason}`))].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="w-full text-muted-foreground">{t("duplicates.hint")}</p>
          <label className="flex w-full items-center gap-2 text-foreground">
            <Checkbox name="confirmDuplicate" /> {t("duplicates.confirm")}
          </label>
        </Alert>
      ) : null}
      <FormError namespace="people.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("hire.submit")}
        </Button>
      </div>
    </form>
  );
}
